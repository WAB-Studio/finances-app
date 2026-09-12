/**
 * Drives `POST /api/phrase/notes` against a real running server and the
 * real `reading.phrase_notes`, `reading.model_spend` and `reading.client_spend`
 * — never asserted from the migration (AGENTS.md, "Verification").
 *
 * Two passes, never one, and never a spawned second server: this app
 * refuses a second `next dev` in the same directory even on another port
 * ("Another next dev server is already running" — AGENTS.md, "Run one
 * instance per worktree. Take ... as: one is up, use it."), so the
 * `check-decoration.ts` T17 shape of spawning a short-lived child does not
 * apply here — the lane's own persistent server already occupies this
 * directory's lock.
 *
 *   1. `npm run check:notes` (default) — against the lane's server exactly
 *      as `.env.local` leaves it, `CLIENT_KEY_SALT` and
 *      `PHRASE_NOTES_DAILY_CALL_CAP` both unset. Runs the gate's 400s and
 *      the "cap unset always answers 204" case. No env to arrange.
 *   2. `CHECK_NOTES_PAID=1 npm run check:notes` — against that same server
 *      restarted once with both variables exported in the shell that
 *      started it, never written to `.env.local` (AGENTS.md, "Leave
 *      apps/voyager/.env.local alone"). Runs the two real model calls, the
 *      cache-repeat check and the no-leak check, then restores
 *      `model_spend` and deletes every row it wrote.
 *
 * `notes-cache.ts` and `client-budget.ts` both start with `import
 * "server-only"`, which throws under plain Node, so their hash and key
 * derivations are reimplemented here directly — the same reason
 * `check-admission.ts` reimplements `clientKey` and `claimClientCall`
 * rather than importing them.
 */
import { createHash } from "node:crypto";

import postgres from "postgres";

const BASE_URL = process.env.VOYAGER_BASE_URL ?? "http://localhost:3105";
const NOTES_PATH = "/api/phrase/notes";
const PAID_PASS = process.env.CHECK_NOTES_PAID === "1";

// Must match exactly what the operator exports before restarting the
// server for the paid pass (see the file header) — this script has no way
// to read the running server's own environment, only to assume it.
const TEST_SALT = "check-notes-script-local-salt-only";
const TEST_CLIENT_ADDRESS = "203.0.113.77"; // RFC 5737 TEST-NET-3, same choice check-admission.ts makes.

// Real sentences from the book that prompted RL-46 (DESIGN.md, "A translated
// sentence carries a note"); the second translation is MyMemory's own reply,
// fetched once by hand against this lane's `/api/translate` and pinned here
// so a re-run never spends a second free-tier call for it.
const BLACK_MINORCA = { source: "black minorca pullets", translation: "pollitas negras de menorca" };
const FRISKING = { source: "frisking from side to side", translation: "frisking de lado a lado" };

// Never cached by any other test in this file — the fixture the "cap unset"
// case needs to prove absence rather than read a hit left over from the
// configured run.
const UNCONFIGURED_PHRASE = {
  source: "the diligent ferret groomed its whiskers",
  translation: "el huron diligente se acicalo los bigotes",
};

let failed = false;
let passes = 0;
let failures = 0;

function assert(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (ok) passes += 1;
  else {
    failures += 1;
    failed = true;
  }
}

// `notes-cache.ts`'s `phraseHash`, reimplemented (see the file header).
function foldPhrase(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}
function computeHash(source: string, translation: string): string {
  const joined = `${foldPhrase(source)}␟${foldPhrase(translation)}`;
  return createHash("sha256").update(joined).digest("hex");
}

// `client-budget.ts`'s `clientKey`, reimplemented the same way.
function computeClientKey(salt: string, address: string): string {
  return createHash("sha256").update(`${salt}:${address}`).digest("hex");
}

type NotesBody = { notes?: Array<{ term: string; note: string }> };

async function postNotes(
  baseUrl: string,
  source: string,
  translation: string,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: NotesBody | null }> {
  const response = await fetch(`${baseUrl}${NOTES_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify({ source, translation }),
  });
  const body = response.status === 200 ? ((await response.json()) as NotesBody) : null;
  return { status: response.status, body };
}

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

type ModelSpendRow = { calls: number };
type PhraseNoteRow = { phrase_hash: string; notes: unknown; model: string; resolved_at: string };

async function readTodayCalls(): Promise<number> {
  const [row] = await sql<ModelSpendRow[]>`
    select calls from reading.model_spend where day = current_date`;
  return row?.calls ?? 0;
}

async function checkGate(): Promise<void> {
  const longSource = "word ".repeat(80); // exactly 400 characters, well over the 200-char cap
  const overLength = await postNotes(BASE_URL, longSource, "hola mundo aqui");
  assert(
    `D1. a 400-character body (length=${longSource.length}) answers 400`,
    overLength.status === 400,
    `status=${overLength.status}`,
  );

  // Isolates "sin dígitos": every source token is letters-only and passes
  // admitWord on its own; the digit sits in the translation, which no
  // per-token shape check ever reaches.
  const digits = await postNotes(BASE_URL, "the swift fox jumps quietly", "el zorro veloz salta 7 veces");
  assert("D2. a digit in either string answers 400", digits.status === 400, `status=${digits.status}`);

  const twentyTokens = Array.from({ length: 20 }, (_, i) => `tokenword${i}`).join(" ");
  const overTokens = await postNotes(BASE_URL, twentyTokens, "hola mundo aqui");
  assert("D3. a 20-token source answers 400", overTokens.status === 400, `status=${overTokens.status}`);
}

async function checkUnconfigured(): Promise<void> {
  const hash = computeHash(UNCONFIGURED_PHRASE.source, UNCONFIGURED_PHRASE.translation);
  const [stale] = await sql<PhraseNoteRow[]>`select * from reading.phrase_notes where phrase_hash = ${hash}`;
  if (stale) {
    console.log("removing a stale row from a previous run before this check");
    await sql`delete from reading.phrase_notes where phrase_hash = ${hash}`;
  }

  const [{ count: before }] = await sql<{ count: string }[]>`select count(*) from reading.phrase_notes`;
  const result = await postNotes(BASE_URL, UNCONFIGURED_PHRASE.source, UNCONFIGURED_PHRASE.translation);
  assert(
    "D4. with PHRASE_NOTES_DAILY_CALL_CAP unset, a valid phrase answers 204",
    result.status === 204,
    `status=${result.status}`,
  );

  const [{ count: after }] = await sql<{ count: string }[]>`select count(*) from reading.phrase_notes`;
  assert("D5. no row was written", before === after, `before=${before} after=${after}`);
}

async function checkPaid(): Promise<void> {
  const hashMinorca = computeHash(BLACK_MINORCA.source, BLACK_MINORCA.translation);
  const hashFrisking = computeHash(FRISKING.source, FRISKING.translation);
  const clientKey = computeClientKey(TEST_SALT, TEST_CLIENT_ADDRESS);
  const headers = { "x-forwarded-for": TEST_CLIENT_ADDRESS };

  let rowsCreated = 0;
  const priorSpendRow = (await sql<ModelSpendRow[]>`
    select calls from reading.model_spend where day = current_date`)[0];
  const baselineCalls = priorSpendRow?.calls ?? 0;

  try {
    // A stale row from a previous run would turn the "one model call"
    // assertion below into a false pass on a cache hit — start from zero.
    await sql`delete from reading.phrase_notes where phrase_hash in (${hashMinorca}, ${hashFrisking})`;

    const beforeMinorca = await readTodayCalls();
    const minorca = await postNotes(BASE_URL, BLACK_MINORCA.source, BLACK_MINORCA.translation, headers);
    assert(
      "D6. black minorca pullets / pollitas negras de menorca answers 200 with 1-3 notes",
      minorca.status === 200 && (minorca.body?.notes?.length ?? 0) >= 1 && (minorca.body?.notes?.length ?? 0) <= 3,
      `status=${minorca.status} notes=${JSON.stringify(minorca.body?.notes)}`,
    );
    if (minorca.status === 200) rowsCreated += 1;
    const namesMinorca = minorca.body?.notes?.some((n) => /minorca/i.test(n.term)) ?? false;
    assert("D7. one of those notes names \"minorca\"", namesMinorca, `notes=${JSON.stringify(minorca.body?.notes)}`);
    console.log(`black minorca notes (literal): ${JSON.stringify(minorca.body?.notes, null, 2)}`);

    const afterMinorca = await readTodayCalls();
    assert(
      "D8. that call spent exactly one model_spend.calls",
      afterMinorca - beforeMinorca === 1,
      `before=${beforeMinorca} after=${afterMinorca}`,
    );

    const frisking = await postNotes(BASE_URL, FRISKING.source, FRISKING.translation, headers);
    assert(
      "D9. frisking from side to side answers 200 with a note about \"frisking\"",
      frisking.status === 200 && (frisking.body?.notes?.some((n) => /frisking/i.test(n.term)) ?? false),
      `status=${frisking.status} notes=${JSON.stringify(frisking.body?.notes)}`,
    );
    if (frisking.status === 200) rowsCreated += 1;
    console.log(`frisking notes (literal): ${JSON.stringify(frisking.body?.notes, null, 2)}`);

    const afterFrisking = await readTodayCalls();
    assert(
      "D10. that call spent exactly one more model_spend.calls",
      afterFrisking - afterMinorca === 1,
      `before=${afterMinorca} after=${afterFrisking}`,
    );

    const repeat = await postNotes(BASE_URL, BLACK_MINORCA.source, BLACK_MINORCA.translation, headers);
    assert(
      "D11. the identical second request answers the same notes",
      repeat.status === 200 && JSON.stringify(repeat.body?.notes) === JSON.stringify(minorca.body?.notes),
      `first=${JSON.stringify(minorca.body?.notes)} second=${JSON.stringify(repeat.body?.notes)}`,
    );
    const afterRepeat = await readTodayCalls();
    assert(
      "D12. and model_spend.calls does not move — two readings around it",
      afterRepeat === afterFrisking,
      `before repeat=${afterFrisking} after repeat=${afterRepeat}`,
    );

    const rows = await sql<PhraseNoteRow[]>`
      select * from reading.phrase_notes where phrase_hash in (${hashMinorca}, ${hashFrisking})`;
    assert("D13. both phrases hold exactly one row each", rows.length === 2, `rows=${rows.length}`);
    const leaked = rows.some((row) => {
      const blob = JSON.stringify(row).toLowerCase();
      return blob.includes(foldPhrase(BLACK_MINORCA.source)) || blob.includes(foldPhrase(FRISKING.source));
    });
    assert(
      "D14. select * from reading.phrase_notes carries no readable source phrase",
      !leaked,
      `columns=${Object.keys(rows[0] ?? {}).join(",")}`,
    );
  } finally {
    await sql`delete from reading.phrase_notes where phrase_hash in (${hashMinorca}, ${hashFrisking})`;
    await sql`delete from reading.client_spend where day = current_date and client = ${clientKey}`;
    if (priorSpendRow) {
      await sql`update reading.model_spend set calls = ${baselineCalls} where day = current_date`;
    } else {
      await sql`delete from reading.model_spend where day = current_date`;
    }
    console.log(`cleanup: deleted ${rowsCreated} phrase_notes row(s) this run created, restored model_spend.calls to ${baselineCalls}`);
  }
}

async function main(): Promise<void> {
  if (PAID_PASS) {
    await checkPaid();
  } else {
    await checkGate();
    await checkUnconfigured();
  }

  await sql.end();
  console.log("");
  console.log(`REPORT  ${passes} pass, ${failures} fail`);
  process.exit(failed ? 1 : 0);
}

void main();
