import { z } from "zod";

// The wire format of the account copy (RL-22). The client driver and the
// route handler both import this file, so the shape a `fetch` sends is
// exactly the shape the handler parses — one schema, not two hand-kept in
// sync (the pattern is app/api/translate/route.ts's `translateRequestSchema`).

// ~155 KB per request at ~310 bytes/row typical (424 B/row worst case admits
// 212 KB), up from 289 B/row measured before `translation`. Both stay well
// under a megabyte, so splitting the batch would only double the requests.
export const SYNC_BATCH = 500;

// One row of the reader's log, as it travels off the device that wrote it.
// `deviceId` + `localId` is the row's identity: copying it twice never
// duplicates it, on the way up or on the way down (RL-24).
export const syncRowSchema = z.object({
  deviceId: z.uuid(),
  localId: z.int().positive(),
  at: z.int(), // epoch ms, the device's own clock
  text: z.string().min(1).max(500),
  normalised: z.string().min(1).max(500),
  kind: z.enum(["word", "phrase"]),
  outcome: z.enum(["exact", "inflected", "miss", "translated", "untranslated"]),
  headword: z.string().max(500).nullable(),
  rule: z.string().max(100).nullable(),
  senses: z.int().min(0),
  translation: z.string().max(120).nullable(),
  dictionaryReady: z.boolean(),
  origin: z.enum(["device", "network"]).nullable(),
  recordSchema: z.int().positive(),
});

// What a device sends: its own rows since the last upload, and the cursor of
// what it last pulled. The two cursors are never the same value: the upload
// cursor tracks this device's own log, the download cursor tracks the
// account's `received_at` — a device's own clock never orders the other one.
export const syncRequestSchema = z.object({
  rows: z.array(syncRowSchema).max(SYNC_BATCH),
  since: z.iso.datetime().nullable(),
});

// What the server answers: how many of the uploaded rows it accepted, the
// rows other devices copied since `since`, and the cursor to send back next
// time. `receivedAt` is the server's clock, stamped once per row on arrival —
// it is what makes the download cursor monotonic when `at` is not.
export const syncResponseSchema = z.object({
  accepted: z.int(),
  rows: z.array(syncRowSchema.extend({ receivedAt: z.iso.datetime() })),
  cursor: z.iso.datetime().nullable(),
});

export type SyncRow = z.infer<typeof syncRowSchema>;
export type SyncRequest = z.infer<typeof syncRequestSchema>;
export type SyncResponse = z.infer<typeof syncResponseSchema>;
