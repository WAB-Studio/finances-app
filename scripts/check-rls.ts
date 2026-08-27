// Proves the access policies actually fire. Runs outside Next.js under Node 22
// type stripping, so it reads `process.env` and imports nothing from the app.
import { randomUUID } from "node:crypto";

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

let failed = false;

function assert(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) failed = true;
}

// A missing fixture is not a policy failure — it never touches `failed`.
function skip(label: string, reason: string) {
  console.log(`SKIP  ${label} — ${reason}`);
}

function pgCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

// Mirrors `withUserDb`: claims first, then the role switch, both transaction-local.
// Idempotent — calling it again mid-transaction re-points `auth.uid()` at a new subject.
async function enterUserContext(
  tx: postgres.TransactionSql,
  subject: string,
): Promise<void> {
  const claims = JSON.stringify({
    sub: subject,
    role: "authenticated",
    aud: "authenticated",
  });
  await tx`select set_config('request.jwt.claims', ${claims}, true)`;
  await tx`select set_config('statement_timeout', '8000', true)`;
  await tx`select set_config('role', 'authenticated', true)`;
}

async function main() {
  const subject = randomUUID();
  const intruder = randomUUID();

  const [relOutside] = await sql<{ rowsecurity: boolean; forced: boolean }[]>`
    select relrowsecurity as rowsecurity, relforcerowsecurity as forced
    from pg_class where oid = 'public.app_users'::regclass`;

  assert(
    "1. row security enabled",
    relOutside.rowsecurity === true,
    `pg_class.relrowsecurity = ${relOutside.rowsecurity}`,
  );

  await sql.begin(async (tx) => {
    await enterUserContext(tx, subject);

    const [{ current_user: currentUser }] = await tx<
      { current_user: string }[]
    >`select current_user`;
    assert(
      "2. role switch took effect",
      currentUser === "authenticated",
      `current_user = ${currentUser}`,
    );

    const [{ rolbypassrls }] = await tx<{ rolbypassrls: boolean }[]>`
      select rolbypassrls from pg_roles where rolname = current_user`;
    const [{ uid }] = await tx<{ uid: string | null }[]>`select auth.uid() as uid`;
    assert(
      "3. current role cannot bypass and carries the injected identity",
      rolbypassrls === false && uid === subject,
      `rolbypassrls = ${rolbypassrls}, auth.uid() = ${uid}`,
    );

    const [{ count }] = await tx<{ count: string }[]>`
      select count(*)::text as count from app_users`;
    assert(
      "4. select sees no other user's row",
      count === "0",
      `visible rows = ${count}`,
    );
  });

  await sql
    .begin(async (tx) => {
      await enterUserContext(tx, subject);
      await tx`insert into app_users (id) values (${intruder})`;
      assert(
        "5. insert for another id rejected",
        false,
        "the insert succeeded, which it must not",
      );
    })
    .catch((error: unknown) => {
      // 42501 = policy violation, 23503 = foreign key; either proves the write is barred.
      const code = (error as { code?: string }).code;
      assert(
        "5. insert for another id rejected",
        code === "42501" || code === "23503",
        `sqlstate ${code ?? "none"}`,
      );
    });

  const [{ current_user: afterUser }] = await sql<
    { current_user: string }[]
  >`select current_user`;
  assert(
    "6. role unwound with the transaction",
    afterUser === "postgres",
    `current_user = ${afterUser}`,
  );

  assert(
    "7. row security forced on the owner",
    relOutside.forced === true,
    `pg_class.relforcerowsecurity = ${relOutside.forced}`,
  );

  const [{ rolbypassrls: ownerBypasses }] = await sql<
    { rolbypassrls: boolean }[]
  >`select rolbypassrls from pg_roles where rolname = 'postgres'`;
  const [{ count: ownerCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from app_users`;

  console.log("");
  console.log(
    `REPORT  postgres.rolbypassrls = ${ownerBypasses} — ` +
      (ownerBypasses
        ? "the owner sees every row, FORCE buys nothing, and the role switch is the sole guarantee."
        : "FORCE is live and the owner is subject to the policies too."),
  );
  console.log(
    `REPORT  rows visible to postgres outside any role switch = ${ownerCount}.`,
  );
  console.log(
    "REPORT  assertion 4 alone is worthless against an empty table; 2, 3 and 7 are what give it teeth.",
  );

  await checkFundPolicies();
}

// Assertions 9-20: funds, members, accounts, categories. A `postgres` read, since it carries
// BYPASSRLS, is the only way to find a fixture without granting one through the app itself.
async function checkFundPolicies() {
  console.log("");
  const [fixtureUser] = await sql<{ id: string }[]>`select id from app_users limit 1`;
  const labels = [
    "9. insert as owner: the trigger, not the caller, sets created_at",
    "10. owner membership insert succeeds",
    "11. a second membership insert into a claimed fund is rejected",
    "12. a member inserts an account and a category into their own fund",
    "13. a member's counts equal exactly what was written",
    "14. an intruder's counts are all zero",
    "15. an intruder cannot insert an account into the probe fund",
    "16. an intruder cannot claim the probe fund",
    "17. no role may update a fund — there is no UPDATE grant",
    "18. removing the last owner is refused",
    "19. removing the fund lifts the guard and cascades",
    "20. the rolled-back transaction leaves no trace",
  ];

  if (!fixtureUser) {
    for (const label of labels) skip(label, "no `app_users` row: sign in once, then re-run");
    return;
  }

  const realUser = fixtureUser.id;
  const intruder = randomUUID();
  let probeId = "";

  const forcedRollback = Symbol("forced rollback");
  await sql
    .begin(async (tx) => {
      await enterUserContext(tx, realUser);

      // No `returning` here: an unclaimed fund fails its own SELECT policy, and Postgres
      // enforces that policy on a RETURNING row just as it would on a plain select. The id is
      // ours to supply — `funds_insert_any`'s check is `true` — so membership can follow at once.
      probeId = randomUUID();
      await tx`insert into funds (id, name, created_at)
        values (${probeId}, 'rls probe', timestamptz '2000-01-01T00:00:00Z')`;

      await tx`insert into members (fund_id, user_id, name, role)
        values (${probeId}, ${realUser}, 'rls probe owner', 'owner')`;

      // Now a member, so the fund is visible: read back what the trigger actually stored.
      const [fund] = await tx<
        { created_at: Date; updated_at: Date }[]
      >`select created_at, updated_at from funds where id = ${probeId}`;
      const bornJustNow = Date.now() - fund.created_at.getTime() < 60_000;
      assert(
        labels[0],
        bornJustNow && fund.created_at.getTime() === fund.updated_at.getTime(),
        `created_at = ${fund.created_at.toISOString()}, updated_at = ${fund.updated_at.toISOString()}`,
      );
      assert(labels[1], true, "owner row inserted");

      // A savepoint, not a bare `tx`, so the expected rejection doesn't poison the shared transaction.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into members (fund_id, user_id, name, role)
            values (${probeId}, ${realUser}, 'rls probe second owner', 'owner')`;
          assert(labels[2], false, "the second insert succeeded, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[2], pgCode(error) === "42501", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      await tx`insert into accounts (fund_id, member_id, name, kind, initial_balance_on)
        values (${probeId}, null, 'rls probe account', 'asset', (now() at time zone 'America/Bogota')::date)`;
      await tx`insert into categories (fund_id, name, kind)
        values (${probeId}, 'rls probe category', 'expense')`;
      assert(labels[3], true, "account and category inserted as a member");

      const counts = async () => {
        const [row] = await tx<{ f: string; m: string; a: string; c: string }[]>`
          select
            (select count(*)::text from funds) as f,
            (select count(*)::text from members) as m,
            (select count(*)::text from accounts) as a,
            (select count(*)::text from categories) as c`;
        return row;
      };

      const memberCounts = await counts();
      assert(
        labels[4],
        Object.values(memberCounts).every((n) => n === "1"),
        `funds=${memberCounts.f} members=${memberCounts.m} accounts=${memberCounts.a} categories=${memberCounts.c}`,
      );

      await enterUserContext(tx, intruder);
      const intruderCounts = await counts();
      assert(
        labels[5],
        Object.values(intruderCounts).every((n) => n === "0"),
        `funds=${intruderCounts.f} members=${intruderCounts.m} accounts=${intruderCounts.a} categories=${intruderCounts.c}`,
      );

      await tx
        .savepoint(async (sp) => {
          await sp`insert into accounts (fund_id, member_id, name, kind, initial_balance_on)
            values (${probeId}, null, 'intruder probe account', 'asset', (now() at time zone 'America/Bogota')::date)`;
          assert(labels[6], false, "the intruder's insert succeeded, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[6], pgCode(error) === "42501", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      await tx
        .savepoint(async (sp) => {
          await sp`insert into members (fund_id, user_id, name, role)
            values (${probeId}, ${intruder}, 'intruder probe', 'owner')`;
          assert(labels[7], false, "the intruder's claim succeeded, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[7], pgCode(error) === "42501", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      await enterUserContext(tx, realUser);
      await tx
        .savepoint(async (sp) => {
          await sp`update funds set name = 'x' where id = ${probeId}`;
          assert(labels[8], false, "the update succeeded, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[8], pgCode(error) === "42501", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // `RESET ROLE` reverts to the session user, `postgres`; unlike `SET ROLE` it needs no grant.
      await tx`reset role`;

      await tx
        .savepoint(async (sp) => {
          await sp`delete from members where fund_id = ${probeId}`;
          await sp`set constraints all immediate`;
          assert(labels[9], false, "removing the last owner succeeded, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[9], pgCode(error) === "23514", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // The delete succeeds, so only a thrown sentinel makes the savepoint roll back too.
      await tx
        .savepoint(async (sp) => {
          await sp`delete from funds where id = ${probeId}`;
          await sp`set constraints all immediate`;
          throw forcedRollback;
        })
        .then(
          () => assert(labels[10], false, "the savepoint committed instead of rolling back"),
          (error: unknown) => {
            const ok = error === forcedRollback;
            assert(labels[10], ok, ok ? "cascade removed the members; the guard stood down" : `unexpected error ${pgCode(error) ?? String(error)}`);
          },
        );

      // Forces `sql.begin` to issue ROLLBACK: nothing this function wrote may survive it.
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterFundUser }] = await sql<
    { current_user: string }[]
  >`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from funds where name = 'rls probe'`;
  assert(
    labels[11],
    afterFundUser === "postgres" && probeCount === "0",
    `current_user = ${afterFundUser}, rows named 'rls probe' = ${probeCount}`,
  );
}

try {
  await main();
} catch (error) {
  console.error("FAIL  the check aborted —", error);
  failed = true;
} finally {
  await sql.end();
}

process.exit(failed ? 1 : 0);
