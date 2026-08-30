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

  await checkRepivotPolicies();
  await checkLedgerPolicies();
  await checkAnalyticsAggregates();
  await checkBudgetPolicies();
  await checkPlannedPaymentPolicies();
  await checkSavingsGoalPolicies();
}

// Assertions 9-26: the repivoted schema. A group holds accounts and categories a user XOR a group
// owns; read is universal inside the group, write is bounded to own-or-shared, and the leader
// manages the group's own categories. Fixtures are seeded through the app's own policies and rolled back.
async function checkRepivotPolicies() {
  console.log("");
  // Two fresh identities the section seeds itself, so it runs on an empty dev DB with no prior sign-in.
  // Both `auth.users` and `app_users` rows are inserted as the owner inside the transaction below and
  // roll back with it. Neither holds a live membership, so the one-group-per-user index leaves the
  // leader claim free to land.
  const leaderUser = randomUUID();
  const memberUser = randomUUID();

  const soloLabels = [
    "9. an account with both an owner and a group is refused",
    "10. an account with neither an owner nor a group is refused",
    "11. a personal account marked shared is refused",
    "12. a group whose cash_mode is neither value is refused",
    "13. a second live membership for a claimed user is refused",
    "14. a category with both an owner and a group is refused",
    "15. a category with neither an owner nor a group is refused",
    "16. deleting the sole leader while the group survives is refused",
  ];
  const pairLabels = [
    "17. a member reads another member's personal account",
    "18. a member cannot mint an account owned by another user",
    "19. a member's update and delete of another's personal account touch nothing",
    "20. a member writes their own account and the shared group account",
    "21. the leader reads a member's personal account",
    "22. the leader's update and delete of that account touch nothing",
    "23. a member reads a group category and the leader a member's personal one",
    "24. a personal category yields to its owner and to no one else",
    "25. a group category yields to the leader and to no plain member",
  ];
  const tailLabel = "26. the rolled-back transaction leaves no trace";

  const groupId = randomUUID();
  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      // Seed the two base identities as the owner before any role switch: `auth.users` is the FK target
      // for `app_users`, and both are needed before the app's own policies can seed group fixtures.
      await tx`insert into auth.users (id) values (${leaderUser}), (${memberUser})`;
      await tx`insert into app_users (id) values (${leaderUser}), (${memberUser})`;

      await enterUserContext(tx, leaderUser);

      // The group, its leader, one personal account, one shared group account and one group category:
      // the id is supplied client-side because an unclaimed group fails its own SELECT policy.
      await tx`insert into groups (id, name, cash_mode)
        values (${groupId}, 'rls repivot', 'shared')`;
      const [{ id: leaderMembership }] = await tx<{ id: string }[]>`
        insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${leaderUser}, 'rls repivot leader', 'leader') returning id`;
      const [{ id: leaderAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls repivot leader cash', 'asset',
          (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: sharedAccount }] = await tx<{ id: string }[]>`
        insert into accounts (group_id, is_shared, name, kind, initial_balance_on)
        values (${groupId}, true, 'rls repivot shared cash', 'asset',
          (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: groupCategory }] = await tx<{ id: string }[]>`
        insert into categories (group_id, name, kind)
        values (${groupId}, 'rls repivot group category', 'expense') returning id`;

      // 9-11: the accounts check constraints. Each row is otherwise writable, so only the CHECK can reject it.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into accounts (owner_user_id, group_id, name, kind, initial_balance_on)
            values (${leaderUser}, ${groupId}, 'rls repivot both', 'asset',
              (now() at time zone 'America/Bogota')::date)`;
          assert(soloLabels[0], false, "both an owner and a group landed, which it must not");
        })
        .catch((error: unknown) => {
          assert(soloLabels[0], pgCode(error) === "23514", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      await tx
        .savepoint(async (sp) => {
          await sp`insert into accounts (name, kind, initial_balance_on)
            values ('rls repivot neither', 'asset', (now() at time zone 'America/Bogota')::date)`;
          assert(soloLabels[1], false, "neither an owner nor a group landed, which it must not");
        })
        .catch((error: unknown) => {
          // 42501 = the INSERT WITH CHECK fires first, 23514 = the table CHECK; either bars the row.
          const code = pgCode(error);
          assert(soloLabels[1], code === "42501" || code === "23514", `sqlstate ${code ?? "none"}`);
        });

      await tx
        .savepoint(async (sp) => {
          await sp`insert into accounts (owner_user_id, is_shared, name, kind, initial_balance_on)
            values (${leaderUser}, true, 'rls repivot personal shared', 'asset',
              (now() at time zone 'America/Bogota')::date)`;
          assert(soloLabels[2], false, "a shared personal account landed, which it must not");
        })
        .catch((error: unknown) => {
          assert(soloLabels[2], pgCode(error) === "23514", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // 12: the cash_mode domain check on groups.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into groups (id, name, cash_mode)
            values (${randomUUID()}, 'rls repivot bad mode', 'weekly')`;
          assert(soloLabels[3], false, "an unknown cash_mode landed, which it must not");
        })
        .catch((error: unknown) => {
          assert(soloLabels[3], pgCode(error) === "23514", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // 13: the one-group-per-user unique index. RLS admits the leader claim on a fresh group; the index refuses it.
      await tx
        .savepoint(async (sp) => {
          const secondGroup = randomUUID();
          await sp`insert into groups (id, name, cash_mode)
            values (${secondGroup}, 'rls repivot second group', 'shared')`;
          await sp`insert into group_members (group_id, user_id, name, role)
            values (${secondGroup}, ${leaderUser}, 'rls repivot double claim', 'leader')`;
          assert(soloLabels[4], false, "a second live membership landed, which it must not");
        })
        .catch((error: unknown) => {
          assert(soloLabels[4], pgCode(error) === "23505", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // 14-15: the categories owner-XOR-group check, both rows otherwise writable by the leader.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into categories (owner_user_id, group_id, name, kind)
            values (${leaderUser}, ${groupId}, 'rls repivot cat both', 'expense')`;
          assert(soloLabels[5], false, "both an owner and a group landed, which it must not");
        })
        .catch((error: unknown) => {
          assert(soloLabels[5], pgCode(error) === "23514", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      await tx
        .savepoint(async (sp) => {
          await sp`insert into categories (name, kind) values ('rls repivot cat neither', 'expense')`;
          assert(soloLabels[6], false, "neither an owner nor a group landed, which it must not");
        })
        .catch((error: unknown) => {
          // 42501 = the INSERT WITH CHECK fires first, 23514 = the table CHECK; either bars the row.
          const code = pgCode(error);
          assert(soloLabels[6], code === "42501" || code === "23514", `sqlstate ${code ?? "none"}`);
        });

      // 16: the keep-leader guard. The write policies forbid dropping your own row, so this reaches past
      // them as `postgres`; `set constraints all immediate` forces the deferred trigger to fire now.
      await tx
        .savepoint(async (sp) => {
          await sp`reset role`;
          await sp`delete from group_members where id = ${leaderMembership}`;
          await sp`set constraints all immediate`;
          assert(soloLabels[7], false, "the group kept no leader and the delete stood, which it must not");
        })
        .catch((error: unknown) => {
          assert(soloLabels[7], pgCode(error) === "23514", `sqlstate ${pgCode(error) ?? "none"}`);
        });
      await enterUserContext(tx, leaderUser);

      // A second member with a login: no policy lets one member hand another their login, so seed it as `postgres`.
      await tx`reset role`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${memberUser}, 'rls repivot member', 'member')`;

      await enterUserContext(tx, memberUser);
      const [{ id: memberAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${memberUser}, 'rls repivot member cash', 'asset',
          (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: memberCategory }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${memberUser}, 'rls repivot member category', 'expense') returning id`;

      // 17: universal read — a member sees another member's personal account through the group they share.
      const [{ count: memberSeesLeader }] = await tx<{ count: string }[]>`
        select count(*)::text as count from accounts where id = ${leaderAccount}`;
      assert(pairLabels[0], memberSeesLeader === "1", `visible rows = ${memberSeesLeader}`);

      // 18: the bounded write — a member may not mint an account owned by someone else.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into accounts (owner_user_id, name, kind, initial_balance_on)
            values (${leaderUser}, 'rls repivot forged', 'asset',
              (now() at time zone 'America/Bogota')::date)`;
          assert(pairLabels[1], false, "a member forged an account for the leader, which it must not");
        })
        .catch((error: unknown) => {
          assert(pairLabels[1], pgCode(error) === "42501", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // 19: the same bound on update and delete — the row is filtered out, so both commands touch nothing.
      const memberUpdate = await tx`update accounts set name = 'x' where id = ${leaderAccount}`;
      const memberDelete = await tx`delete from accounts where id = ${leaderAccount}`;
      assert(
        pairLabels[2],
        memberUpdate.count === 0 && memberDelete.count === 0,
        `update rows = ${memberUpdate.count}, delete rows = ${memberDelete.count}`,
      );

      // 20: what a member may write — their own account, and any account the group marked shared.
      const ownWrite = await tx`update accounts set name = 'rls repivot member cash, renamed'
        where id = ${memberAccount}`;
      const sharedWrite = await tx`update accounts set name = 'rls repivot shared cash, renamed'
        where id = ${sharedAccount}`;
      assert(
        pairLabels[3],
        ownWrite.count === 1 && sharedWrite.count === 1,
        `own rows = ${ownWrite.count}, shared rows = ${sharedWrite.count}`,
      );

      // 21-22: the leader reads a member's account but holds no write exception over it.
      await enterUserContext(tx, leaderUser);
      const [{ count: leaderSeesMember }] = await tx<{ count: string }[]>`
        select count(*)::text as count from accounts where id = ${memberAccount}`;
      assert(pairLabels[4], leaderSeesMember === "1", `visible rows = ${leaderSeesMember}`);
      const leaderUpdate = await tx`update accounts set name = 'x' where id = ${memberAccount}`;
      const leaderDelete = await tx`delete from accounts where id = ${memberAccount}`;
      assert(
        pairLabels[5],
        leaderUpdate.count === 0 && leaderDelete.count === 0,
        `update rows = ${leaderUpdate.count}, delete rows = ${leaderDelete.count}`,
      );

      // 23: universal read of categories, both directions — a member into the group's, the leader into a personal one.
      await enterUserContext(tx, memberUser);
      const [{ count: memberSeesGroupCat }] = await tx<{ count: string }[]>`
        select count(*)::text as count from categories where id = ${groupCategory}`;
      await enterUserContext(tx, leaderUser);
      const [{ count: leaderSeesMemberCat }] = await tx<{ count: string }[]>`
        select count(*)::text as count from categories where id = ${memberCategory}`;
      assert(
        pairLabels[6],
        memberSeesGroupCat === "1" && leaderSeesMemberCat === "1",
        `member→group = ${memberSeesGroupCat}, leader→personal = ${leaderSeesMemberCat}`,
      );

      // 24: a personal category bends to its owner, not to the leader of the group.
      const leaderOnMemberCat = await tx`update categories set name = 'x' where id = ${memberCategory}`;
      await enterUserContext(tx, memberUser);
      const ownerOnMemberCat = await tx`update categories set name = 'rls repivot member category, renamed'
        where id = ${memberCategory}`;
      assert(
        pairLabels[7],
        leaderOnMemberCat.count === 0 && ownerOnMemberCat.count === 1,
        `leader rows = ${leaderOnMemberCat.count}, owner rows = ${ownerOnMemberCat.count}`,
      );

      // 25: a group category bends to the leader, not to a plain member.
      const memberOnGroupCat = await tx`update categories set name = 'x' where id = ${groupCategory}`;
      await enterUserContext(tx, leaderUser);
      const leaderOnGroupCat = await tx`update categories set name = 'rls repivot group category, renamed'
        where id = ${groupCategory}`;
      assert(
        pairLabels[8],
        memberOnGroupCat.count === 0 && leaderOnGroupCat.count === 1,
        `member rows = ${memberOnGroupCat.count}, leader rows = ${leaderOnGroupCat.count}`,
      );

      // Forces `sql.begin` to issue ROLLBACK: nothing this function wrote may survive it.
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterRepivotUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from groups where name = 'rls repivot'`;
  assert(
    tailLabel,
    afterRepivotUser === "postgres" && probeCount === "0",
    `current_user = ${afterRepivotUser}, rows named 'rls repivot' = ${probeCount}`,
  );
}

// Assertions 27-36: the ledger. A movement's scope and `kind` are the trigger's, not the caller's;
// write is bounded to own-or-shared accounts; income and expense carry splits that sum to the amount
// while a transfer carries none; and `account_balances` derives the balance from the movements.
// Every fixture is seeded through the app's own policies inside a transaction that rolls back.
async function checkLedgerPolicies() {
  console.log("");
  const leaderUser = randomUUID();
  const memberUser = randomUUID();
  const groupId = randomUUID();

  const labels = [
    "27. a writable movement inserts and holds the trigger's scope and kind, not the caller's",
    "28. a movement touching another member's personal account is refused",
    "29. kind follows the null pattern of from/to",
    "30. an income whose splits do not sum to its amount is refused at commit",
    "31. an income committed with no split is refused at commit",
    "32. a transfer carrying a split is refused",
    "33. a split whose category sits in another scope is refused",
    "34. a split whose category is of the wrong kind is refused",
    "35. a member reads a group movement and another member's personal movement",
    "36. account_balances returns the initial balance plus the net of movements",
  ];
  const tailLabel = "37. the rolled-back ledger transaction leaves no trace";

  const forcedRollback = Symbol("forced rollback");
  const kindRollback = Symbol("kind rollback");

  await sql
    .begin(async (tx) => {
      // Base identities and group, seeded as the owner before any role switch.
      await tx`insert into auth.users (id) values (${leaderUser}), (${memberUser})`;
      await tx`insert into app_users (id) values (${leaderUser}), (${memberUser})`;

      await enterUserContext(tx, leaderUser);
      await tx`insert into groups (id, name, cash_mode) values (${groupId}, 'rls ledger', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${leaderUser}, 'rls ledger leader', 'leader')`;

      const [{ id: leaderAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls ledger leader cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: leaderAccountB }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls ledger leader savings', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: sharedAccount }] = await tx<{ id: string }[]>`
        insert into accounts (group_id, is_shared, name, kind, initial_balance_on)
        values (${groupId}, true, 'rls ledger shared cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: groupIncomeCat }] = await tx<{ id: string }[]>`
        insert into categories (group_id, name, kind)
        values (${groupId}, 'rls ledger group income', 'income') returning id`;

      // A second member with a login: seed the membership as the owner, no policy hands one out.
      await tx`reset role`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${memberUser}, 'rls ledger member', 'member')`;

      await enterUserContext(tx, memberUser);
      const [{ id: memberAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${memberUser}, 'rls ledger member cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: balAccountA }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_cents, initial_balance_on)
        values (${memberUser}, 'rls ledger balance A', 'asset', 100000, (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: balAccountB }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${memberUser}, 'rls ledger balance B', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: memberIncomeCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${memberUser}, 'rls ledger member income', 'income') returning id`;
      const [{ id: memberExpenseCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${memberUser}, 'rls ledger member expense', 'expense') returning id`;

      // 27: a movement whose from/to are both writable inserts; the trigger, not the caller, owns
      // scope and kind. A transfer touching the shared account is group-scoped (group wins).
      await enterUserContext(tx, leaderUser);
      const [txnGroup] = await tx<
        { id: string; owner_user_id: string | null; group_id: string | null; kind: string; created_by: string }[]
      >`insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${leaderAccount}, ${sharedAccount}, 5000, (now() at time zone 'America/Bogota')::date)
        returning id, owner_user_id, group_id, kind, created_by`;
      assert(
        labels[0],
        txnGroup.group_id === groupId &&
          txnGroup.owner_user_id === null &&
          txnGroup.kind === "transfer" &&
          txnGroup.created_by === leaderUser,
        `group_id = ${txnGroup.group_id}, owner = ${txnGroup.owner_user_id}, kind = ${txnGroup.kind}, created_by = ${txnGroup.created_by === leaderUser}`,
      );

      // A personal-scope movement of the leader, kept for the read test below.
      const [{ id: txnLeaderPersonal }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${leaderAccountB}, ${leaderAccount}, 2000, (now() at time zone 'America/Bogota')::date) returning id`;

      // 28: the bounded write — a member may not book a movement out of the leader's personal account.
      await enterUserContext(tx, memberUser);
      await tx
        .savepoint(async (sp) => {
          await sp`insert into transactions (from_account_id, amount_cents, occurred_at)
            values (${leaderAccount}, 5000, (now() at time zone 'America/Bogota')::date)`;
          assert(labels[1], false, "a member booked against the leader's account, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[1], pgCode(error) === "42501", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // 29: kind is generated from which side is null. Rolled back so its splitless rows never reach commit.
      const kinds: { income?: string; expense?: string; transfer?: string } = {};
      await tx
        .savepoint(async (sp) => {
          const [inc] = await sp<{ kind: string }[]>`insert into transactions (to_account_id, amount_cents, occurred_at)
            values (${memberAccount}, 5000, (now() at time zone 'America/Bogota')::date) returning kind`;
          const [exp] = await sp<{ kind: string }[]>`insert into transactions (from_account_id, amount_cents, occurred_at)
            values (${memberAccount}, 5000, (now() at time zone 'America/Bogota')::date) returning kind`;
          const [xfer] = await sp<{ kind: string }[]>`insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
            values (${memberAccount}, ${balAccountA}, 5000, (now() at time zone 'America/Bogota')::date) returning kind`;
          kinds.income = inc.kind;
          kinds.expense = exp.kind;
          kinds.transfer = xfer.kind;
          throw kindRollback;
        })
        .catch((error: unknown) => {
          if (error !== kindRollback) throw error;
        });
      assert(
        labels[2],
        kinds.income === "income" && kinds.expense === "expense" && kinds.transfer === "transfer",
        `income = ${kinds.income}, expense = ${kinds.expense}, transfer = ${kinds.transfer}`,
      );

      // 30: the deferred sum check. The split matches scope and kind, so only the total can reject it,
      // and `set constraints all immediate` forces the deferred trigger to fire now.
      await tx
        .savepoint(async (sp) => {
          const [{ id: txn }] = await sp<{ id: string }[]>`
            insert into transactions (to_account_id, amount_cents, occurred_at)
            values (${memberAccount}, 5000, (now() at time zone 'America/Bogota')::date) returning id`;
          await sp`insert into transaction_splits (transaction_id, category_id, amount_cents)
            values (${txn}, ${memberIncomeCat}, 3000)`;
          await sp`set constraints all immediate`;
          assert(labels[3], false, "splits that miss the amount stood, which they must not");
        })
        .catch((error: unknown) => {
          assert(labels[3], pgCode(error) === "23514", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // 31: an income with no split at all is equally refused at commit.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into transactions (to_account_id, amount_cents, occurred_at)
            values (${memberAccount}, 5000, (now() at time zone 'America/Bogota')::date)`;
          await sp`set constraints all immediate`;
          assert(labels[4], false, "a splitless income stood, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[4], pgCode(error) === "23514", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // 32: a transfer names no category, so any split on it is rejected the moment it lands.
      await tx
        .savepoint(async (sp) => {
          const [{ id: txn }] = await sp<{ id: string }[]>`
            insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
            values (${memberAccount}, ${balAccountA}, 5000, (now() at time zone 'America/Bogota')::date) returning id`;
          await sp`insert into transaction_splits (transaction_id, category_id, amount_cents)
            values (${txn}, ${memberExpenseCat}, 5000)`;
          assert(labels[5], false, "a transfer took a split, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[5], pgCode(error) === "23514", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // 33-34: a split's category must share the movement's scope and kind. A group expense is the anchor.
      await enterUserContext(tx, leaderUser);
      await tx
        .savepoint(async (sp) => {
          const [{ id: txn }] = await sp<{ id: string }[]>`
            insert into transactions (from_account_id, amount_cents, occurred_at)
            values (${sharedAccount}, 5000, (now() at time zone 'America/Bogota')::date) returning id`;
          await sp`insert into transaction_splits (transaction_id, category_id, amount_cents)
            values (${txn}, ${memberExpenseCat}, 5000)`;
          assert(labels[6], false, "a foreign-scope split stood, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[6], pgCode(error) === "23514", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      await tx
        .savepoint(async (sp) => {
          const [{ id: txn }] = await sp<{ id: string }[]>`
            insert into transactions (from_account_id, amount_cents, occurred_at)
            values (${sharedAccount}, 5000, (now() at time zone 'America/Bogota')::date) returning id`;
          await sp`insert into transaction_splits (transaction_id, category_id, amount_cents)
            values (${txn}, ${groupIncomeCat}, 5000)`;
          assert(labels[7], false, "an income category on an expense stood, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[7], pgCode(error) === "23514", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // 35: universal read — a member sees the group movement and the leader's personal one.
      await enterUserContext(tx, memberUser);
      const [{ count: seesGroup }] = await tx<{ count: string }[]>`
        select count(*)::text as count from transactions where id = ${txnGroup.id}`;
      const [{ count: seesPersonal }] = await tx<{ count: string }[]>`
        select count(*)::text as count from transactions where id = ${txnLeaderPersonal}`;
      assert(
        labels[8],
        seesGroup === "1" && seesPersonal === "1",
        `member→group = ${seesGroup}, member→leader personal = ${seesPersonal}`,
      );

      // 36: the derived balance is the opening figure plus what flowed in, less what flowed out.
      await tx`insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${balAccountB}, ${balAccountA}, 3000, (now() at time zone 'America/Bogota')::date)`;
      await tx`insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${balAccountA}, ${balAccountB}, 1000, (now() at time zone 'America/Bogota')::date)`;
      const [{ balance_cents: balance }] = await tx<{ balance_cents: string }[]>`
        select balance_cents from account_balances where id = ${balAccountA}`;
      assert(
        labels[9],
        balance === "102000",
        `balance_cents = ${balance}, expected 102000 (100000 + 3000 − 1000)`,
      );

      // Forces `sql.begin` to issue ROLLBACK: nothing this function wrote may survive it.
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from groups where name = 'rls ledger'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls ledger' = ${probeCount}`,
  );
}

// Assertions 38-42: the analytics aggregates and the Phase 1 RLS that bounds them. No new policy
// ships — what is proved is query correctness under a member's context. The same window and the same
// aggregate SQL the report queries run are replicated inside the transaction, never the query functions
// themselves (they open their own `withUserDb`). Every fixture is seeded through the app's own policies
// and rolled back.
async function checkAnalyticsAggregates() {
  console.log("");
  const leaderUser = randomUUID();
  const secondLeader = randomUUID();
  const groupId = randomUUID();
  const secondGroup = randomUUID();

  const labels = [
    "38. the flow window sums the income and the expense, not the transfer — net is income − expense",
    "39. expense-by-category sums only the expense's splits; the transfer and income contribute no rows",
    "40. contribution netting credits a personal→group transfer and debits a group→personal return",
    "41. a second group's rows never enter the first member's flow or category aggregate",
    "42. a movement dated in the previous month is excluded from the current window",
  ];
  const tailLabel = "43. the rolled-back analytics transaction leaves no trace";

  // The exact aggregate SQL of the three report queries, replicated so the proof reads what ships.
  const flowSums = (q: postgres.TransactionSql, start: string, endExclusive: string) =>
    q<{ income_cents: string; expense_cents: string }[]>`
      select
        coalesce(sum(amount_cents) filter (where kind = 'income'), 0) as income_cents,
        coalesce(sum(amount_cents) filter (where kind = 'expense'), 0) as expense_cents
      from transactions
      where occurred_at >= ${start} and occurred_at < ${endExclusive}`;

  const categoryTotals = (q: postgres.TransactionSql, start: string, endExclusive: string) =>
    q<{ category_id: string; total_cents: string }[]>`
      select s.category_id, c.name, c.color, sum(s.amount_cents) as total_cents
      from transaction_splits s
      join transactions t on t.id = s.transaction_id
      join categories c on c.id = s.category_id
      where t.kind = 'expense'
        and t.occurred_at >= ${start} and t.occurred_at < ${endExclusive}
      group by s.category_id, c.name, c.color
      order by sum(s.amount_cents) desc`;

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      // Base identities and the caller's group, seeded as the owner before any role switch.
      await tx`insert into auth.users (id) values (${leaderUser}), (${secondLeader})`;
      await tx`insert into app_users (id) values (${leaderUser}), (${secondLeader})`;

      await enterUserContext(tx, leaderUser);
      await tx`insert into groups (id, name, cash_mode) values (${groupId}, 'rls analytics', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${leaderUser}, 'rls analytics leader', 'leader')`;

      // Mirrors `currentMonthRange()`: the first of the current Bogotá month and the first of the next,
      // as YYYY-MM-DD strings — the very bounds the report queries receive.
      const [{ start: winStart, end_exclusive: winEnd }] = await tx<
        { start: string; end_exclusive: string }[]
      >`select
          to_char(date_trunc('month', now() at time zone 'America/Bogota'), 'YYYY-MM-DD') as start,
          to_char(date_trunc('month', now() at time zone 'America/Bogota') + interval '1 month', 'YYYY-MM-DD') as end_exclusive`;

      // The caller's personal account and the group's shared account: contribution flows between the two.
      const [{ id: personalAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls analytics personal cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: groupAccount }] = await tx<{ id: string }[]>`
        insert into accounts (group_id, is_shared, name, kind, initial_balance_on)
        values (${groupId}, true, 'rls analytics group cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: incomeCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${leaderUser}, 'rls analytics income', 'income') returning id`;
      const [{ id: expenseCatA }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${leaderUser}, 'rls analytics rent', 'expense') returning id`;
      const [{ id: expenseCatB }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${leaderUser}, 'rls analytics food', 'expense') returning id`;

      // One income (10000, single split), one expense (6000, split across two categories),
      // one contribution transfer (5000, personal→group) and its return (1500, group→personal).
      const [{ id: incomeTxn }] = await tx<{ id: string }[]>`
        insert into transactions (to_account_id, amount_cents, occurred_at)
        values (${personalAccount}, 10000, (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into transaction_splits (transaction_id, category_id, amount_cents)
        values (${incomeTxn}, ${incomeCat}, 10000)`;

      const [{ id: expenseTxn }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, amount_cents, occurred_at)
        values (${personalAccount}, 6000, (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into transaction_splits (transaction_id, category_id, amount_cents)
        values (${expenseTxn}, ${expenseCatA}, 4000), (${expenseTxn}, ${expenseCatB}, 2000)`;

      await tx`insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${personalAccount}, ${groupAccount}, 5000, (now() at time zone 'America/Bogota')::date)`;
      await tx`insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${groupAccount}, ${personalAccount}, 1500, (now() at time zone 'America/Bogota')::date)`;

      // 38: the flow window counts the income and the expense, never the transfer (RF-19, RF-65).
      const [flow] = await flowSums(tx, winStart, winEnd);
      const income = Number(flow.income_cents);
      const expense = Number(flow.expense_cents);
      assert(
        labels[0],
        income === 10000 && expense === 6000 && income - expense === 4000,
        `income = ${income}, expense = ${expense}, net = ${income - expense}`,
      );

      // 39: the split-joined sum counts only the expense's two split rows; the transfer carries none (RF-34).
      const catRows = await categoryTotals(tx, winStart, winEnd);
      const catTotal = catRows.reduce((sum, row) => sum + Number(row.total_cents), 0);
      assert(
        labels[1],
        catRows.length === 2 && catTotal === 6000,
        `rows = ${catRows.length}, total = ${catTotal} (expected 2 rows, 6000)`,
      );

      // 40: the transfer netting credits the source owner for a contribution and debits it for a return (RF-66).
      const contributions = await tx<{ user_id: string; contribution_cents: string }[]>`
        select member.user_id, coalesce(sum(member.delta), 0) as contribution_cents
        from (
          select
            case
              when ta.group_id is not null and fa.owner_user_id is not null then fa.owner_user_id
              when fa.group_id is not null and ta.owner_user_id is not null then ta.owner_user_id
            end as user_id,
            case
              when ta.group_id is not null and fa.owner_user_id is not null then t.amount_cents
              when fa.group_id is not null and ta.owner_user_id is not null then -t.amount_cents
              else 0
            end as delta
          from transactions t
          join accounts fa on fa.id = t.from_account_id
          join accounts ta on ta.id = t.to_account_id
          where t.kind = 'transfer'
            and t.occurred_at >= ${winStart} and t.occurred_at < ${winEnd}
        ) member
        where member.user_id is not null
        group by member.user_id`;
      assert(
        labels[2],
        contributions.length === 1 &&
          contributions[0].user_id === leaderUser &&
          Number(contributions[0].contribution_cents) === 3500,
        `rows = ${contributions.length}, ${contributions[0]?.user_id === leaderUser ? "leader" : "other"} net = ${contributions[0]?.contribution_cents} (expected 3500 = 5000 − 1500)`,
      );

      // A second group with its own leader, accounts, categories and movements, seeded through its own
      // context. The first leader is no member of it, so Phase 1's SELECT policy hides every row.
      await tx`reset role`;
      await enterUserContext(tx, secondLeader);
      await tx`insert into groups (id, name, cash_mode) values (${secondGroup}, 'rls analytics second', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${secondGroup}, ${secondLeader}, 'rls analytics second leader', 'leader')`;
      const [{ id: secondPersonal }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${secondLeader}, 'rls analytics second cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: secondGroupAccount }] = await tx<{ id: string }[]>`
        insert into accounts (group_id, is_shared, name, kind, initial_balance_on)
        values (${secondGroup}, true, 'rls analytics second group cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: secondExpenseCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${secondLeader}, 'rls analytics second expense', 'expense') returning id`;
      const [{ id: secondIncome }] = await tx<{ id: string }[]>`
        insert into transactions (to_account_id, amount_cents, occurred_at)
        values (${secondPersonal}, 77000, (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: secondIncomeCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${secondLeader}, 'rls analytics second income', 'income') returning id`;
      await tx`insert into transaction_splits (transaction_id, category_id, amount_cents)
        values (${secondIncome}, ${secondIncomeCat}, 77000)`;
      const [{ id: secondExpense }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, amount_cents, occurred_at)
        values (${secondPersonal}, 33000, (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into transaction_splits (transaction_id, category_id, amount_cents)
        values (${secondExpense}, ${secondExpenseCat}, 33000)`;
      await tx`insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${secondPersonal}, ${secondGroupAccount}, 22000, (now() at time zone 'America/Bogota')::date)`;

      // 41: back under the first member, the aggregates hold their earlier totals — the second group is invisible.
      await tx`reset role`;
      await enterUserContext(tx, leaderUser);
      const [isolatedFlow] = await flowSums(tx, winStart, winEnd);
      const isolatedCat = await categoryTotals(tx, winStart, winEnd);
      const isolatedCatTotal = isolatedCat.reduce((sum, row) => sum + Number(row.total_cents), 0);
      assert(
        labels[3],
        Number(isolatedFlow.income_cents) === 10000 &&
          Number(isolatedFlow.expense_cents) === 6000 &&
          isolatedCat.length === 2 &&
          isolatedCatTotal === 6000,
        `income = ${isolatedFlow.income_cents}, expense = ${isolatedFlow.expense_cents}, category rows = ${isolatedCat.length}, category total = ${isolatedCatTotal}`,
      );

      // A first-group income dated in the previous month, otherwise valid. If the date-only window
      // comparison holds, it never touches the current sum.
      const [{ id: staleIncome }] = await tx<{ id: string }[]>`
        insert into transactions (to_account_id, amount_cents, occurred_at)
        values (${personalAccount}, 99999, (date_trunc('month', now() at time zone 'America/Bogota') - interval '1 day')::date) returning id`;
      await tx`insert into transaction_splits (transaction_id, category_id, amount_cents)
        values (${staleIncome}, ${incomeCat}, 99999)`;

      // 42: the current window still reads 10000 of income — the previous-month row is filtered out (RNF-06).
      const [windowedFlow] = await flowSums(tx, winStart, winEnd);
      assert(
        labels[4],
        Number(windowedFlow.income_cents) === 10000,
        `income in window = ${windowedFlow.income_cents} (expected 10000, the 99999 stale row excluded)`,
      );

      // Forces `sql.begin` to issue ROLLBACK: nothing this function wrote may survive it.
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from groups where name like 'rls analytics%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls analytics%' = ${probeCount}`,
  );
}

// Assertions 44-50: the budgets table. A budget names an expense category of its own scope; the scope
// trigger refuses a foreign or income category; spent derives from the category's expense splits in the
// window, narrowed to one account when the budget names it; any group member writes a group budget and
// a second group's budgets stay invisible. Every fixture is seeded through the app's own policies and
// rolled back.
async function checkBudgetPolicies() {
  console.log("");
  const leaderUser = randomUUID();
  const memberUser = randomUUID();
  const secondLeader = randomUUID();
  const groupId = randomUUID();
  const secondGroup = randomUUID();

  const labels = [
    "44. a personal budget on an expense category of the caller's scope inserts",
    "45. a budget whose category sits in another scope is refused",
    "46. a budget on an income category is refused",
    "47. spent sums the category's expense splits in the window; a transfer and a foreign-category expense add nothing",
    "48. an account-scoped budget counts only splits whose movement touches that account",
    "49. a plain member inserts, updates and deletes a group budget",
    "50. a member reads the group budget while a second group's budget stays invisible",
  ];
  const tailLabel = "51. the rolled-back budget transaction leaves no trace";

  // Spent derives from the splits on the budget's category, over the window's expenses, optionally
  // narrowed to the movements touching one account (RF-72).
  const spentSum = (
    q: postgres.TransactionSql,
    categoryId: string,
    start: string,
    endExclusive: string,
    accountId: string | null,
  ) =>
    q<{ spent_cents: string }[]>`
      select coalesce(sum(s.amount_cents), 0) as spent_cents
      from transaction_splits s
      join transactions t on t.id = s.transaction_id
      where s.category_id = ${categoryId}
        and t.kind = 'expense'
        and t.occurred_at >= ${start} and t.occurred_at < ${endExclusive}
        and (${accountId}::uuid is null
          or t.from_account_id = ${accountId} or t.to_account_id = ${accountId})`;

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${leaderUser}), (${memberUser}), (${secondLeader})`;
      await tx`insert into app_users (id) values (${leaderUser}), (${memberUser}), (${secondLeader})`;

      await enterUserContext(tx, leaderUser);
      await tx`insert into groups (id, name, cash_mode) values (${groupId}, 'rls budgets', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${leaderUser}, 'rls budgets leader', 'leader')`;

      // The window bounds the report receives: the first of the current Bogotá month and the next.
      const [{ start: winStart, end_exclusive: winEnd }] = await tx<
        { start: string; end_exclusive: string }[]
      >`select
          to_char(date_trunc('month', now() at time zone 'America/Bogota'), 'YYYY-MM-DD') as start,
          to_char(date_trunc('month', now() at time zone 'America/Bogota') + interval '1 month', 'YYYY-MM-DD') as end_exclusive`;

      const [{ id: leaderAccountA }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls budgets leader cash A', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: leaderAccountB }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls budgets leader cash B', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: budgetCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${leaderUser}, 'rls budgets category', 'expense') returning id`;
      const [{ id: otherCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${leaderUser}, 'rls budgets other category', 'expense') returning id`;
      const [{ id: accountCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${leaderUser}, 'rls budgets account category', 'expense') returning id`;
      const [{ id: incomeCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${leaderUser}, 'rls budgets income category', 'income') returning id`;
      const [{ id: groupExpenseCat }] = await tx<{ id: string }[]>`
        insert into categories (group_id, name, kind)
        values (${groupId}, 'rls budgets group category', 'expense') returning id`;

      // 44: a budget on an expense category of the caller's own scope lands.
      const inserted = await tx<{ id: string }[]>`
        insert into budgets (owner_user_id, category_id, period, limit_cents, threshold_pct, name)
        values (${leaderUser}, ${budgetCat}, 'monthly', 50000, 80, 'rls budgets personal') returning id`;
      assert(labels[0], inserted.length === 1, `inserted rows = ${inserted.length}`);

      // 45: the scope trigger refuses a category from another scope (a group category on a personal budget).
      await tx
        .savepoint(async (sp) => {
          await sp`insert into budgets (owner_user_id, category_id, period, limit_cents, threshold_pct)
            values (${leaderUser}, ${groupExpenseCat}, 'monthly', 50000, 80)`;
          assert(labels[1], false, "a foreign-scope category stood, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[1], pgCode(error) === "23514", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // 46: the scope trigger refuses an income category — a budget caps spending (RF-71).
      await tx
        .savepoint(async (sp) => {
          await sp`insert into budgets (owner_user_id, category_id, period, limit_cents, threshold_pct)
            values (${leaderUser}, ${incomeCat}, 'monthly', 50000, 80)`;
          assert(labels[2], false, "an income category stood, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[2], pgCode(error) === "23514", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // 47: one expense on the budget's category (7000), one transfer, one expense on another category (3000).
      const [{ id: budgetExpense }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, amount_cents, occurred_at)
        values (${leaderAccountA}, 7000, (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into transaction_splits (transaction_id, category_id, amount_cents)
        values (${budgetExpense}, ${budgetCat}, 7000)`;
      await tx`insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${leaderAccountA}, ${leaderAccountB}, 2000, (now() at time zone 'America/Bogota')::date)`;
      const [{ id: otherExpense }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, amount_cents, occurred_at)
        values (${leaderAccountA}, 3000, (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into transaction_splits (transaction_id, category_id, amount_cents)
        values (${otherExpense}, ${otherCat}, 3000)`;
      const [{ spent_cents: budgetSpent }] = await spentSum(tx, budgetCat, winStart, winEnd, null);
      assert(
        labels[3],
        Number(budgetSpent) === 7000,
        `spent = ${budgetSpent} (expected 7000, the transfer and the 3000 other-category expense excluded)`,
      );

      // 48: an account-scoped budget. Two expenses on one category, from two accounts, only one named.
      const [{ id: accountBudget }] = await tx<{ id: string }[]>`
        insert into budgets (owner_user_id, category_id, account_id, period, limit_cents, threshold_pct)
        values (${leaderUser}, ${accountCat}, ${leaderAccountA}, 'monthly', 100000, 90) returning id`;
      const [{ id: onAccount }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, amount_cents, occurred_at)
        values (${leaderAccountA}, 4000, (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into transaction_splits (transaction_id, category_id, amount_cents)
        values (${onAccount}, ${accountCat}, 4000)`;
      const [{ id: offAccount }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, amount_cents, occurred_at)
        values (${leaderAccountB}, 2000, (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into transaction_splits (transaction_id, category_id, amount_cents)
        values (${offAccount}, ${accountCat}, 2000)`;
      const [{ spent_cents: narrowed }] = await spentSum(tx, accountCat, winStart, winEnd, leaderAccountA);
      const [{ spent_cents: unnarrowed }] = await spentSum(tx, accountCat, winStart, winEnd, null);
      assert(
        labels[4],
        Number(narrowed) === 4000 && Number(unnarrowed) === 6000,
        `narrowed to the account = ${narrowed} (expected 4000), across accounts = ${unnarrowed} (expected 6000), budget ${accountBudget !== null}`,
      );

      // A group budget the plain member reads below, and a second group's budget it must never see.
      const [{ id: groupBudget }] = await tx<{ id: string }[]>`
        insert into budgets (group_id, category_id, period, limit_cents, threshold_pct, name)
        values (${groupId}, ${groupExpenseCat}, 'monthly', 80000, 70, 'rls budgets group') returning id`;

      // The plain member: seed the membership as the owner, no policy hands one out.
      await tx`reset role`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${memberUser}, 'rls budgets member', 'member')`;

      // The second group, seeded through its own leader's context.
      await enterUserContext(tx, secondLeader);
      await tx`insert into groups (id, name, cash_mode) values (${secondGroup}, 'rls budgets second', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${secondGroup}, ${secondLeader}, 'rls budgets second leader', 'leader')`;
      const [{ id: secondCat }] = await tx<{ id: string }[]>`
        insert into categories (group_id, name, kind)
        values (${secondGroup}, 'rls budgets second category', 'expense') returning id`;
      const [{ id: secondBudget }] = await tx<{ id: string }[]>`
        insert into budgets (group_id, category_id, period, limit_cents, threshold_pct)
        values (${secondGroup}, ${secondCat}, 'monthly', 90000, 60) returning id`;

      // 49: a plain member writes a group budget — insert, update and delete all land (any-member rule).
      await enterUserContext(tx, memberUser);
      const memberInsert = await tx<{ id: string }[]>`
        insert into budgets (group_id, category_id, period, limit_cents, threshold_pct, name)
        values (${groupId}, ${groupExpenseCat}, 'weekly', 20000, 50, 'rls budgets member owned') returning id`;
      const memberBudget = memberInsert[0]?.id;
      const memberUpdate = await tx`update budgets set limit_cents = 25000 where id = ${memberBudget}`;
      const memberDelete = await tx`delete from budgets where id = ${memberBudget}`;
      assert(
        labels[5],
        memberInsert.length === 1 && memberUpdate.count === 1 && memberDelete.count === 1,
        `insert rows = ${memberInsert.length}, update rows = ${memberUpdate.count}, delete rows = ${memberDelete.count}`,
      );

      // 50: the member reads the group budget through the universal read; the second group's stays hidden.
      const [{ count: seesGroup }] = await tx<{ count: string }[]>`
        select count(*)::text as count from budgets where id = ${groupBudget}`;
      const [{ count: seesSecond }] = await tx<{ count: string }[]>`
        select count(*)::text as count from budgets where id = ${secondBudget}`;
      assert(
        labels[6],
        seesGroup === "1" && seesSecond === "0",
        `member→group budget = ${seesGroup}, member→second group budget = ${seesSecond}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from groups where name like 'rls budgets%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls budgets%' = ${probeCount}`,
  );
}

// Assertions 52-56: the planned_payments table. The scope and `created_by` are the trigger's, not the
// caller's; write is bounded to own-or-shared accounts; settling from pending is a one-shot idempotent
// link; the settled link is permanent and a done row never returns to pending; and a second group's
// payments stay invisible. Every fixture is seeded through the app's own policies and rolled back.
async function checkPlannedPaymentPolicies() {
  console.log("");
  const leaderUser = randomUUID();
  const memberUser = randomUUID();
  const secondLeader = randomUUID();
  const groupId = randomUUID();
  const secondGroup = randomUUID();

  const labels = [
    "52. a planned payment holds the trigger's derived scope and created_by, not the caller's",
    "53. a payment touching another member's personal account is refused",
    "54. settling from pending links the transaction once; the second settle touches nothing",
    "55. rewriting the settled transaction is refused, and a done payment cannot return to pending",
    "56. a member reads the group payment while a second group's payment stays invisible",
  ];
  const tailLabel = "57. the rolled-back planned payment transaction leaves no trace";

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${leaderUser}), (${memberUser}), (${secondLeader})`;
      await tx`insert into app_users (id) values (${leaderUser}), (${memberUser}), (${secondLeader})`;

      await enterUserContext(tx, leaderUser);
      await tx`insert into groups (id, name, cash_mode) values (${groupId}, 'rls payments', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${leaderUser}, 'rls payments leader', 'leader')`;

      const [{ id: leaderAccountA }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls payments leader cash A', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: leaderAccountB }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls payments leader cash B', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: sharedAccount }] = await tx<{ id: string }[]>`
        insert into accounts (group_id, is_shared, name, kind, initial_balance_on)
        values (${groupId}, true, 'rls payments shared cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;

      // Two real movements the payments settle into.
      const [{ id: settleTxn }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${leaderAccountA}, ${leaderAccountB}, 4000, (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: otherTxn }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${leaderAccountB}, ${leaderAccountA}, 1000, (now() at time zone 'America/Bogota')::date) returning id`;

      // 52: a payment touching the shared account is group-scoped, its creator stamped — both by the trigger.
      const [groupPayment] = await tx<
        { id: string; owner_user_id: string | null; group_id: string | null; created_by: string; status: string }[]
      >`insert into planned_payments (from_account_id, to_account_id, amount_cents, due_date)
        values (${leaderAccountA}, ${sharedAccount}, 6000, (now() at time zone 'America/Bogota')::date)
        returning id, owner_user_id, group_id, created_by, status`;
      assert(
        labels[0],
        groupPayment.group_id === groupId &&
          groupPayment.owner_user_id === null &&
          groupPayment.created_by === leaderUser &&
          groupPayment.status === "pending",
        `group_id = ${groupPayment.group_id === groupId}, owner = ${groupPayment.owner_user_id}, created_by = ${groupPayment.created_by === leaderUser}, status = ${groupPayment.status}`,
      );

      // A personal pending payment to settle below.
      const [{ id: settlePayment }] = await tx<{ id: string }[]>`
        insert into planned_payments (from_account_id, amount_cents, due_date)
        values (${leaderAccountA}, 3000, (now() at time zone 'America/Bogota')::date) returning id`;

      // The plain member and their personal account, seeded through their own context.
      await tx`reset role`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${memberUser}, 'rls payments member', 'member')`;
      await enterUserContext(tx, memberUser);
      const [{ id: memberAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${memberUser}, 'rls payments member cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;

      // 53: the bounded write — the leader may not plan a payment out of the member's personal account.
      await enterUserContext(tx, leaderUser);
      await tx
        .savepoint(async (sp) => {
          await sp`insert into planned_payments (from_account_id, amount_cents, due_date)
            values (${memberAccount}, 3000, (now() at time zone 'America/Bogota')::date)`;
          assert(labels[1], false, "a payment on another's account stood, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[1], pgCode(error) === "42501", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // 54: the settle is a one-shot guarded by the status. The first stamps and links, the second no-ops.
      const firstSettle = await tx<{ settled_transaction_id: string | null }[]>`
        update planned_payments set status = 'done', settled_transaction_id = ${settleTxn}
        where id = ${settlePayment} and status = 'pending'
        returning settled_transaction_id`;
      const secondSettle = await tx`update planned_payments set status = 'done', settled_transaction_id = ${settleTxn}
        where id = ${settlePayment} and status = 'pending'`;
      assert(
        labels[2],
        firstSettle.count === 1 &&
          firstSettle[0].settled_transaction_id === settleTxn &&
          secondSettle.count === 0,
        `first settle rows = ${firstSettle.count}, linked = ${firstSettle[0]?.settled_transaction_id === settleTxn}, second settle rows = ${secondSettle.count}`,
      );

      // 55: the settled link is permanent, and a done payment never returns to pending (RF-75).
      let rewriteCode: string | undefined;
      let revertCode: string | undefined;
      await tx
        .savepoint(async (sp) => {
          await sp`update planned_payments set settled_transaction_id = ${otherTxn} where id = ${settlePayment}`;
          assert(labels[3], false, "the settled link was rewritten, which it must not be");
        })
        .catch((error: unknown) => {
          rewriteCode = pgCode(error);
        });
      await tx
        .savepoint(async (sp) => {
          await sp`update planned_payments set status = 'pending' where id = ${settlePayment}`;
          assert(labels[3], false, "a done payment returned to pending, which it must not");
        })
        .catch((error: unknown) => {
          revertCode = pgCode(error);
        });
      assert(
        labels[3],
        rewriteCode === "23514" && revertCode === "23514",
        `rewrite sqlstate ${rewriteCode ?? "none"}, revert sqlstate ${revertCode ?? "none"}`,
      );

      // A second group whose payments the first member must never see, seeded through its own leader.
      await tx`reset role`;
      await enterUserContext(tx, secondLeader);
      await tx`insert into groups (id, name, cash_mode) values (${secondGroup}, 'rls payments second', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${secondGroup}, ${secondLeader}, 'rls payments second leader', 'leader')`;
      const [{ id: secondAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${secondLeader}, 'rls payments second cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: secondPayment }] = await tx<{ id: string }[]>`
        insert into planned_payments (from_account_id, amount_cents, due_date)
        values (${secondAccount}, 5000, (now() at time zone 'America/Bogota')::date) returning id`;

      // 56: the member reads the group payment through the universal read; the second group's stays hidden.
      await enterUserContext(tx, memberUser);
      const [{ count: seesGroup }] = await tx<{ count: string }[]>`
        select count(*)::text as count from planned_payments where id = ${groupPayment.id}`;
      const [{ count: seesSecond }] = await tx<{ count: string }[]>`
        select count(*)::text as count from planned_payments where id = ${secondPayment}`;
      assert(
        labels[4],
        seesGroup === "1" && seesSecond === "0",
        `member→group payment = ${seesGroup}, member→second group payment = ${seesSecond}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from groups where name like 'rls payments%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls payments%' = ${probeCount}`,
  );
}

// Assertions 58-61: the savings_goals and goal_contributions tables. A contribution earmarks a movement
// of the goal's scope and `goal_progress` derives the saved figure from it; the scope trigger refuses a
// foreign-scope movement; any group member writes a group goal and attaches a contribution; and a second
// group's goals stay invisible. Every fixture is seeded through the app's own policies and rolled back.
async function checkSavingsGoalPolicies() {
  console.log("");
  const leaderUser = randomUUID();
  const memberUser = randomUUID();
  const secondLeader = randomUUID();
  const groupId = randomUUID();
  const secondGroup = randomUUID();

  const labels = [
    "58. a contribution of the goal's scope inserts and goal_progress derives the saved figure",
    "59. a contribution earmarking a movement of another scope is refused",
    "60. a plain member inserts, updates and deletes a group goal and attaches a contribution",
    "61. a member reads the group goal while a second group's goal stays invisible",
  ];
  const tailLabel = "62. the rolled-back savings goal transaction leaves no trace";

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${leaderUser}), (${memberUser}), (${secondLeader})`;
      await tx`insert into app_users (id) values (${leaderUser}), (${memberUser}), (${secondLeader})`;

      await enterUserContext(tx, leaderUser);
      await tx`insert into groups (id, name, cash_mode) values (${groupId}, 'rls goals', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${leaderUser}, 'rls goals leader', 'leader')`;

      const [{ id: leaderAccountA }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls goals leader cash A', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: leaderAccountB }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls goals leader cash B', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: sharedAccount }] = await tx<{ id: string }[]>`
        insert into accounts (group_id, is_shared, name, kind, initial_balance_on)
        values (${groupId}, true, 'rls goals shared cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;

      // A personal goal and a personal movement that shares its scope.
      const [{ id: personalGoal }] = await tx<{ id: string }[]>`
        insert into savings_goals (owner_user_id, name, target_amount_cents)
        values (${leaderUser}, 'rls goals personal', 200000) returning id`;
      const [{ id: personalTxn }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${leaderAccountA}, ${leaderAccountB}, 5000, (now() at time zone 'America/Bogota')::date) returning id`;
      // A group movement, of a different scope, seeded here for the refusal below.
      const [{ id: groupTxn }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${leaderAccountA}, ${sharedAccount}, 5000, (now() at time zone 'America/Bogota')::date) returning id`;

      // 58: the contribution lands and the derived progress equals it.
      const contribution = await tx<{ id: string }[]>`
        insert into goal_contributions (goal_id, transaction_id, amount_cents)
        values (${personalGoal}, ${personalTxn}, 5000) returning id`;
      const [{ saved_cents: saved }] = await tx<{ saved_cents: string }[]>`
        select saved_cents from goal_progress where goal_id = ${personalGoal}`;
      assert(
        labels[0],
        contribution.length === 1 && Number(saved) === 5000,
        `inserted rows = ${contribution.length}, goal_progress.saved_cents = ${saved} (expected 5000)`,
      );

      // 59: the scope trigger refuses a movement of another scope on the personal goal.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into goal_contributions (goal_id, transaction_id, amount_cents)
            values (${personalGoal}, ${groupTxn}, 5000)`;
          assert(labels[1], false, "a foreign-scope movement was earmarked, which it must not be");
        })
        .catch((error: unknown) => {
          assert(labels[1], pgCode(error) === "23514", `sqlstate ${pgCode(error) ?? "none"}`);
        });

      // A group goal the plain member reads below, seeded by the leader.
      const [{ id: groupGoal }] = await tx<{ id: string }[]>`
        insert into savings_goals (group_id, name, target_amount_cents)
        values (${groupId}, 'rls goals group', 400000) returning id`;

      // The plain member, seeded through their own context.
      await tx`reset role`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${memberUser}, 'rls goals member', 'member')`;

      // The second group, seeded through its own leader.
      await enterUserContext(tx, secondLeader);
      await tx`insert into groups (id, name, cash_mode) values (${secondGroup}, 'rls goals second', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${secondGroup}, ${secondLeader}, 'rls goals second leader', 'leader')`;
      const [{ id: secondGoal }] = await tx<{ id: string }[]>`
        insert into savings_goals (group_id, name, target_amount_cents)
        values (${secondGroup}, 'rls goals second goal', 300000) returning id`;

      // 60: a plain member writes a group goal — insert, update, contribute and delete all land.
      await enterUserContext(tx, memberUser);
      const [{ id: memberAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${memberUser}, 'rls goals member cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const memberInsert = await tx<{ id: string }[]>`
        insert into savings_goals (group_id, name, target_amount_cents)
        values (${groupId}, 'rls goals member owned', 150000) returning id`;
      const memberGoal = memberInsert[0]?.id;
      const memberUpdate = await tx`update savings_goals set name = 'rls goals member renamed' where id = ${memberGoal}`;
      // A group movement the member may write: their own account into the shared account.
      const [{ id: memberGroupTxn }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${memberAccount}, ${sharedAccount}, 2500, (now() at time zone 'America/Bogota')::date) returning id`;
      const memberContribution = await tx<{ id: string }[]>`
        insert into goal_contributions (goal_id, transaction_id, amount_cents)
        values (${memberGoal}, ${memberGroupTxn}, 2500) returning id`;
      const memberDelete = await tx`delete from savings_goals where id = ${memberGoal}`;
      assert(
        labels[2],
        memberInsert.length === 1 &&
          memberUpdate.count === 1 &&
          memberContribution.length === 1 &&
          memberDelete.count === 1,
        `insert rows = ${memberInsert.length}, update rows = ${memberUpdate.count}, contribution rows = ${memberContribution.length}, delete rows = ${memberDelete.count}`,
      );

      // 61: the member reads the group goal through the universal read; the second group's stays hidden.
      const [{ count: seesGroup }] = await tx<{ count: string }[]>`
        select count(*)::text as count from savings_goals where id = ${groupGoal}`;
      const [{ count: seesSecond }] = await tx<{ count: string }[]>`
        select count(*)::text as count from savings_goals where id = ${secondGoal}`;
      assert(
        labels[3],
        seesGroup === "1" && seesSecond === "0",
        `member→group goal = ${seesGroup}, member→second group goal = ${seesSecond}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from groups where name like 'rls goals%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls goals%' = ${probeCount}`,
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
