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

// Inserts the device's own batch, `on conflict … do nothing` so a retried batch
// after a crash never duplicates (RL-24). One statement for every row in it.
async function uploadRows(
  tx: Transaction,
  userId: string,
  rows: SyncRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = sql.join(
    rows.map((row) => uploadedRow(userId, row)),
    sql`, `,
  );
  const written = await tx.execute(sql`
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

// Stands in for "no cursor yet": always less than any real `received_at`
// (`receivedAt` defaults to `now()`, always after 1970), so a first-ever sync
// downloads everything without a second shape of the query. Not Postgres's own
// `-infinity` literal — postgres.js's Bind step serializes a `timestamptz`
// parameter through `new Date(x).toISOString()`, and `new Date("-infinity")`
// is an Invalid Date, so that special value never survives the round trip.
const NO_CURSOR = "1970-01-01T00:00:00.000Z";

// Downloads what other devices copied since `since`, newest last so the last
// row's own clock is the next cursor to send back (RL-22).
async function downloadRows(
  tx: Transaction,
  since: string | null,
): Promise<DownloadedRow[]> {
  return tx.execute<DownloadedRow>(sql`
    select device_id, local_id, to_json(timezone('utc', "at")) as "at", text, normalised,
           kind, outcome, headword, rule, senses, translation, dictionary_ready, origin,
           record_schema, to_json(timezone('utc', received_at)) as received_at
    from reading.lookups
    where user_id = auth.uid() and received_at > ${since ?? NO_CURSOR}::timestamptz
    -- Table-qualified: the output column of the same name is the to_json
    -- alias above, and json carries no ordering operator (42883) on its own.
    order by reading.lookups.received_at asc
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

  const [accepted, downloaded] = await withReaderDb(async (tx) => {
    // Same statement order the contract names: upload, then download.
    const accepted = await uploadRows(tx, reader.id, rows);
    const downloaded = await downloadRows(tx, since);
    return [accepted, downloaded] as const;
  });

  const wireRows = downloaded.map(toWireRow);
  const cursor = wireRows.length > 0 ? wireRows[wireRows.length - 1]!.receivedAt : since;

  const response: SyncResponse = { accepted, rows: wireRows, cursor };
  return json(response, 200);
}
