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

// The table each entity reads from, keyed by the export's own entity names.
const exportTables = {
  accounts,
  members: groupMembers,
  categories,
  recurringRules,
  transactions,
} as const;

// Model rows come from the migrations (RNF-11); the row a sheet carries is those
// models narrowed to exactly the fields Module 4's descriptor declares.
type ModelOf = {
  accounts: typeof accounts.$inferSelect;
  members: typeof groupMembers.$inferSelect;
  categories: typeof categories.$inferSelect;
  recurringRules: typeof recurringRules.$inferSelect;
  transactions: typeof transactions.$inferSelect;
};

type FieldOf<E extends SheetEntity> =
  (typeof sheetDescriptors)[E]["columns"][number]["field"];

export type ExportRow<E extends SheetEntity> = Pick<
  ModelOf[E],
  FieldOf<E> & keyof ModelOf[E]
>;

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

// One entity's rows, projected to exactly the descriptor's fields. RLS scopes
// every row to the caller — personal plus their group's — so no manual scope
// filter joins the range predicates; the policy alone bounds the read.
async function readEntity<E extends SheetEntity>(
  entity: E,
  from?: Date | string,
  to?: Date | string,
): Promise<ExportRow<E>[]> {
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

    return rows as unknown as ExportRow<E>[];
  });
}

/**
 * Every requested entity in export shape, each in its own round trip so the reads
 * fan out (RF-50). RLS bounds each set to the caller's scope: a caller with no
 * group reads their personal rows and no members, since the members policy shows
 * only a group's roster. Money stays integer cents — the sheet's cents→pesos
 * boundary is a later module's. Transfers stay in the transactions set: RF-19's
 * report-only exclusion does not reach a backup.
 */
export async function readExport(input: ExportInput): Promise<ExportResult> {
  const requested = SHEET_ENTITIES.filter((entity) => input.entityKeys.includes(entity));

  const sets = await Promise.all(
    requested.map((entity) => readEntity(entity, input.from, input.to)),
  );

  const result: ExportResult = {};
  requested.forEach((entity, index) => {
    result[entity] = sets[index] as never;
  });

  return result;
}
