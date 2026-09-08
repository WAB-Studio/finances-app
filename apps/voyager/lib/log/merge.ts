import { openLogDatabase } from "./record";
import type { LookupRecord } from "./types";

// The account copy's two operations on `lookups` (RL-21, RL-24, RNL-09), kept
// out of record.ts so the write path a keystroke rides never gains a
// function it does not call.

const STORE_NAME = "lookups";

// Measured at ~141 KB per request at 289 bytes/row (lib/sync/protocol.ts):
// a batch this size never ties the store up long enough to delay
// `recordLookup`'s own `add`.
const BATCH_SIZE = 500;

/** A row another device recorded, on its way into this one's copy (RL-24). */
export type ForeignRow = Omit<LookupRecord, "id" | "device" | "deviceSeq"> & {
  device: string;
  deviceSeq: number;
};

/** Local rows above `afterLocalId`, in key order, at most `limit`. */
export async function readSince(afterLocalId: number, limit: number): Promise<LookupRecord[]> {
  const database = await openLogDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction
      .objectStore(STORE_NAME)
      .getAll(IDBKeyRange.lowerBound(afterLocalId, true), limit);
    request.onsuccess = () => {
      // A foreign row never goes back up: it already has a device of its own.
      resolve((request.result as LookupRecord[]).filter((row) => row.device == null));
    };
    request.onerror = () => reject(request.error);
  });
}

// One batch's worth of `add` calls, each row's `ConstraintError` swallowed —
// the unique index on `[device, deviceSeq]` is what makes a repeat merge a
// no-op — and counted instead of aborting the rest of the batch.
function mergeBatch(database: IDBDatabase, batch: ForeignRow[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    let inserted = 0;
    for (const row of batch) {
      const request = store.add(row);
      request.onsuccess = () => {
        inserted += 1;
      };
      request.onerror = (event) => {
        if (request.error?.name === "ConstraintError") {
          // Already merged: cancel the default abort, keep the transaction open.
          event.preventDefault();
        }
      };
    }
    transaction.oncomplete = () => resolve(inserted);
    // A row's own `preventDefault()` above only cancels the abort; the
    // "error" event still bubbles here, with the transaction unharmed. Only
    // an unhandled error — one no row's own `onerror` swallowed — aborts it.
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * Merges foreign rows in batches of `BATCH_SIZE`, never one transaction for
 * the whole set — that would tie up `lookups` for its entire duration and
 * delay `recordLookup`'s own writes. Idempotent per row via the `foreign`
 * index, not all-or-nothing per call (RL-13's guarantee does not apply
 * here): a batch that lands stays landed, and an interrupted merge resumes
 * from wherever the cursor last advanced. Returns how many rows actually
 * entered.
 */
export async function mergeForeign(rows: ForeignRow[]): Promise<number> {
  const database = await openLogDatabase();
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    inserted += await mergeBatch(database, batch);
  }
  return inserted;
}
