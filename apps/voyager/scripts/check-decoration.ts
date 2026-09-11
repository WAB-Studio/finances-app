/**
 * Drives `reading.word_photos`, `reading.word_texts` and `reading.model_spend`
 * instead of asserting them from the migration (AGENTS.md, "Verification").
 *
 * Twelve savepoints inside one `sql.begin`, forced to ROLLBACK at the end, so
 * the permission checks touch nothing: no policy exists on these three, so
 * no `auth.users` row is needed for the claims to mean anything (unlike
 * `check-sync.ts`'s subjects) — the block is at the GRANT/REVOKE layer alone.
 *
 * The cap check is the one part that is not a rollback: it is a real HTTP
 * call against a running server (`VOYAGER_BASE_URL`, default the lane's own
 * :3101), so it seeds and restores `model_spend`'s own row for today and a
 * `word_texts` row for a headword nothing else in this repo names.
 *
 * T17 (the Openverse deadline) drives a server too, but never that shared
 * one: it spawns and tears down its own `next dev`, so the one env variable
 * it needs lives only in that child process, never in a file anyone else's
 * checkout would have to carry.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { settleSessionSql } from "@repo/supabase-auth/settle";
import { PgDialect } from "drizzle-orm/pg-core";
import postgres from "postgres";

const BASE_URL = process.env.VOYAGER_BASE_URL ?? "http://localhost:3101";
// One port per lane's own app port, never a fixed one: two lanes running
// this check at once must not bind the same address.
const STUB_PORT = Number(new URL(BASE_URL).port || "3101") + 35_000;
const STUB_ENDPOINT = `http://127.0.0.1:${STUB_PORT}/v1/images/`;
// T17 needs `OPENVERSE_ENDPOINT_OVERRIDE` active, and no `.env.local` may
// carry it (AGENTS.md: that file is off limits, and a hand-edited copy is a
// test nobody else's checkout can pass). It spawns its own short-lived
// `next dev` instead, on a third port derived the same way, with the
// override set only in that child process's own environment — never
// written to a file, torn down before this script exits either way.
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const NEXT_BIN = resolvePath(APP_DIR, "../../node_modules/.bin/next");
const CHILD_PORT = Number(new URL(BASE_URL).port || "3101") + 20_000;
const CHILD_BASE_URL = `http://127.0.0.1:${CHILD_PORT}`;
// `next dev` rather than a production `next start`: no `.next` build is a
// precondition this way, so the assertion needs nothing beyond `npm ci` —
// the route itself has no client render to double-run, so dev mode changes
// nothing about what is being proven (unlike a Playwright spec).
const CHILD_READY_TIMEOUT_MS = 60_000;
// Concrete, photographable (`concreteness.generated.json`) and named
// nowhere else in this repo — free to claim without touching a real
// reader's cache or another check's fixture.
const SEARCH_HANG_HEADWORD = "otter";
const DOWNLOAD_HANG_HEADWORD = "walrus";
// Well over `OPENVERSE_TIMEOUT_MS` (5 s, `lib/word/openverse.ts`) for
// process and DB overhead, and nowhere near the 61 s this defect let the
// same hang run with no deadline at all.
const TIMEOUT_MARGIN_MS = 15_000;
// Real dictionary headword, absent from every spec and fixture this repo
// carries — free to seed and delete without touching anyone's cache.
const COLD_HEADWORD = "narwhal";
// Above any cap this repo would plausibly configure, so the cap assertion
// holds whether or not `WORD_TEXT_DAILY_CALL_CAP` is set on the server under
// test — the route's "no cap configured" fallback answers 204 too.
const OVER_CAP_CALLS = 1_000_000;

// Mirrors `EXCLUDED_HEADWORDS` in `scripts/build-concreteness.ts` — kept as
// a literal, not an import, because that script's output is the artefact
// under test, not a module this one can share without re-running the build.
const EXCLUDED_HEADWORDS = [
  "i", "me", "you", "he", "him", "her", "his", "she", "we", "us", "them",
  "yourself", "himself", "herself", "yourselves", "oneself",
  "time", "hour", "minute", "day", "week", "month", "year", "decade",
  "morning", "evening", "night", "midnight", "dawn", "dusk", "weekend", "yesterday",
  "season", "summer", "autumn", "winter",
  "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "war", "sale",
];
// Concrete nouns that must keep drawing a photo: the negative control the
// exclusion list must never touch.
const CONTROL_HEADWORDS = ["dog", "book", "apple"];

const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
  connection: { search_path: "reading, public" },
});

let failed = false;

function assert(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) failed = true;
}

// Mirrors `check-sync.ts`: no cause chain to walk outside drizzle, so the
// driver's own PostgresError is the thrown value.
function pgCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const { code } = error as { code: unknown };
  return typeof code === "string" ? code : undefined;
}

// The real `settleSessionSql` from `@repo/supabase-auth/settle` — the same
// one `withReaderDb` (`lib/session.ts`) uses — never a hand-rolled
// `set_config`. A `42P01` below would mean this landed wrong, not that the
// permission bit (`docs/TRAPS.md:895-911`).
async function enterAuthenticatedContext(tx: postgres.TransactionSql, subject: string): Promise<void> {
  const claims = JSON.stringify({ sub: subject, role: "authenticated", aud: "authenticated" });
  const settle = new PgDialect().sqlToQuery(settleSessionSql({ claims, searchPath: "reading, public" }));
  await tx.unsafe(settle.sql, settle.params as string[]);
}

// A savepoint per attempt: one 42501 must not abort the eleven statements
// after it, the way an unguarded statement would abort the whole transaction.
async function denied(
  tx: postgres.TransactionSql,
  label: string,
  fn: (sp: postgres.TransactionSql) => Promise<unknown>,
): Promise<void> {
  let code: string | undefined;
  await tx.savepoint((sp) => fn(sp)).catch((error: unknown) => {
    code = pgCode(error);
  });
  assert(label, code === "42501", `sqlstate = ${code ?? "none — the statement went through"}`);
}

type WordTextsRow = { headword: string; definition: string | null; example_en: string; example_es: string; model: string };
type ModelSpendRow = { day: string; calls: number; photos: number };
type PhotoRow = { headword: string; status: string };

async function requestPhoto(headword: string, baseUrl: string = BASE_URL): Promise<number> {
  const response = await fetch(`${baseUrl}/api/word/photo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ headword }),
  });
  return response.status;
}

// Drives `isPhotographableHeadword` (`lib/word/photo-cache.ts`) through the
// route, never by importing it: that module opens with `import "server-only"`,
// which throws under plain Node (the same reason
// `purge-unphotographable-photos.ts` keeps its own Postgres client).
//
// A control's `found` row is seeded only if none already exists — real
// cached photos (`dog`, `book`) are never overwritten — and only the
// seeded ones are removed again. Seeding makes a control's 200 independent
// of Openverse and the storage bucket alike: the route answers from
// Postgres on a cache hit, before either is ever reached, so CI's missing
// `SUPABASE_STORAGE_S3_*` cannot fail this check.
async function checkPhotoGate(): Promise<void> {
  const seeded: string[] = [];
  for (const headword of CONTROL_HEADWORDS) {
    const [existing] = await sql<PhotoRow[]>`select headword, status from reading.word_photos where headword = ${headword}`;
    if (existing) continue;
    await sql`
      insert into reading.word_photos (headword, status, object_path, width, height, author, licence, licence_url, source_url)
      values (${headword}, 'found', ${`${headword}.t16`}, 1, 1, 'T16 fixture', 'cc0',
              'https://example.invalid/licence', 'https://example.invalid/source')`;
    seeded.push(headword);
  }

  const failures: string[] = [];

  for (const headword of EXCLUDED_HEADWORDS) {
    const status = await requestPhoto(headword);
    const [row] = await sql<PhotoRow[]>`select headword, status from reading.word_photos where headword = ${headword}`;
    if (status !== 204 || row) failures.push(`${headword}: status=${status}, cached=${Boolean(row)} (expected 204, no row)`);
  }

  for (const headword of CONTROL_HEADWORDS) {
    const status = await requestPhoto(headword);
    if (status !== 200) failures.push(`${headword}: status=${status} (expected 200)`);
  }

  assert(
    "T16",
    failures.length === 0,
    failures.length === 0
      ? `${EXCLUDED_HEADWORDS.length} excluded words gated, ${CONTROL_HEADWORDS.length} controls kept their photo`
      : failures.join("; "),
  );

  for (const headword of seeded) {
    await sql`delete from reading.word_photos where headword = ${headword}`;
  }
}

// A stub Openverse: `SEARCH_HANG_HEADWORD`'s search never answers, and
// `DOWNLOAD_HANG_HEADWORD`'s search answers at once with a candidate whose
// thumbnail and full-size asset are the same never-answering address — one
// deadline exercised on each of `openverse.ts`'s two `fetch` calls.
// `requestsSeen` proves the request actually left for this stub rather than
// the real Openverse (a server under test missing the env override would
// otherwise pass or fail this check for the wrong reason).
function startOpenverseStub(): { server: Server; requestsSeen: string[] } {
  const requestsSeen: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", STUB_ENDPOINT);
    requestsSeen.push(url.pathname + url.search);
    if (url.pathname === "/v1/images/" && url.searchParams.get("q") === DOWNLOAD_HANG_HEADWORD) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          results: [
            {
              thumbnail: `http://127.0.0.1:${STUB_PORT}/photo.jpg`,
              url: `http://127.0.0.1:${STUB_PORT}/photo.jpg`,
              creator: "T17 stub",
              license: "cc0",
              license_url: "https://example.invalid/licence",
              foreign_landing_url: "https://example.invalid/source",
              width: 10,
              height: 10,
            },
          ],
        }),
      );
      return;
    }
    // Every other request — the hung search and both image downloads —
    // gets nothing back: only `AbortSignal.timeout` may end it.
  });
  return { server, requestsSeen };
}

// Spawns `next dev` directly, never through `npm run`, so there is exactly
// one process to signal and no intermediate npm to forward (or fail to
// forward) a kill to. `detached: true` puts it in its own process group,
// so cleanup can signal the group rather than leaving a compiler worker
// behind — Next's dev server spawns more than the one PID it prints.
function startChildApp(): { child: ChildProcess; output: string[] } {
  const output: string[] = [];
  const child = spawn(NEXT_BIN, ["dev", "--port", String(CHILD_PORT)], {
    cwd: APP_DIR,
    env: { ...process.env, OPENVERSE_ENDPOINT_OVERRIDE: STUB_ENDPOINT },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  return { child, output };
}

async function waitForChildReady(deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    try {
      await fetch(CHILD_BASE_URL, { signal: AbortSignal.timeout(2_000) });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

function stopChildApp(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Already gone — nothing left to signal.
  }
}

async function checkOpenverseTimeout(): Promise<void> {
  const { server, requestsSeen } = startOpenverseStub();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(STUB_PORT, "127.0.0.1", () => resolve());
  });

  const { child, output } = startChildApp();
  const failures: string[] = [];

  try {
    const ready = await waitForChildReady(Date.now() + CHILD_READY_TIMEOUT_MS);
    if (!ready) {
      failures.push(`the child app on :${CHILD_PORT} never answered — ${output.join("").slice(-1000) || "no output"}`);
    } else {
      const words = [SEARCH_HANG_HEADWORD, DOWNLOAD_HANG_HEADWORD];
      for (const headword of words) {
        await sql`delete from reading.word_photos where headword = ${headword}`;
      }

      for (const headword of words) {
        const started = Date.now();
        const status = await requestPhoto(headword, CHILD_BASE_URL);
        const elapsedMs = Date.now() - started;
        const [row] = await sql<PhotoRow[]>`select headword, status from reading.word_photos where headword = ${headword}`;
        if (status !== 204) failures.push(`${headword}: status=${status} (expected 204)`);
        if (elapsedMs >= TIMEOUT_MARGIN_MS) failures.push(`${headword}: took ${elapsedMs}ms (expected under ${TIMEOUT_MARGIN_MS}ms)`);
        if (row) failures.push(`${headword}: a "${row.status}" row was written (expected none, on a timeout)`);
      }

      if (!requestsSeen.some((seen) => seen.includes(`q=${SEARCH_HANG_HEADWORD}`))) {
        failures.push(`the stub never saw the search for "${SEARCH_HANG_HEADWORD}"`);
      }
      if (!requestsSeen.some((seen) => seen.startsWith("/photo.jpg"))) {
        failures.push(`the stub never saw a download for "${DOWNLOAD_HANG_HEADWORD}"'s candidate`);
      }

      for (const headword of words) {
        await sql`delete from reading.word_photos where headword = ${headword}`;
      }
    }
  } finally {
    stopChildApp(child);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  assert(
    "T17",
    failures.length === 0,
    failures.length === 0
      ? `both deadlines fired inside ${TIMEOUT_MARGIN_MS}ms and wrote no row, on a server this check started itself`
      : failures.join("; "),
  );
}

async function main() {
  const subject = crypto.randomUUID();
  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await enterAuthenticatedContext(tx, subject);

      await denied(tx, "T1", (sp) => sp`select 1 from reading.word_photos limit 1`);
      await denied(
        tx,
        "T2",
        (sp) => sp`insert into reading.word_photos (headword, status) values ('permcheck', 'none')`,
      );
      await denied(
        tx,
        "T3",
        (sp) => sp`update reading.word_photos set status = 'none' where headword = 'permcheck'`,
      );
      await denied(tx, "T4", (sp) => sp`delete from reading.word_photos where headword = 'permcheck'`);

      await denied(tx, "T5", (sp) => sp`select 1 from reading.word_texts limit 1`);
      await denied(
        tx,
        "T6",
        (sp) =>
          sp`insert into reading.word_texts (headword, example_en, example_es, model) values ('permcheck', 'x', 'y', 'z')`,
      );
      await denied(tx, "T7", (sp) => sp`update reading.word_texts set model = 'z' where headword = 'permcheck'`);
      await denied(tx, "T8", (sp) => sp`delete from reading.word_texts where headword = 'permcheck'`);

      await denied(tx, "T9", (sp) => sp`select 1 from reading.model_spend limit 1`);
      await denied(
        tx,
        "T10",
        (sp) => sp`insert into reading.model_spend (day, calls, photos) values (current_date + 999, 0, 0)`,
      );
      await denied(tx, "T11", (sp) => sp`update reading.model_spend set calls = calls where day = current_date`);
      await denied(tx, "T12", (sp) => sp`delete from reading.model_spend where day = current_date + 999`);

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const rel = await sql<{ relname: string; rowsecurity: boolean }[]>`
    select relname, relrowsecurity as rowsecurity
    from pg_class
    where oid in (
      'reading.word_photos'::regclass, 'reading.word_texts'::regclass, 'reading.model_spend'::regclass
    )`;
  assert(
    "T13",
    rel.length === 3 && rel.every((r) => r.rowsecurity === true),
    `rowsecurity = ${rel.map((r) => `${r.relname}:${r.rowsecurity}`).join(", ")}`,
  );

  const policies = await sql<{ tablename: string }[]>`
    select tablename from pg_policies
    where schemaname = 'reading' and tablename in ('word_photos', 'word_texts', 'model_spend')`;
  assert("T14", policies.length === 0, `policy count = ${policies.length}`);

  // The cap, without spending a cent: seed `model_spend` for today over any
  // plausible cap, seed a cold `word_texts` slot, then drive the real route.
  // A correct `POST /api/word/text` claims the cap before it ever reaches
  // OpenAI, so a real model call here is a defect in module 5, not this
  // script (dispatch note).
  const [priorTextRow] = await sql<WordTextsRow[]>`
    select * from reading.word_texts where headword = ${COLD_HEADWORD}`;
  if (priorTextRow) {
    await sql`delete from reading.word_texts where headword = ${COLD_HEADWORD}`;
  }

  const [priorSpendRow] = await sql<ModelSpendRow[]>`
    select day::text as day, calls, photos from reading.model_spend where day = current_date`;
  await sql`
    insert into reading.model_spend as ms (day, calls)
    values (current_date, ${OVER_CAP_CALLS})
    on conflict (day) do update set calls = ${OVER_CAP_CALLS}`;

  let status: number | undefined;
  let fetchError: string | undefined;
  try {
    const response = await fetch(`${BASE_URL}/api/word/text`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ headword: COLD_HEADWORD, needDefinition: true }),
    });
    status = response.status;
  } catch (error) {
    fetchError = error instanceof Error ? error.message : String(error);
  }

  const [afterTextRow] = await sql<WordTextsRow[]>`
    select * from reading.word_texts where headword = ${COLD_HEADWORD}`;
  const [afterSpendRow] = await sql<ModelSpendRow[]>`
    select calls from reading.model_spend where day = current_date`;
  const callsGrowth = (afterSpendRow?.calls ?? 0) - OVER_CAP_CALLS;

  assert(
    "T15",
    status === 204 && !afterTextRow && callsGrowth <= 1,
    `status = ${status ?? `fetch failed: ${fetchError}`}, new word_texts row = ${Boolean(afterTextRow)}, calls grew by ${callsGrowth}`,
  );

  // Clean up what T15 seeded, in this same run — never a truncate, never a
  // row this script did not write itself.
  if (afterTextRow) await sql`delete from reading.word_texts where headword = ${COLD_HEADWORD}`;
  if (priorTextRow) {
    await sql`
      insert into reading.word_texts (headword, definition, example_en, example_es, model)
      values (${priorTextRow.headword}, ${priorTextRow.definition}, ${priorTextRow.example_en}, ${priorTextRow.example_es}, ${priorTextRow.model})`;
  }
  if (priorSpendRow) {
    await sql`update reading.model_spend set calls = ${priorSpendRow.calls} where day = current_date`;
  } else {
    await sql`delete from reading.model_spend where day = current_date`;
  }

  await checkPhotoGate();
  await checkOpenverseTimeout();

  await sql.end();
  if (failed) process.exit(1);
}

main();
