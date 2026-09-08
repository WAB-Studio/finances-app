import { openLogDatabase } from "./record";
import type { LookupOutcome, LookupRecord } from "./types";

// The account copy's third operation on `lookups` (module 25), alongside
// `merge.ts`'s two: this one reads by `at`, the order a reader recognises,
// not by `id`, the order rows arrived in.

const STORE_NAME = "lookups";
const AT_INDEX = "at";

export type HistoryCursor = { at: number; id: number };

export type HistoryRow = {
  id: number;
  at: number;
  text: string;
  translation: string | null;
  outcome: LookupOutcome;
};

export type HistoryPage = { rows: HistoryRow[]; next: HistoryCursor | null };

export const HISTORY_PAGE = 50;

function toRow(record: LookupRecord): HistoryRow {
  return {
    id: record.id as number,
    at: record.at,
    text: record.text,
    translation: record.translation ?? null,
    outcome: record.outcome,
  };
}

/** A page of the log, most recent first. `after` resumes where the last page stopped; `null` starts at the top. */
export async function readHistoryPage(
  after: HistoryCursor | null,
  limit: number = HISTORY_PAGE,
): Promise<HistoryPage> {
  const database = await openLogDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).index(AT_INDEX).openCursor(null, "prev");
    const rows: HistoryRow[] = [];
    // `at` is not unique: a resume jumps to the exact `(at, id)` pair the
    // last page ended on, then discards that one row — it was already
    // returned — before the first new row is pushed. A resume keyed on
    // `at` alone would land on the first row of the tie, not the one after
    // it, and either repeat or drop whichever rows share that millisecond.
    let needsResume = after !== null;
    let needsSkip = after !== null;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve({ rows, next: null });
        return;
      }
      if (needsResume) {
        needsResume = false;
        cursor.continuePrimaryKey(after!.at, after!.id);
        return;
      }
      if (needsSkip) {
        needsSkip = false;
        cursor.continue();
        return;
      }
      const record = cursor.value as LookupRecord;
      rows.push(toRow(record));
      if (rows.length >= limit) {
        const last = rows[rows.length - 1];
        resolve({ rows, next: { at: last.at, id: last.id } });
        return;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}
