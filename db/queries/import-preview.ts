import "server-only";

import { isNotNull } from "drizzle-orm";

import {
  accounts,
  categories,
  groupMembers,
  recurringRules,
  transactions,
} from "@/db/schema";
import { withUserDb } from "@/db/session";
import { SHEET_ENTITIES, type SheetEntity } from "@/lib/spreadsheet/schema";

// The table each entity's `external_ref` lives on, keyed by the import's entity
// names. A row's `external_ref` is its stable per-scope import key (RF-52): present
// in the scope means an update, absent means a new row.
const refTables = {
  accounts,
  members: groupMembers,
  categories,
  recurringRules,
  transactions,
} as const;

// The caller's scope, read once so the preview resolves references and classifies
// rows without touching Postgres again. Names are not unique in a scope, so a name
// maps to MORE THAN ONE id; the preview raises a per-row error on a plural match.
export type ImportScope = {
  accountIdsByName: Map<string, string[]>;
  categoryIdsByName: Map<string, string[]>;
  existingRefs: Record<SheetEntity, Set<string>>;
};

// One id→name table read as a name→ids map, in the caller's RLS scope so a name
// resolves to an id the same scope can write back.
function toNameMap(rows: { id: string; name: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const ids = map.get(row.name) ?? [];
    ids.push(row.id);
    map.set(row.name, ids);
  }
  return map;
}

// The set of `external_ref` values already in the caller's scope for one entity,
// the null-guarded index the classification matches on (RF-52).
async function readExistingRefs(entity: SheetEntity): Promise<Set<string>> {
  const table = refTables[entity];
  return withUserDb(async (tx) => {
    const rows = await tx
      .select({ ref: table.externalRef })
      .from(table as typeof accounts)
      .where(isNotNull(table.externalRef));
    return new Set(rows.map((row) => row.ref as string));
  });
}

/**
 * The read side of the import preview (RF-51/52), all in the caller's RLS scope like
 * `readExport`: the account and category name→ids maps a reference resolves through,
 * and every entity's existing `external_ref` set for new-vs-update classification.
 * Each read is its own round trip, fanned out with `Promise.all`, never chained.
 */
export async function readImportScope(): Promise<ImportScope> {
  const [accountRows, categoryRows, ...refSets] = await Promise.all([
    withUserDb((tx) =>
      tx.select({ id: accounts.id, name: accounts.name }).from(accounts),
    ),
    withUserDb((tx) =>
      tx.select({ id: categories.id, name: categories.name }).from(categories),
    ),
    ...SHEET_ENTITIES.map((entity) => readExistingRefs(entity)),
  ]);

  const existingRefs = Object.fromEntries(
    SHEET_ENTITIES.map((entity, index) => [entity, refSets[index]]),
  ) as Record<SheetEntity, Set<string>>;

  return {
    accountIdsByName: toNameMap(accountRows),
    categoryIdsByName: toNameMap(categoryRows),
    existingRefs,
  };
}
