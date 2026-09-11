import { openLogDatabase } from "./record";
import type { LookupOutcome, LookupRecord } from "./types";

// The registro's third reader of `lookups` (RL-32), beside `history.ts`'s
// page and `merge.ts`'s two writes: a single cursor pass over the
// `normalised` index, grouping as it walks instead of loading every row.

const STORE_NAME = "lookups";
const NORMALISED_INDEX = "normalised";

// A row minted under schema 1 has no `translation` key at all — the field
// landed at schema 2 (`types.ts`'s own history) — so IndexedDB hands the
// cursor `undefined` where `LookupRecord` promises `string | null`. Both
// readers below cast a raw cursor value through this, once, at the point a
// row enters the module, rather than each folding `?? null` on its own.
function readRecord(value: unknown): LookupRecord {
  const record = value as LookupRecord;
  return record.translation === undefined ? { ...record, translation: null } : record;
}

export type StudyRow = {
  normalised: string;
  display: string;
  count: number;
  lastAt: number;
  lastTranslation: string | null;
  lastOutcome: LookupOutcome;
};

type Group = StudyRow;

function foldRow(group: Group | undefined, record: LookupRecord): Group {
  if (!group) {
    return {
      normalised: record.normalised,
      display: record.text,
      count: 1,
      lastAt: record.at,
      lastTranslation: record.translation,
      lastOutcome: record.outcome,
    };
  }
  const newer = record.at > group.lastAt;
  return {
    normalised: group.normalised,
    display: newer ? record.text : group.display,
    count: group.count + 1,
    lastAt: newer ? record.at : group.lastAt,
    lastTranslation: newer ? record.translation : group.lastTranslation,
    lastOutcome: newer ? record.outcome : group.lastOutcome,
  };
}

/**
 * Groups every row in `lookups` by `normalised`, case folded already by the
 * writer, in one read transaction. `rows` sorts by how often a word was
 * searched, then by how recently, at most `limit` of them; `total` counts
 * every group, not every row, so a caller can show "3 of 412" honestly.
 */
export async function readWordStudy(limit?: number): Promise<{ rows: StudyRow[]; total: number }> {
  const database = await openLogDatabase();
  const groups = await new Promise<Map<string, Group>>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).index(NORMALISED_INDEX).openCursor();
    const found = new Map<string, Group>();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(found);
        return;
      }
      const record = readRecord(cursor.value);
      found.set(record.normalised, foldRow(found.get(record.normalised), record));
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  const rows = [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
  return { rows: limit === undefined ? rows : rows.slice(0, limit), total: groups.size };
}

export type WordHistoryRow = {
  at: number;
  text: string;
  outcome: LookupOutcome;
  translation: string | null;
  // A sentence's own row: its answer is `translation` above, never a
  // dictionary headword — RL-34's own distinction, the caller's to read.
  kind: LookupRecord["kind"];
};

type FoundRow = WordHistoryRow & { id: number };

/**
 * Every search for one `normalised` word (RL-32's other half), most recent
 * first, in one read transaction bounded to that key alone — never a scan of
 * the whole store. `total` counts every match, unaffected by `limit`.
 */
export async function readWordHistory(
  normalised: string,
  limit?: number,
): Promise<{ rows: WordHistoryRow[]; total: number }> {
  const database = await openLogDatabase();
  const found = await new Promise<FoundRow[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction
      .objectStore(STORE_NAME)
      .index(NORMALISED_INDEX)
      .openCursor(IDBKeyRange.only(normalised));
    const rows: FoundRow[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(rows);
        return;
      }
      const record = readRecord(cursor.value);
      rows.push({
        id: record.id as number,
        at: record.at,
        text: record.text,
        outcome: record.outcome,
        translation: record.translation,
        kind: record.kind,
      });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  // Same tiebreak as `foldRow` above: the autoincrement `id` orders two
  // searches that landed in the same millisecond.
  found.sort((a, b) => b.at - a.at || b.id - a.id);
  const sliced = limit === undefined ? found : found.slice(0, limit);
  return {
    rows: sliced.map((row) => ({
      at: row.at,
      text: row.text,
      outcome: row.outcome,
      translation: row.translation,
      kind: row.kind,
    })),
    total: found.length,
  };
}
