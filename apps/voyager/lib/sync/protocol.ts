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
//
// `since`/`cursor` are opaque strings, not `z.iso.datetime()`: a single upload
// is one INSERT, so its rows share `received_at` to the microsecond, and a
// scalar timestamp cursor either repeats or drops the rest of that group at a
// page boundary. The route that mints and reads this string is the only file
// that knows it also carries the tied row's `(deviceId, localId)`.
//
// `deviceId` is top-level, not read off `rows[0]`: a pull-only round sends an
// empty `rows`, and the device still has to be nameable there — a reader who
// only ever downloads must still seal its own row in `reading.devices`
// (module 31, RL-25). Always present, never conditional on `rows` being
// empty: one shape for every round keeps the route's own read one line, not
// two paths that can drift apart.
export const syncRequestSchema = z.object({
  deviceId: z.uuid(),
  rows: z.array(syncRowSchema).max(SYNC_BATCH),
  since: z.string().min(1).nullable(),
});

// What the server answers: how many of the uploaded rows it accepted, the
// rows other devices copied since `since`, and the cursor to send back next
// time. Each row's own `receivedAt` is the server's clock, stamped once per
// row on arrival; `cursor` folds the last row's `receivedAt` together with its
// `(deviceId, localId)` so a tied group never repeats or drops at the page
// boundary (RL-24).
export const syncResponseSchema = z.object({
  accepted: z.int(),
  rows: z.array(syncRowSchema.extend({ receivedAt: z.iso.datetime() })),
  cursor: z.string().min(1).nullable(),
});

export type SyncRow = z.infer<typeof syncRowSchema>;
export type SyncRequest = z.infer<typeof syncRequestSchema>;
export type SyncResponse = z.infer<typeof syncResponseSchema>;
