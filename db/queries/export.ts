import "server-only";

import { and, gte, lte } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import {
  accounts,
  categories,
  groupMembers,
  recurringRules,
  transactions,
} from "@/db/schema";
import { withUserDb } from "@/db/session";
import { TIME_ZONE } from "@/lib/locales";
import { SHEET_ENTITIES, sheetDescriptors } from "@/lib/spreadsheet/schema";
import type { SheetEntity } from "@/lib/spreadsheet/schema";
import { ACCOUNT_PLACEMENTS } from "@/lib/validation/account";

// The table each entity reads from, keyed by the export's own entity names.
const exportTables = {
  accounts,
  members: groupMembers,
  categories,
  recurringRules,
  transactions,
} as const;

// A parsed cell holds a resolved name, a scalar, integer cents or nothing; never a
// raw uuid, which would mean nothing after a dev→prod restore (RF-49).
type CellValue = string | number | boolean | null;

// The keys a sheet row carries are the descriptor's column keys, in its order.
type KeyOf<E extends SheetEntity> =
  (typeof sheetDescriptors)[E]["columns"][number]["key"];

// One export row: every descriptor column keyed by its sheet key. Reference cells
// hold names, money cells stay integer cents (RNF-05), the rest pass through.
export type ExportRow<E extends SheetEntity> = Record<KeyOf<E>, CellValue>;

// Only the requested entities are read, so an absent key means "not asked for",
// distinct from a key present with an empty array.
export type ExportResult = Partial<{ [E in SheetEntity]: ExportRow<E>[] }>;

export type ExportInput = {
  entityKeys: SheetEntity[];
  from?: Date | string;
  to?: Date | string;
};

// The date range bounds only the two dated entities, on the field the descriptor
// treats as their calendar day. Both are `date` columns already interpreted in
// America/Bogota (RNF-06), so a civil-date string compares directly — no
// `at time zone` cast, unlike the timestamp the audit trail bounds.
const dateColumn: Partial<Record<SheetEntity, PgColumn>> = {
  transactions: transactions.occurredAt,
  recurringRules: recurringRules.nextRunOn,
};

// A Date bound reads back as its own Bogotá day; a string is already a civil date.
function toCivilDate(value: Date | string): string {
  if (typeof value === "string") return value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(value);
}

// One column seen through the shared contract: `satisfies` narrows each literal, so
// only some carry `ref`; this view restores the optional marker for iteration.
type ColumnView = {
  readonly key: string;
  readonly field: string;
  readonly ref?: { readonly entity: "accounts" | "categories" };
};

// True when an entity's descriptor points at the given entity by name, so its name
// map is worth a round trip.
function referencesEntity(entity: SheetEntity, ref: "accounts" | "categories"): boolean {
  const columns = sheetDescriptors[entity].columns as readonly ColumnView[];
  return columns.some((column) => column.ref?.entity === ref);
}

// One entity's raw rows, projected to exactly the descriptor's id-shaped fields.
// RLS scopes every row to the caller — personal plus their group's — so no manual
// scope filter joins the range predicates; the policy alone bounds the read.
async function readEntityRows<E extends SheetEntity>(
  entity: E,
  from?: Date | string,
  to?: Date | string,
): Promise<Record<string, unknown>[]> {
  const descriptor = sheetDescriptors[entity];
  const table = exportTables[entity];
  const columns = table as unknown as Record<string, PgColumn>;

  const projection: Record<string, PgColumn> = {};
  for (const column of descriptor.columns) projection[column.field] = columns[column.field];

  const bound = dateColumn[entity];
  const conditions: SQL[] = [];
  if (bound) {
    if (from) conditions.push(gte(bound, toCivilDate(from)));
    if (to) conditions.push(lte(bound, toCivilDate(to)));
  }

  return withUserDb(async (tx) => {
    // The table is a union across the five entities; a single concrete type lets
    // the query builder resolve `.from`, and the projection carries the shape.
    const rows = await tx
      .select(projection)
      .from(table as typeof accounts)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return rows as Record<string, unknown>[];
  });
}

// The caller's id→name map for one referenced entity, read in the caller's RLS
// scope so a reference resolves to a name the same scope can read back.
async function readNameMap(table: typeof accounts | typeof categories): Promise<Map<string, string>> {
  return withUserDb(async (tx) => {
    const rows = await tx.select({ id: table.id, name: table.name }).from(table);
    return new Map(rows.map((row) => [row.id, row.name]));
  });
}

const emptyNameMap = new Map<string, string>();

// One raw row turned into its sheet shape: a reference to its name, `placement` to
// a personal/group indicator, money left in integer cents (RNF-05), scalars as is.
function toExportRows<E extends SheetEntity>(
  entity: E,
  rows: Record<string, unknown>[],
  accountNames: Map<string, string>,
  categoryNames: Map<string, string>,
): ExportRow<E>[] {
  const columns = sheetDescriptors[entity].columns as readonly ColumnView[];

  return rows.map((row) => {
    const cell: Record<string, CellValue> = {};

    for (const column of columns) {
      const value = row[column.field];

      if (column.ref) {
        // A reference presents the referenced row's name; a null id (a one-sided
        // movement) or a name outside the caller's scope yields null.
        const names = column.ref.entity === "accounts" ? accountNames : categoryNames;
        cell[column.key] = value == null ? null : names.get(value as string) ?? null;
        continue;
      }

      // `placement` has no column of its own: an account naming an owner is
      // personal, one naming a group is group (RF-60), derived from `ownerUserId`.
      if (entity === "accounts" && column.field === "ownerUserId") {
        cell[column.key] = value == null ? ACCOUNT_PLACEMENTS[1] : ACCOUNT_PLACEMENTS[0];
        continue;
      }

      cell[column.key] = (value ?? null) as CellValue;
    }

    return cell as ExportRow<E>;
  });
}

/**
 * Every requested entity in export shape, each in its own round trip so the reads
 * fan out (RF-50), the two name maps alongside them — never chained. RLS bounds
 * each set to the caller's scope: a caller with no group reads their personal rows
 * and no members, since the members policy shows only a group's roster. References
 * resolve to names (RF-49); money stays integer cents, the sheet's cents→pesos
 * boundary a later module's. Transfers stay in the transactions set: RF-19's
 * report-only exclusion does not reach a backup.
 */
export async function readExport(input: ExportInput): Promise<ExportResult> {
  const requested = SHEET_ENTITIES.filter((entity) => input.entityKeys.includes(entity));

  const needsAccounts = requested.some((entity) => referencesEntity(entity, "accounts"));
  const needsCategories = requested.some((entity) => referencesEntity(entity, "categories"));

  const [sets, accountNames, categoryNames] = await Promise.all([
    Promise.all(requested.map((entity) => readEntityRows(entity, input.from, input.to))),
    needsAccounts ? readNameMap(accounts) : Promise.resolve(emptyNameMap),
    needsCategories ? readNameMap(categories) : Promise.resolve(emptyNameMap),
  ]);

  const result: ExportResult = {};
  requested.forEach((entity, index) => {
    result[entity] = toExportRows(entity, sets[index], accountNames, categoryNames) as never;
  });

  return result;
}
