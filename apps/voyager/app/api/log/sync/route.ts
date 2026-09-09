import "server-only";

import { sql } from "drizzle-orm";

import { getReader, withReaderDb, type Transaction } from "@/lib/session";
import { syncRequestSchema, SYNC_BATCH, type SyncResponse, type SyncRow } from "@/lib/sync/protocol";

// Reads the session per request and answers a moving cursor: never a candidate
// for the full route cache, on top of the `Cache-Control` this route also sets.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

// The fifteen columns `authenticated` may write, in the grant's own order
// (apps/voyager/db/migrations/0000_shallow_hammerhead.sql:74-78). `received_at`
// is never here: no grant reaches it, only the server's own clock stamps it —
// which is why a builder `.insert()` cannot be used (apps/orbit/db/insert-row.ts's
// header: it would name `received_at` too, with the keyword `default`, and
// Postgres checks the privilege on a named column even then).
const INSERT_COLUMNS = sql.join(
  [
    "user_id",
    "device_id",
    "local_id",
    "at",
    "text",
    "normalised",
    "kind",
    "outcome",
    "headword",
    "rule",
    "senses",
    "translation",
    "dictionary_ready",
    "origin",
    "record_schema",
  ].map((column) => sql.identifier(column)),
  sql`, `,
);

// Coarse on purpose (`db/schema/devices.ts`'s own comment on `label`):
// browser family and platform, nothing that adds entropy a fingerprint would.
// A pattern this loose over-matches on purpose — a wrong guess still reads
// as "some browser", never as an error.
function browserFamily(userAgent: string): string {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/OPR\/|Opera/.test(userAgent)) return "Opera";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "Browser";
}

function platformName(userAgent: string): string {
  if (/Android/.test(userAgent)) return "Android";
  if (/iPhone|iPad|iPod/.test(userAgent)) return "iOS";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Mac OS X/.test(userAgent)) return "macOS";
  if (/Linux/.test(userAgent)) return "Linux";
  return "device";
}

// The label the server derives instead of asking the client for one (the
// module 31 decision, 2026-09-08): a modified client cannot write whatever it
// wants onto its own account screen. Sliced to the 60 characters
// `devices_label_length` admits; a missing header falls back rather than
// failing the whole copy over a label.
const DEFAULT_LABEL = "Unknown device";

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return DEFAULT_LABEL;
  return `${browserFamily(userAgent)} on ${platformName(userAgent)}`.slice(0, 60);
}

// The three columns `authenticated` may insert into `devices`
// (migration:89): `created_at` and `last_seen_at` are left to their defaults.
const DEVICE_INSERT_COLUMNS = sql.join(
  ["user_id", "device_id", "label"].map((column) => sql.identifier(column)),
  sql`, `,
);

function uploadedRow(userId: string, row: SyncRow) {
  // A string, not a `Date`: postgres.js's Bind step serializes a bound
  // parameter by the OID Postgres describes back, and an ISO string reaches
  // "unknown" there — which Postgres coerces from context, straight to
  // `timestamptz`. A `Date` object hits that same describe-driven path
  // wrong and throws (`Buffer.from` on a `Date`, not a string).
  return sql`(${userId}, ${row.deviceId}, ${row.localId}, ${new Date(row.at).toISOString()},
    ${row.text}, ${row.normalised}, ${row.kind}, ${row.outcome}, ${row.headword},
    ${row.rule}, ${row.senses}, ${row.translation}, ${row.dictionaryReady},
    ${row.origin}, ${row.recordSchema})`;
}

// Seals `reading.devices` (RL-25) and inserts the device's own batch,
// `on conflict … do nothing` so a retried batch after a crash never
// duplicates (RL-24) — one statement for every row in it, plus the one row
// that seals the device. Both live in the same statement: the seal is a
// data-modifying CTE, so Postgres runs it even when the insert beneath it
// returns nothing (`retireDevice`'s own `gone` CTE, `docs/TRAPS.md:463-486`),
// which keeps a resent, fully-duplicate batch sealing the device too.
// `deviceId` is required on the wire (`syncRequestSchema`), so the `null`
// guard below is unreached through this route; it stays for a caller
// `writeUpload` gains later that is not fed a parsed request.
async function writeUpload(
  tx: Transaction,
  userId: string,
  deviceId: string | null,
  label: string,
  rows: SyncRow[],
): Promise<number> {
  if (deviceId === null) return 0;

  if (rows.length === 0) {
    await tx.execute(sql`
      insert into reading.devices (${DEVICE_INSERT_COLUMNS})
      values (${userId}, ${deviceId}, ${label})
      on conflict (user_id, device_id) do update set last_seen_at = now()
    `);
    return 0;
  }

  const values = sql.join(
    rows.map((row) => uploadedRow(userId, row)),
    sql`, `,
  );
  const written = await tx.execute(sql`
    with sealed as (
      insert into reading.devices (${DEVICE_INSERT_COLUMNS})
      values (${userId}, ${deviceId}, ${label})
      on conflict (user_id, device_id) do update set last_seen_at = now()
      returning 1
    )
    insert into reading.lookups (${INSERT_COLUMNS})
    values ${values}
    on conflict (user_id, device_id, local_id) do nothing
    returning received_at
  `);
  return written.length;
}

// `at` and `received_at` travel as UTC wall-clock text with no zone marker,
// not the bare column: `drizzle-orm/postgres-js` registers a transparent
// parser over every timestamp OID (its own `driver.js`), so a raw
// `tx.execute()` — one with no schema column to decode through — hands back
// Postgres's own text output (`DateStyle`-dependent) instead of a `Date`.
// `timezone('utc', …)` pins the zone regardless of the session's own setting;
// `to_json` on the result is then a plain "YYYY-MM-DDTHH:MI:SS.ffffff", which
// this file appends its own literal "Z" to — never `new Date(...).toISOString()`,
// which would round the stored microseconds down to milliseconds and make
// `received_at > cursor` true again for the very row the cursor named
// (RL-24's "never download the same row twice").
type DownloadedRow = {
  device_id: string;
  local_id: number;
  at: string;
  text: string;
  normalised: SyncRow["normalised"];
  kind: SyncRow["kind"];
  outcome: SyncRow["outcome"];
  headword: string | null;
  rule: string | null;
  senses: number;
  translation: string | null;
  dictionary_ready: boolean;
  origin: SyncRow["origin"];
  record_schema: number;
  received_at: string;
};

// The tuple a cursor names: the last downloaded row's own clock plus the
// `(deviceId, localId)` that makes it unique. `received_at` alone repeats
// across an entire upload batch (one INSERT stamps every row with the same
// `now()`), so a scalar cursor either replays or drops whatever else shares
// that instant at a page boundary.
type Cursor = { receivedAt: string; deviceId: string; localId: number };

// Opaque past this file: neither `protocol.ts` nor the driver reads what is
// inside. "|" never appears in an ISO timestamp or a UUID, so a plain split
// is enough.
function encodeCursor(cursor: Cursor): string {
  return `${cursor.receivedAt}|${cursor.deviceId}|${cursor.localId}`;
}

// A cursor this route cannot parse is treated as none: nobody has one stored
// yet, so there is nothing to migrate, only a full resync to fall back to.
function decodeCursor(raw: string): Cursor | null {
  const parts = raw.split("|");
  if (parts.length !== 3) return null;
  const [receivedAt, deviceId, localIdText] = parts;
  const localId = Number(localIdText);
  if (!receivedAt || !deviceId || !Number.isInteger(localId)) return null;
  return { receivedAt, deviceId, localId };
}

// Downloads what other devices copied since `since`, ordered by the same
// tuple the comparison names, so the last row's own clock and identity are
// the next cursor to send back (RL-22). No cursor at all — a first-ever sync
// — filters on `user_id` alone: there is no sentinel value less than every
// real `received_at` to bind instead, and none is needed.
//
// `excludeDeviceId` is the calling device's own id, filtered out here rather
// than left for the client to notice: the client's own dedupe keys on
// `[device, deviceSeq]` in IndexedDB, and a row this device just uploaded
// comes back with `device` set (a local row is stored with `device: null`,
// `lib/log/merge.ts`), so it never collides with itself there — it lands as
// a second, foreign-looking copy of a search the reader already made. A
// filter on the query is the only place this is actually excluded.
async function downloadRows(
  tx: Transaction,
  since: string | null,
  excludeDeviceId: string | null,
): Promise<DownloadedRow[]> {
  const cursor = since ? decodeCursor(since) : null;

  // Never `${cursor.receivedAt}::timestamptz` alone: Postgres would then
  // describe that parameter as `timestamptz` (OID 1184), and postgres.js
  // serializes a bound value for that OID through `new Date(x).toISOString()`
  // — dropping the stored microseconds, so the cursor lands on the wrong side
  // of the very row it named and a tied upload batch either replays forever
  // or is silently dropped at the boundary (RL-24, both measured 2026-09-08).
  // Casting from text keeps the parameter's own OID at `text` (25): the value
  // crosses the wire unchanged, and Postgres parses it back server-side.
  const boundary = cursor
    ? sql`(received_at, device_id, local_id) > (${cursor.receivedAt}::text::timestamptz, ${cursor.deviceId}::uuid, ${cursor.localId}::integer)`
    : sql`true`;

  // A filter, not a paging boundary: the tuple comparison and the order by
  // below are untouched, so a page still resumes from the last row it named.
  // Fewer rows now qualify per page — a device with rows of its own gets a
  // smaller page than before, never a skipped one.
  const notOwn = excludeDeviceId ? sql`and device_id <> ${excludeDeviceId}::uuid` : sql``;

  return tx.execute<DownloadedRow>(sql`
    select device_id, local_id, to_json(timezone('utc', "at")) as "at", text, normalised,
           kind, outcome, headword, rule, senses, translation, dictionary_ready, origin,
           record_schema, to_json(timezone('utc', received_at)) as received_at
    from reading.lookups
    where user_id = auth.uid() and ${boundary} ${notOwn}
    -- Table-qualified: the output column of the same name is the to_json
    -- alias above, and json carries no ordering operator (42883) on its own.
    -- The full tuple, in the comparison's own order: received_at alone ties
    -- within a batch, and a tie resumes wrong without its tiebreakers ordered too.
    order by reading.lookups.received_at asc, reading.lookups.device_id asc, reading.lookups.local_id asc
    limit ${SYNC_BATCH}
  `);
}

function toWireRow(row: DownloadedRow): SyncResponse["rows"][number] {
  return {
    deviceId: row.device_id,
    localId: row.local_id,
    at: new Date(`${row.at}Z`).getTime(),
    text: row.text,
    normalised: row.normalised,
    kind: row.kind,
    outcome: row.outcome,
    headword: row.headword,
    rule: row.rule,
    senses: row.senses,
    translation: row.translation,
    dictionaryReady: row.dictionary_ready,
    origin: row.origin,
    recordSchema: row.record_schema,
    receivedAt: `${row.received_at}Z`,
  };
}

export async function POST(request: Request): Promise<Response> {
  // Without a session there is no query at all: `getReader` never touches
  // Postgres, so the 401 never opens a connection.
  const reader = await getReader();
  if (!reader) return json({ error: "unauthorized" }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid" }, 400);
  }

  const parsed = syncRequestSchema.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid" }, 400);

  const { rows, since } = parsed.data;

  // Nothing ties the top-level `deviceId` to the one on each row: both are
  // `z.uuid()` and a request may disagree with itself. A batch with rows has
  // always spoken for `rows[0]`'s device — sealing and excluding any other
  // sends the rows just uploaded straight back down in the same response — so
  // it keeps doing that. The top-level field answers only the empty batch, a
  // download-only round (RL-22) with no row to read a device off.
  const deviceId = rows.length > 0 ? rows[0].deviceId : parsed.data.deviceId;
  const label = deviceLabel(request.headers.get("user-agent"));

  const [accepted, downloaded] = await withReaderDb(async (tx) => {
    // Same statement order the contract names: upload, then download.
    const accepted = await writeUpload(tx, reader.id, deviceId, label, rows);
    const downloaded = await downloadRows(tx, since, deviceId);
    return [accepted, downloaded] as const;
  });

  const wireRows = downloaded.map(toWireRow);
  const last = wireRows[wireRows.length - 1];
  const cursor = last
    ? encodeCursor({ receivedAt: last.receivedAt, deviceId: last.deviceId, localId: last.localId })
    : since;

  const response: SyncResponse = { accepted, rows: wireRows, cursor };
  return json(response, 200);
}
