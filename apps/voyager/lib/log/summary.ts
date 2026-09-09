import { openLogDatabase } from "./record";
import type { LookupOutcome, LookupRecord } from "./types";

// The registro's third reader of `lookups` (RL-32), beside `history.ts`'s
// page and `merge.ts`'s two writes: a single cursor pass over the
// `normalised` index, grouping as it walks instead of loading every row.

const STORE_NAME = "lookups";
const NORMALISED_INDEX = "normalised";

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
      const record = cursor.value as LookupRecord;
      found.set(record.normalised, foldRow(found.get(record.normalised), record));
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  const rows = [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
  return { rows: limit === undefined ? rows : rows.slice(0, limit), total: groups.size };
}
