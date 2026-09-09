import type { ForeignRow } from "@/lib/log/merge";
import { readSince, mergeForeign } from "@/lib/log/merge";
import { readSyncState, writeSyncState } from "@/lib/log/record";
import type { LookupRecord } from "@/lib/log/types";
import { SYNC_BATCH, syncRequestSchema, syncResponseSchema, type SyncResponse, type SyncRow } from "./protocol";

const SYNC_ENDPOINT = "/api/log/sync";

// A hostile record can never tie a hidden tab up forever: this many round
// trips per call, then the rest waits for the next hide.
const MAX_BATCHES = 40;

export type SyncOutcome =
  | { kind: "off" } // enabled === false: no request was ever issued
  | { kind: "done"; pushed: number; pulled: number }
  | { kind: "failed" };

function toSyncRow(row: LookupRecord, deviceId: string): SyncRow {
  return {
    deviceId,
    localId: row.id!,
    at: row.at,
    text: row.text,
    normalised: row.normalised,
    kind: row.kind,
    outcome: row.outcome,
    headword: row.headword,
    rule: row.rule,
    senses: row.senses,
    translation: row.translation,
    dictionaryReady: row.dictionaryReady,
    origin: row.origin,
    recordSchema: row.schema,
  };
}

// The row's own device, not this one's: it already crossed the wire once.
function toForeignRow(row: SyncResponse["rows"][number]): ForeignRow {
  return {
    schema: row.recordSchema,
    at: row.at,
    text: row.text,
    normalised: row.normalised,
    kind: row.kind,
    outcome: row.outcome,
    headword: row.headword,
    rule: row.rule,
    senses: row.senses,
    translation: row.translation,
    dictionaryReady: row.dictionaryReady,
    origin: row.origin,
    device: row.deviceId,
    deviceSeq: row.localId,
  };
}

// `deviceId` travels on every round, `rows` empty or not: a pull-only round
// still has to seal this device's own row in `reading.devices` (module 31,
// RL-25), and the route has nothing else top-level to read it off.
async function postBatch(deviceId: string, rows: SyncRow[], since: string | null): Promise<SyncResponse> {
  const response = await fetch(SYNC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(syncRequestSchema.parse({ deviceId, rows, since })),
  });
  if (!response.ok) throw new Error(`sync route answered ${response.status}`);
  return syncResponseSchema.parse(await response.json());
}

/**
 * Pushes local rows and pulls foreign ones, in batches of `SYNC_BATCH`, until
 * both sides come back short or `MAX_BATCHES` is spent. Every round calls
 * `postBatch`, even one with nothing local to push: the download is not a
 * side effect of the upload, so a fresh device with an empty log still pulls
 * what the account already holds. Never throws: a failed round trip leaves
 * the cursors where they were, so the next call resumes it.
 */
export async function syncNow(): Promise<SyncOutcome> {
  const state = await readSyncState();
  if (!state.enabled) return { kind: "off" };

  let pushedThroughLocalId = state.pushedThroughLocalId;
  let pulledThroughCursor = state.pulledThroughCursor;
  let pushed = 0;
  let pulled = 0;

  try {
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const localRows = await readSince(pushedThroughLocalId ?? 0, SYNC_BATCH);
      const rows = localRows.map((row) => toSyncRow(row, state.deviceId));
      const response = await postBatch(state.deviceId, rows, pulledThroughCursor);

      // The merge is awaited in full before either cursor moves: a batch
      // that only half lands must be read again next time, not skipped.
      pulled += await mergeForeign(response.rows.map(toForeignRow));

      // A pull-only round has no local row to name: the push cursor stays
      // put, so the next call's upload page starts exactly where this one's
      // did.
      if (localRows.length > 0) {
        pushedThroughLocalId = localRows[localRows.length - 1].id!;
        pushed += localRows.length;
      }
      pulledThroughCursor = response.cursor;
      await writeSyncState({ pushedThroughLocalId, pulledThroughCursor, lastSyncedAt: Date.now() });

      // Stop only once neither side has a next page waiting: a short upload
      // page alone no longer ends the call, or a large foreign backlog would
      // never finish downloading behind a thin local log.
      if (localRows.length < SYNC_BATCH && response.rows.length < SYNC_BATCH) break;
    }
    return { kind: "done", pushed, pulled };
  } catch {
    return { kind: "failed" };
  }
}
