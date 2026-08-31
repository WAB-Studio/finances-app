import "server-only";

import { createHash } from "node:crypto";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";

import {
  readImportScope,
  type ImportScope,
  type ScopedEntity,
} from "@/db/queries/import-preview";
import { ActionError } from "@/lib/errors";
import { centsToPesos } from "@/lib/money";
import { SHEET_ENTITIES, sheetDescriptors, type SheetEntity } from "@/lib/spreadsheet/schema";
import { parseWorkbook, type ReverseSheetLabels } from "@/lib/spreadsheet/workbook";
import { createAccountSchema } from "@/lib/validation/account";
import { createCategorySchema } from "@/lib/validation/category";
import { createMemberSchema } from "@/lib/validation/member";
import { createRecurringRuleSchema } from "@/lib/validation/recurring-rule";
import { createTransactionSchema } from "@/lib/validation/transaction";

// The soft cap the whole import obeys before any per-row work, so a runaway file
// never runs the free tier's execution budget dry (RNF-15).
const MAX_DATA_ROWS = 10_000;

// Every error the pipeline reports is a catalogue key, translated by the screen that
// shows it (RF-48). The cap and the reference resolver raise these; a schema failure
// carries its own field keys.
export const TOO_MANY_ROWS = "data.import.errors.tooManyRows";
const UNKNOWN_REFERENCE = "data.import.errors.unknownReference";
const AMBIGUOUS_REFERENCE = "data.import.errors.ambiguousReference";
const INVALID_CELL = "data.import.errors.invalidCell";

// A catalogue key is a dotted identifier with no spaces; a raw Zod default is an
// English sentence. The light guard's number/enum/date fields carry no custom key,
// so a mistyped cell surfaces Zod's default — mapped to a key here so no English
// string ever reaches the preview (RF-48).
const CATALOGUE_KEY = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/;

// A stable, private namespace for the placeholder id a file-new reference target
// resolves to; the preview never writes, so a placeholder purely satisfies the
// authoritative schema's `z.uuid()` and a later commit rebuilds the same map.
const PLACEHOLDER_NAMESPACE = "finances-app/import";

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

// One row after the three gates: its position, its new-vs-update classification, the
// errors it collected, and — only when it passed clean — the resolved, id-shaped and
// schema-validated object a later commit writes. `object` is null for an errored row.
// `externalRef` and `placeholderId` ride alongside because the authoritative schema
// strips both from `object`, yet the commit needs the raw stable key to write it and
// key an update (RF-52), and the placeholder a NEW account or category was assigned so
// a reference to it remaps to its REAL inserted id (RF-51), never the placeholder.
export type ResolvedRow = {
  index: number;
  status: "new" | "update";
  errors: string[];
  object: unknown | null;
  // The row's raw stable key, null when the file left it blank (a trigger backfills it).
  externalRef: string | null;
  // The deterministic placeholder a file-new account or category is referenced by;
  // null for every other entity and for an update, which reuses the existing real id.
  placeholderId: string | null;
};

export type ImportEntityResult = {
  entity: SheetEntity;
  rows: ResolvedRow[];
};

// What both the preview and a future commit consume: every entity's resolved rows and
// the run's tallies. The preview strips `object`; the commit writes the passing rows.
export type ImportResult = {
  perEntity: ImportEntityResult[];
  totals: { new: number; update: number; error: number };
};

// The effective post-import set a reference resolves against: existing rows unioned
// with the file's own account/category sheet rows. Two maps, name → the ids of the
// distinct effective entities carrying that name.
type EffectiveRefs = {
  accounts: Map<string, string[]>;
  categories: Map<string, string[]>;
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

// A trimmed string cell, or "" for anything else — the shape the effective-set and
// classification code reads a raw name or key as.
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// A deterministic v5-style uuid from a seed, so a file-new reference target resolves
// to the same placeholder every run: a fixed-namespace SHA-1, versioned and variant-
// tagged, formatted as a uuid the authoritative schema's `z.uuid()` accepts.
function placeholderUuid(seed: string): string {
  const bytes = createHash("sha1").update(`${PLACEHOLDER_NAMESPACE}:${seed}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// The one seed both the effective-set builder and a row's exposed `placeholderId`
// derive from, so a reference and its target resolve to the SAME placeholder: a stable
// key seeds by that key, a blank one by the file position — never a real database id.
function placeholderFor(seedPrefix: string, ref: string, rowIndex: number): string {
  const seed = ref.length > 0 ? `${seedPrefix}:ref:${ref}` : `${seedPrefix}:new:${rowIndex}`;
  return placeholderUuid(seed);
}

// The effective post-import name→ids map for one referenced entity: the caller's
// existing rows plus the file's own rows for that entity, deduped by stable key. A
// file row whose key matches an existing row is the SAME entity — it adds no
// candidate but may rename it; a file row with a new or blank key is a NEW entity
// with a deterministic placeholder id. Distinct entities that share a name both land
// under it, so the resolver still calls that name ambiguous.
function buildEffectiveMap(
  existing: ScopedEntity[],
  fileRows: RawRow[],
  seedPrefix: string,
): Map<string, string[]> {
  const entities: { id: string; name: string }[] = existing.map((row) => ({
    id: row.id,
    name: row.name,
  }));

  const indexByRef = new Map<string, number>();
  existing.forEach((row, index) => {
    if (row.externalRef != null) indexByRef.set(row.externalRef, index);
  });

  fileRows.forEach((raw, rowIndex) => {
    const ref = text(raw.externalRef);
    const name = text(raw.name);
    const existingIndex = ref.length > 0 ? indexByRef.get(ref) : undefined;

    if (existingIndex !== undefined) {
      // Same entity as an existing row (an update); a rename overrides its name.
      if (name.length > 0) entities[existingIndex].name = name;
      return;
    }

    entities.push({ id: placeholderFor(seedPrefix, ref, rowIndex), name });
  });

  const map = new Map<string, string[]>();
  for (const entity of entities) {
    if (entity.name.length === 0) continue;
    const ids = map.get(entity.name) ?? [];
    ids.push(entity.id);
    map.set(entity.name, ids);
  }
  return map;
}

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
// caller's EXISTING scope updates, one absent — or blank, a fresh template row — is
// new. Classified from the raw key so a row that fails validation still lands in a
// bucket; the effective set governs resolution, never classification.
function classify(entity: SheetEntity, raw: RawRow, existingRefs: Set<string>): "new" | "update" {
  const ref = text(raw.externalRef);
  return ref.length > 0 && existingRefs.has(ref) ? "update" : "new";
}

// A distinct, ordered list of the message keys a Zod failure raised. A field with a
// custom key passes its key through; a default English message from a number, enum
// or date field maps to the generic invalid-cell key.
function issueKeys(error: z.ZodError): string[] {
  return [
    ...new Set(
      error.issues.map((issue) =>
        CATALOGUE_KEY.test(issue.message) ? issue.message : INVALID_CELL,
      ),
    ),
  ];
}

// One reference name to an id in the effective set: no match is unknown, more than
// one distinct entity is ambiguous — both per-row, never a whole-file abort (the
// decided behaviour).
function resolveOne(name: string, map: Map<string, string[]>): { id?: string; error?: string } {
  const ids = map.get(name) ?? [];
  if (ids.length === 0) return { error: UNKNOWN_REFERENCE };
  if (ids.length > 1) return { error: AMBIGUOUS_REFERENCE };
  return { id: ids[0] };
}

// The guard's output (names, all references still names) turned id-shaped for the
// authoritative schema, gathering a per-row error for every reference that does not
// resolve to exactly one entity in the effective set. The object is only meaningful
// when `errors` is empty; the caller stops before validating otherwise.
function resolveAndShape(
  entity: SheetEntity,
  data: Record<string, unknown>,
  refs: EffectiveRefs,
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
      const parentId = resolveInto(data.parent, refs.categories);
      return {
        object: { name: data.name, kind: data.kind, parentId, color: data.color },
        errors,
      };
    }

    case "recurringRules": {
      const fromAccountId = resolveInto(data.fromAccount, refs.accounts);
      const toAccountId = resolveInto(data.toAccount, refs.accounts);
      const categoryId = resolveInto(data.category, refs.categories);
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
      const fromAccountId = resolveInto(data.fromAccount, refs.accounts);
      const toAccountId = resolveInto(data.toAccount, refs.accounts);

      // The kind follows the account pair: both names present is a transfer, which
      // carries no category and no splits (RF-20/RF-69). An income or expense builds
      // a single split for the row's full amount, so the split-sum rule holds.
      const isTransfer = data.fromAccount != null && data.toAccount != null;
      const categoryId = isTransfer ? null : resolveInto(data.category, refs.categories);
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
// resolution against the effective set, then the authoritative schema. Errors are
// collected, never thrown; each gate feeds the next only on success, and the row is
// classified regardless. The resolved object rides along for a later commit.
function processRow(
  entity: SheetEntity,
  raw: RawRow,
  index: number,
  refs: EffectiveRefs,
  existingRefs: Set<string>,
): ResolvedRow {
  const status = classify(entity, raw, existingRefs);

  // The raw stable key and, for a NEW account or category, the placeholder a reference
  // to it resolves to — both carried whatever the gates decide, so an errored row still
  // reports its key and the commit never recomputes either.
  const ref = text(raw.externalRef);
  const externalRef = ref.length > 0 ? ref : null;
  const placeholderId =
    (entity === "accounts" || entity === "categories") && status === "new"
      ? placeholderFor(entity, ref, index)
      : null;
  const carried = { index, status, externalRef, placeholderId };

  const guarded = sheetDescriptors[entity].rowSchema.safeParse(toNameShaped(entity, raw));
  if (!guarded.success) return { ...carried, errors: issueKeys(guarded.error), object: null };

  const resolved = resolveAndShape(entity, guarded.data as Record<string, unknown>, refs);
  if (resolved.errors.length > 0) return { ...carried, errors: resolved.errors, object: null };

  const checked = createSchemas[entity].safeParse(resolved.object);
  if (!checked.success) return { ...carried, errors: issueKeys(checked.error), object: null };

  return { ...carried, errors: [], object: checked.data };
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
 * The import pipeline (RF-51/52), the single validation path both `preview` and a
 * later `commit` run so they agree to the row: parse the upload, enforce the cap,
 * build the effective post-import sets, then push every row through the three gates.
 * References resolve against existing scope UNIONED with the file's own new accounts
 * and categories, so a full single-file dev→prod migration links a movement to an
 * account created in the same file. Writes NOTHING; the resolved rows ride along for
 * a commit to apply. RLS bounds every read to the caller's scope.
 */
export async function runImportPipeline(input: { buffer: ArrayBuffer }): Promise<ImportResult> {
  const parsed = await parseWorkbook({ buffer: input.buffer, labels: await reverseLabels() });

  // The cap is measured before any per-row work, across every sheet (RNF-15).
  const total = SHEET_ENTITIES.reduce((sum, entity) => sum + (parsed[entity]?.length ?? 0), 0);
  if (total > MAX_DATA_ROWS) throw new ActionError(TOO_MANY_ROWS);

  const scope: ImportScope = await readImportScope();

  const refs: EffectiveRefs = {
    accounts: buildEffectiveMap(scope.accounts, (parsed.accounts ?? []) as RawRow[], "accounts"),
    categories: buildEffectiveMap(
      scope.categories,
      (parsed.categories ?? []) as RawRow[],
      "categories",
    ),
  };

  const totals = { new: 0, update: 0, error: 0 };
  const perEntity: ImportEntityResult[] = SHEET_ENTITIES.map((entity) => {
    const existingRefs = scope.existingRefs[entity];
    const rows = (parsed[entity] ?? []).map((raw, index) =>
      processRow(entity, raw as RawRow, index, refs, existingRefs),
    );

    for (const row of rows) {
      if (row.errors.length > 0) totals.error += 1;
      else totals[row.status] += 1;
    }

    return { entity, rows };
  });

  return { perEntity, totals };
}
