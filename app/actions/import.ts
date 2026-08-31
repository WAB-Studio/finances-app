"use server";

import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";

import { readImportScope, type ImportScope } from "@/db/queries/import-preview";
import { ActionError } from "@/lib/errors";
import { centsToPesos } from "@/lib/money";
import { authActionClient } from "@/lib/safe-action";
import {
  SHEET_ENTITIES,
  sheetDescriptors,
  type SheetEntity,
} from "@/lib/spreadsheet/schema";
import { parseWorkbook, type ReverseSheetLabels } from "@/lib/spreadsheet/workbook";
import { createAccountSchema } from "@/lib/validation/account";
import { createCategorySchema } from "@/lib/validation/category";
import { createMemberSchema } from "@/lib/validation/member";
import { createRecurringRuleSchema } from "@/lib/validation/recurring-rule";
import { createTransactionSchema } from "@/lib/validation/transaction";

// The soft cap the whole import obeys before any per-row work, so a runaway file
// never runs the free tier's execution budget dry (RNF-15).
const MAX_DATA_ROWS = 10_000;

// Every error a preview reports is a catalogue key, translated by the screen that
// shows it (RF-48). The upload guards and the reference resolver raise these; a
// schema failure carries its own field keys.
const FILE_REQUIRED = "data.import.errors.fileRequired";
const FILE_TYPE = "data.import.errors.fileType";
const TOO_MANY_ROWS = "data.import.errors.tooManyRows";
const UNKNOWN_REFERENCE = "data.import.errors.unknownReference";
const AMBIGUOUS_REFERENCE = "data.import.errors.ambiguousReference";

// The authoritative id-shaped schema each entity re-runs after name→id resolution,
// the same one its form uses (RNF-10).
const createSchemas = {
  accounts: createAccountSchema,
  members: createMemberSchema,
  categories: createCategorySchema,
  recurringRules: createRecurringRuleSchema,
  transactions: createTransactionSchema,
} as const;

// A raw parsed record holds a name, a scalar, integer cents or nothing.
type RawRow = Record<string, string | number | boolean | null>;

type PreviewRow = {
  index: number;
  status: "new" | "update";
  errors: string[];
};

type PreviewEntity = {
  entity: SheetEntity;
  rows: PreviewRow[];
};

export type ImportPreview = {
  perEntity: PreviewEntity[];
  totals: { new: number; update: number; error: number };
};

// The money column keys of each entity, so the light guard sees a peso string where
// the raw record carries integer cents.
const moneyKeysByEntity = Object.fromEntries(
  SHEET_ENTITIES.map((entity) => {
    const columns = sheetDescriptors[entity].columns as readonly {
      key: string;
      money?: unknown;
    }[];
    return [entity, new Set(columns.filter((column) => column.money != null).map((c) => c.key))];
  }),
) as Record<SheetEntity, Set<string>>;

// The raw record turned name-shaped for the descriptor's light guard: a money cell
// crosses back from integer cents to a peso string, so the same peso-string schema
// the form uses validates it (RNF-10); a blank money cell reads as empty, which the
// schema reports as required rather than mistyped.
function toNameShaped(entity: SheetEntity, raw: RawRow): Record<string, unknown> {
  const moneyKeys = moneyKeysByEntity[entity];
  const shaped: Record<string, unknown> = { ...raw };
  for (const key of moneyKeys) {
    const value = raw[key];
    shaped[key] =
      typeof value === "number"
        ? String(centsToPesos(value))
        : typeof value === "string"
          ? value
          : "";
  }
  return shaped;
}

// A row's stable key decides new vs update (RF-52): an `external_ref` already in the
// scope updates, one absent — or blank, a fresh template row — is new. Classified
// from the raw key so a row that fails validation still lands in a bucket.
function classify(entity: SheetEntity, raw: RawRow, scope: ImportScope): "new" | "update" {
  const ref = typeof raw.externalRef === "string" ? raw.externalRef.trim() : "";
  return ref.length > 0 && scope.existingRefs[entity].has(ref) ? "update" : "new";
}

// A distinct, ordered list of the message keys a Zod failure raised.
function issueKeys(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => issue.message))];
}

// One reference name to an id in scope: no match is unknown, more than one is
// ambiguous — both per-row, never a whole-file abort (the decided behaviour).
function resolveOne(name: string, map: Map<string, string[]>): { id?: string; error?: string } {
  const ids = map.get(name) ?? [];
  if (ids.length === 0) return { error: UNKNOWN_REFERENCE };
  if (ids.length > 1) return { error: AMBIGUOUS_REFERENCE };
  return { id: ids[0] };
}

// The guard's output (names, all references still names) turned id-shaped for the
// authoritative schema, gathering a per-row error for every reference that does not
// resolve to exactly one id in scope. The object is only meaningful when `errors`
// is empty; the caller stops before validating otherwise.
function resolveAndShape(
  entity: SheetEntity,
  data: Record<string, unknown>,
  scope: ImportScope,
): { object: unknown; errors: string[] } {
  const errors: string[] = [];

  const resolveInto = (name: unknown, map: Map<string, string[]>): string | null => {
    if (name == null) return null;
    const resolved = resolveOne(name as string, map);
    if (resolved.error) {
      errors.push(resolved.error);
      return null;
    }
    return resolved.id ?? null;
  };

  switch (entity) {
    case "accounts":
    case "members":
      // No cross-entity reference: the guard's output is already id-shaped.
      return { object: data, errors };

    case "categories": {
      const parentId = resolveInto(data.parent, scope.categoryIdsByName);
      return {
        object: { name: data.name, kind: data.kind, parentId, color: data.color },
        errors,
      };
    }

    case "recurringRules": {
      const fromAccountId = resolveInto(data.fromAccount, scope.accountIdsByName);
      const toAccountId = resolveInto(data.toAccount, scope.accountIdsByName);
      const categoryId = resolveInto(data.category, scope.categoryIdsByName);
      return {
        object: {
          fromAccountId,
          toAccountId,
          amount: data.amount,
          categoryId,
          description: data.description,
          frequency: data.frequency,
          intervalN: data.intervalN,
          dayOfMonth: data.dayOfMonth,
          nextRunOn: data.nextRunOn,
          endsOn: data.endsOn,
        },
        errors,
      };
    }

    case "transactions": {
      const fromAccountId = resolveInto(data.fromAccount, scope.accountIdsByName);
      const toAccountId = resolveInto(data.toAccount, scope.accountIdsByName);

      // The kind follows the account pair: both names present is a transfer, which
      // carries no category and no splits (RF-20/RF-69). An income or expense builds
      // a single split for the row's full amount, so the split-sum rule holds.
      const isTransfer = data.fromAccount != null && data.toAccount != null;
      const categoryId = isTransfer ? null : resolveInto(data.category, scope.categoryIdsByName);
      const splits = isTransfer ? [] : [{ categoryId, amount: data.amount }];

      return {
        object: {
          fromAccountId,
          toAccountId,
          amount: data.amount,
          occurredAt: data.occurredAt,
          description: data.description,
          externalRef: data.externalRef,
          splits,
          labelIds: [],
        },
        errors,
      };
    }
  }
}

// One row through the three ordered gates (RF-51): the light guard, name→id
// resolution, then the authoritative schema. Errors are collected, never thrown;
// each gate feeds the next only on success, and the row is classified regardless.
function processRow(
  entity: SheetEntity,
  raw: RawRow,
  index: number,
  scope: ImportScope,
): PreviewRow {
  const status = classify(entity, raw, scope);

  const guarded = sheetDescriptors[entity].rowSchema.safeParse(toNameShaped(entity, raw));
  if (!guarded.success) return { index, status, errors: issueKeys(guarded.error) };

  const resolved = resolveAndShape(entity, guarded.data as Record<string, unknown>, scope);
  if (resolved.errors.length > 0) return { index, status, errors: resolved.errors };

  const checked = createSchemas[entity].safeParse(resolved.object);
  if (!checked.success) return { index, status, errors: issueKeys(checked.error) };

  return { index, status, errors: [] };
}

// The reverse label maps, built from the SAME `data` namespace the writer used for
// the request locale, so a file downloaded in either language round-trips (RF-49).
async function reverseLabels(): Promise<ReverseSheetLabels> {
  const t = await getTranslations({ locale: await getLocale(), namespace: "data" });
  type Key = Parameters<typeof t>[0];

  const entityBySheetName = new Map(
    SHEET_ENTITIES.map((entity) => [t(`sheets.${entity}` as Key), entity] as const),
  );

  const columnKeyByHeader = new Map(
    SHEET_ENTITIES.map((entity) => {
      const columns = sheetDescriptors[entity].columns as readonly { key: string }[];
      const headerToKey = new Map(
        columns.map((column) => [t(`columns.${column.key}` as Key), column.key] as const),
      );
      return [entity, headerToKey] as const;
    }),
  );

  return { entityBySheetName, columnKeyByHeader };
}

/**
 * The import preview (RF-51/52): parse the upload, validate every row before a
 * single write, resolve references to ids in the caller's scope, and classify each
 * row new-vs-update by its stable key. Writes NOTHING — the caller confirms first,
 * a later commit action applies. RLS bounds every read to the caller's scope.
 */
export const previewImportAction = authActionClient
  .inputSchema(z.instanceof(FormData))
  .action(async ({ parsedInput: formData }): Promise<ImportPreview> => {
    const file = formData.get("file");
    if (!(file instanceof File)) throw new ActionError(FILE_REQUIRED);
    if (!file.name.toLowerCase().endsWith(".xlsx")) throw new ActionError(FILE_TYPE);

    const parsed = await parseWorkbook({
      buffer: await file.arrayBuffer(),
      labels: await reverseLabels(),
    });

    // The cap is measured before any per-row work, across every sheet (RNF-15).
    const total = SHEET_ENTITIES.reduce((sum, entity) => sum + (parsed[entity]?.length ?? 0), 0);
    if (total > MAX_DATA_ROWS) throw new ActionError(TOO_MANY_ROWS);

    const scope = await readImportScope();

    const totals = { new: 0, update: 0, error: 0 };
    const perEntity: PreviewEntity[] = SHEET_ENTITIES.map((entity) => {
      const rows = (parsed[entity] ?? []).map((raw, index) =>
        processRow(entity, raw as RawRow, index, scope),
      );

      for (const row of rows) {
        if (row.errors.length > 0) totals.error += 1;
        else totals[row.status] += 1;
      }

      return { entity, rows };
    });

    return { perEntity, totals };
  });
