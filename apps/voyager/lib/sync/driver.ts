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

async function postBatch(rows: SyncRow[], since: string | null): Promise<SyncResponse> {
  const response = await fetch(SYNC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(syncRequestSchema.parse({ rows, since })),
  });
  if (!response.ok) throw new Error(`sync route answered ${response.status}`);
  return syncResponseSchema.parse(await response.json());
}

/**
 * Pushes local rows and pulls foreign ones, in batches of `SYNC_BATCH`, until
 * a batch comes back short or `MAX_BATCHES` is spent. Never throws: a failed
 * round trip leaves the cursors where they were, so the next call resumes it.
 */
export async function syncNow(): Promise<SyncOutcome> {
  const state = await readSyncState();
  if (!state.enabled) return { kind: "off" };

  let pushedThroughLocalId = state.pushedThroughLocalId;
  let pulledThroughIso = state.pulledThroughIso;
  let pushed = 0;
  let pulled = 0;

  try {
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const localRows = await readSince(pushedThroughLocalId ?? 0, SYNC_BATCH);
      if (localRows.length === 0) break;

      const rows = localRows.map((row) => toSyncRow(row, state.deviceId));
      const response = await postBatch(rows, pulledThroughIso);

      // The merge is awaited in full before either cursor moves: a batch
      // that only half lands must be read again next time, not skipped.
      pulled += await mergeForeign(response.rows.map(toForeignRow));

      pushedThroughLocalId = localRows[localRows.length - 1].id!;
      pulledThroughIso = response.cursor;
      pushed += localRows.length;
      await writeSyncState({ pushedThroughLocalId, pulledThroughIso, lastSyncedAt: Date.now() });

      if (localRows.length < SYNC_BATCH) break;
    }
    return { kind: "done", pushed, pulled };
  } catch {
    return { kind: "failed" };
  }
}
