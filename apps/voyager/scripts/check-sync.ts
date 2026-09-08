/**
 * Drives the seven policies on `reading.lookups` and `reading.devices`
 * against the real database — DELETE included — instead of asserting them
 * from the migration (AGENTS.md, "Verification").
 *
 * A single `sql.begin` holds every statement below and always throws at the
 * end to force a ROLLBACK. The two subjects are `randomUUID()`, their
 * `auth.users` rows are inserted inside that same transaction, and nothing
 * survives it: `npm run harness:census` does not move and
 * `scripts/harness/registry.ts` is never needed.
 */
import { randomUUID } from "node:crypto";

import postgres from "postgres";

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

// Nothing here goes through drizzle, so the driver's own PostgresError is the
// thrown value — no cause chain to walk, unlike `apps/orbit/lib/db-error.ts`.
function pgCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const { code } = error as { code: unknown };
  return typeof code === "string" ? code : undefined;
}

// Mirrors `withReaderDb` (`apps/voyager/lib/session.ts`): one statement, not
// four, and transaction-local (`true`), so re-pointing mid-transaction is
// safe — it never reaches across a reused connection (`docs/TRAPS.md:389`).
async function enterUserContext(tx: postgres.TransactionSql, subject: string): Promise<void> {
  const claims = JSON.stringify({ sub: subject, role: "authenticated", aud: "authenticated" });
  await tx`select
    set_config('request.jwt.claims', ${claims}, true),
    set_config('statement_timeout', '8000', true),
    set_config('search_path', 'reading, public', true),
    set_config('role', 'authenticated', true)`;
}

async function insertLookup(
  tx: postgres.TransactionSql,
  userId: string,
  deviceId: string,
  localId: number,
  text: string,
  onConflictDoNothing = false,
) {
  return tx`insert into reading.lookups
    (user_id, device_id, local_id, at, text, normalised, kind, outcome, senses, dictionary_ready, record_schema)
    values (${userId}, ${deviceId}, ${localId}, now(), ${text}, ${text}, 'word', 'exact', 0, true, 1)
    ${onConflictDoNothing ? tx`on conflict (user_id, device_id, local_id) do nothing` : tx``}`;
}

async function countLookups(tx: postgres.TransactionSql, userId: string, deviceId: string): Promise<string> {
  const [row] = await tx<{ count: string }[]>`
    select count(*)::text as count from reading.lookups where user_id = ${userId} and device_id = ${deviceId}`;
  return row.count;
}

async function countDevice(tx: postgres.TransactionSql, userId: string, deviceId: string): Promise<string> {
  const [row] = await tx<{ count: string }[]>`
    select count(*)::text as count from reading.devices where user_id = ${userId} and device_id = ${deviceId}`;
  return row.count;
}

async function main() {
  const subject = randomUUID();
  const intruder = randomUUID();
  const deviceSubject = randomUUID();
  // The intruder holds two devices, so S12 can prove that retiring one never
  // touches the other's rows — a device-scoped delete, not a user-scoped one.
  const deviceIntruderMain = randomUUID();
  const deviceIntruderOther = randomUUID();
  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      const [rel] = await tx<{ rowsecurity: boolean; forced: boolean }[]>`
        select relrowsecurity as rowsecurity, relforcerowsecurity as forced
        from pg_class where oid = 'reading.lookups'::regclass`;
      assert(
        "S1",
        rel.rowsecurity === true && rel.forced === true,
        `relrowsecurity = ${rel.rowsecurity}, relforcerowsecurity = ${rel.forced}`,
      );

      const strayGrants = await tx<{ grantee: string; table_name: string; privilege_type: string }[]>`
        select grantee, table_name, privilege_type
        from information_schema.role_table_grants
        where table_schema = 'reading' and table_name in ('lookups', 'devices')
          and grantee in ('anon', 'service_role')`;
      assert("S2", strayGrants.length === 0, `anon/service_role grants = ${strayGrants.length}`);

      const insertCols = await tx<{ column_name: string }[]>`
        select column_name from information_schema.column_privileges
        where table_schema = 'reading' and table_name = 'lookups'
          and grantee = 'authenticated' and privilege_type = 'INSERT'`;
      const cols = insertCols.map((r) => r.column_name);
      assert(
        "S3",
        cols.length === 15 && cols.includes("translation") && !cols.includes("received_at"),
        `${cols.length} insertable columns, translation = ${cols.includes("translation")}, received_at = ${cols.includes("received_at")}`,
      );

      await tx`insert into auth.users (id) values (${subject}), (${intruder})`;

      await enterUserContext(tx, subject);
      await insertLookup(tx, subject, deviceSubject, 1, "hello");
      const [ownRow] = await tx<{ user_id: string }[]>`
        select user_id from reading.lookups where user_id = ${subject} and device_id = ${deviceSubject} and local_id = 1`;
      assert("S4", ownRow?.user_id === subject, `row found = ${Boolean(ownRow)}`);

      await enterUserContext(tx, intruder);
      const [{ count: intruderSees }] = await tx<{ count: string }[]>`
        select count(*)::text as count from reading.lookups where user_id = ${subject}`;
      assert("S5", intruderSees === "0", `rows visible to the intruder = ${intruderSees}`);

      await enterUserContext(tx, subject);
      let foreignInsertCode: string | undefined;
      await tx
        .savepoint((sp) => insertLookup(sp, intruder, deviceSubject, 99, "forged"))
        .catch((error: unknown) => {
          foreignInsertCode = pgCode(error);
        });
      assert("S6", foreignInsertCode === "42501", `sqlstate = ${foreignInsertCode ?? "none"}`);

      const beforeReinsert = await countLookups(tx, subject, deviceSubject);
      await insertLookup(tx, subject, deviceSubject, 1, "hello", true);
      const afterReinsert = await countLookups(tx, subject, deviceSubject);
      assert("S7", beforeReinsert === afterReinsert, `before = ${beforeReinsert}, after = ${afterReinsert}`);

      let updateRows: number | undefined;
      let updateCode: string | undefined;
      await tx
        .savepoint(async (sp) => {
          const result = await sp`
            update reading.lookups set text = 'changed'
            where user_id = ${subject} and device_id = ${deviceSubject} and local_id = 1`;
          updateRows = result.count;
        })
        .catch((error: unknown) => {
          updateCode = pgCode(error);
        });
      assert(
        "S8",
        updateRows === 0 || updateCode !== undefined,
        `rows affected = ${updateRows ?? "n/a"}, sqlstate = ${updateCode ?? "none"}`,
      );

      await insertLookup(tx, subject, deviceSubject, 2, "second");
      await insertLookup(tx, subject, deviceSubject, 3, "third");
      // `::text` on both sides of every comparison below: postgres.js resolves
      // a bare string parameter's wire type from how the query uses it, and a
      // parameter Postgres calls `timestamptz` gets re-serialized through
      // `new Date(x).toISOString()` (`node_modules/postgres/src/types.js:31`),
      // which floors microseconds. Comparing text to text never asks for that
      // cast, so the cursor keeps the precision the column actually holds.
      const [cursorRow, laterRow] = await tx<{ local_id: number; received_at: string }[]>`
        select local_id, received_at::text as received_at from reading.lookups
        where user_id = ${subject} and device_id = ${deviceSubject} and local_id in (2, 3)
        order by local_id`;
      const nonDecreasing = cursorRow.received_at <= laterRow.received_at;
      const afterCursor = await tx<{ local_id: number }[]>`
        select local_id from reading.lookups
        where user_id = ${subject} and received_at::text > ${cursorRow.received_at}
        order by received_at asc limit 500`;
      const cursorExcludesDownloaded = !afterCursor.some((row) => row.local_id === cursorRow.local_id);
      assert(
        "S9",
        nonDecreasing && cursorExcludesDownloaded,
        `non-decreasing = ${nonDecreasing}, cursor excludes local_id ${cursorRow.local_id} = ${cursorExcludesDownloaded}`,
      );

      await tx`insert into reading.devices (user_id, device_id, label) values (${subject}, ${deviceSubject}, 'reader A device')`;

      const lookupsBeforeOwn = await countLookups(tx, subject, deviceSubject);
      const deviceBeforeOwn = await countDevice(tx, subject, deviceSubject);
      // The retire statement itself, unchanged from module 20's `retireDevice`.
      await tx`
        with gone as (
          delete from reading.lookups where user_id = ${subject} and device_id = ${deviceSubject} returning 1
        )
        delete from reading.devices where user_id = ${subject} and device_id = ${deviceSubject}
        returning (select count(*) from gone) as lookups`;
      const lookupsAfterOwn = await countLookups(tx, subject, deviceSubject);
      const deviceAfterOwn = await countDevice(tx, subject, deviceSubject);
      assert(
        "S10",
        lookupsBeforeOwn === "3" && lookupsAfterOwn === "0" && deviceBeforeOwn === "1" && deviceAfterOwn === "0",
        `lookups ${lookupsBeforeOwn} -> ${lookupsAfterOwn}, device row ${deviceBeforeOwn} -> ${deviceAfterOwn}`,
      );

      await enterUserContext(tx, intruder);
      await tx`insert into reading.devices (user_id, device_id, label) values (${intruder}, ${deviceIntruderMain}, 'reader B device main')`;
      await tx`insert into reading.devices (user_id, device_id, label) values (${intruder}, ${deviceIntruderOther}, 'reader B device other')`;
      await insertLookup(tx, intruder, deviceIntruderMain, 1, "b1");
      await insertLookup(tx, intruder, deviceIntruderMain, 2, "b2");
      await insertLookup(tx, intruder, deviceIntruderOther, 1, "c1");

      // The attack: the reader A session runs the retire statement narrowed
      // only by `device_id`, no `user_id` — proving the policy stops it, not
      // the `where` clause the app happens to also send (module 20's note).
      await enterUserContext(tx, subject);
      const attack = await tx<{ lookups: string }[]>`
        with gone as (
          delete from reading.lookups where device_id = ${deviceIntruderMain} returning 1
        )
        delete from reading.devices where device_id = ${deviceIntruderMain}
        returning (select count(*) from gone) as lookups`;

      await enterUserContext(tx, intruder);
      const mainLookupsAfterAttack = await countLookups(tx, intruder, deviceIntruderMain);
      const mainDeviceAfterAttack = await countDevice(tx, intruder, deviceIntruderMain);
      assert(
        "S11",
        attack.length === 0 && mainLookupsAfterAttack === "2" && mainDeviceAfterAttack === "1",
        `outer delete rows = ${attack.length}, B's rows survive = ${mainLookupsAfterAttack} lookups / ${mainDeviceAfterAttack} device`,
      );

      const otherLookupsBefore = await countLookups(tx, intruder, deviceIntruderOther);
      const otherDeviceBefore = await countDevice(tx, intruder, deviceIntruderOther);
      // The legitimate retirement: same statement, run by its owner.
      const [retiredMain] = await tx<{ lookups: string }[]>`
        with gone as (
          delete from reading.lookups where user_id = ${intruder} and device_id = ${deviceIntruderMain} returning 1
        )
        delete from reading.devices where user_id = ${intruder} and device_id = ${deviceIntruderMain}
        returning (select count(*) from gone) as lookups`;
      const otherLookupsAfter = await countLookups(tx, intruder, deviceIntruderOther);
      const otherDeviceAfter = await countDevice(tx, intruder, deviceIntruderOther);
      assert(
        "S12",
        retiredMain?.lookups === "2" && otherLookupsBefore === otherLookupsAfter && otherDeviceBefore === otherDeviceAfter,
        `main device retired ${retiredMain?.lookups} lookups; other device untouched: lookups ${otherLookupsBefore} -> ${otherLookupsAfter}, device ${otherDeviceBefore} -> ${otherDeviceAfter}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  await sql.end();
  if (failed) process.exit(1);
}

main();
