// Proves the access policies actually fire. Runs outside Next.js under Node 22
// type stripping, so it reads `process.env` directly and pulls only
// `pgErrorCode` from the app.
import { createHash, randomUUID } from "node:crypto";

import { getTableColumns, is, sql as dsql } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type { PgColumn } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { insertRow } from "@/db/insert-row";
import type { InsertValues } from "@/db/insert-row";
import { commitImport } from "@/db/queries/import-commit";
import type { CommitInput, CommitScope } from "@/db/queries/import-commit";
import * as schema from "@/db/schema";
import { pgErrorCode } from "@/lib/db-error";
import { CATEGORY_COLORS } from "@/lib/fund/category-color";
import { GROUP_CASH_ACCOUNT_NAME } from "@/lib/fund/seed";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

// The import commit writes through Drizzle, so the proof drives it through a Drizzle
// transaction over the same pool. `commitImport` takes the transaction and settles the
// session the way `withUserDb` does, so RLS decides every row here too.
const orm = drizzle(sql, { schema, casing: "snake_case" });

let failed = false;

function assert(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) failed = true;
}

// Mirrors `withUserDb`: claims first, then the role switch, both transaction-local.
// Idempotent — calling it again mid-transaction re-points `auth.uid()` at a new subject.
async function enterUserContext(
  tx: postgres.TransactionSql,
  subject: string,
  email?: string,
): Promise<void> {
  const claims = JSON.stringify({
    sub: subject,
    role: "authenticated",
    aud: "authenticated",
    // `auth.email()` reads this claim; the invite-claim policy matches it against `invite_email`.
    ...(email ? { email } : {}),
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
  await checkDebtTermsPolicies();
  await checkInstallmentPolicies();
  await checkDebtDerivedFigures();
  await checkDebtStatementPolicies();
  await checkWebhookCredentialPolicies();
  await checkImpersonationBounds();
  await checkInviteClaimPolicies();
  await checkRecurringRulePolicies();
  await checkAuditLogPolicies();
  await checkAuditViewerPolicy();
  await checkAccountSubtypeBackfill();
  await checkCashReportInvariants();
  await checkExternalRefKeys();
  await checkImportCommit();
  await checkLabelPolicies();
  await checkWebhookCredentialOwnerWrites();
  await checkIngestDeliveryPolicies();
  await checkIngestMerchantTrust();
  await checkInsertGrantMap();
  await checkInsertHelper();
  await checkGroupMemberUserIdLock();
  await checkMemberManagementLeaderOnly();
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
          assert(soloLabels[0], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
        });

      await tx
        .savepoint(async (sp) => {
          await sp`insert into accounts (name, kind, initial_balance_on)
            values ('rls repivot neither', 'asset', (now() at time zone 'America/Bogota')::date)`;
          assert(soloLabels[1], false, "neither an owner nor a group landed, which it must not");
        })
        .catch((error: unknown) => {
          // 42501 = the INSERT WITH CHECK fires first, 23514 = the table CHECK; either bars the row.
          const code = pgErrorCode(error);
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
          assert(soloLabels[2], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
        });

      // 12: the cash_mode domain check on groups.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into groups (id, name, cash_mode)
            values (${randomUUID()}, 'rls repivot bad mode', 'weekly')`;
          assert(soloLabels[3], false, "an unknown cash_mode landed, which it must not");
        })
        .catch((error: unknown) => {
          assert(soloLabels[3], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
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
          assert(soloLabels[4], pgErrorCode(error) === "23505", `sqlstate ${pgErrorCode(error) ?? "none"}`);
        });

      // 14-15: the categories owner-XOR-group check, both rows otherwise writable by the leader.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into categories (owner_user_id, group_id, name, kind)
            values (${leaderUser}, ${groupId}, 'rls repivot cat both', 'expense')`;
          assert(soloLabels[5], false, "both an owner and a group landed, which it must not");
        })
        .catch((error: unknown) => {
          assert(soloLabels[5], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
        });

      await tx
        .savepoint(async (sp) => {
          await sp`insert into categories (name, kind) values ('rls repivot cat neither', 'expense')`;
          assert(soloLabels[6], false, "neither an owner nor a group landed, which it must not");
        })
        .catch((error: unknown) => {
          // 42501 = the INSERT WITH CHECK fires first, 23514 = the table CHECK; either bars the row.
          const code = pgErrorCode(error);
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
          assert(soloLabels[7], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
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
          assert(pairLabels[1], pgErrorCode(error) === "42501", `sqlstate ${pgErrorCode(error) ?? "none"}`);
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
          assert(labels[1], pgErrorCode(error) === "42501", `sqlstate ${pgErrorCode(error) ?? "none"}`);
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
          assert(labels[3], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
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
          assert(labels[4], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
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
          assert(labels[5], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
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
          assert(labels[6], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
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
          assert(labels[7], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
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

      // 38: the flow window counts the income and the expense, never the transfer (RF-19, RF-88).
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
          assert(labels[1], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
        });

      // 46: the scope trigger refuses an income category — a budget caps spending (RF-71).
      await tx
        .savepoint(async (sp) => {
          await sp`insert into budgets (owner_user_id, category_id, period, limit_cents, threshold_pct)
            values (${leaderUser}, ${incomeCat}, 'monthly', 50000, 80)`;
          assert(labels[2], false, "an income category stood, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[2], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
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
          assert(labels[1], pgErrorCode(error) === "42501", `sqlstate ${pgErrorCode(error) ?? "none"}`);
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
          rewriteCode = pgErrorCode(error);
        });
      await tx
        .savepoint(async (sp) => {
          await sp`update planned_payments set status = 'pending' where id = ${settlePayment}`;
          assert(labels[3], false, "a done payment returned to pending, which it must not");
        })
        .catch((error: unknown) => {
          revertCode = pgErrorCode(error);
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

// Assertions 58-61, 103-104: the savings_goals and goal_contributions tables. A contribution earmarks a
// movement of the goal's scope and `goal_progress` derives the saved figure from it; a virtual contribution
// earmarks no movement yet still counts; the scope trigger refuses a foreign-scope movement; any group
// member writes a group goal and attaches a contribution while an intruder's virtual insert is barred; and a
// second group's goals stay invisible. Every fixture is seeded through the app's own policies and rolled back.
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
    "103. a virtual contribution earmarking no movement lands and goal_progress sums it",
    "104. an intruder outside the goal's scope cannot insert even a virtual contribution",
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

      // 103: a virtual contribution earmarks no movement (RF-77); it still lands and goal_progress sums it.
      const [{ saved_cents: beforeVirtual }] = await tx<{ saved_cents: string }[]>`
        select saved_cents from goal_progress where goal_id = ${personalGoal}`;
      const virtualContribution = await tx<{ id: string }[]>`
        insert into goal_contributions (goal_id, transaction_id, amount_cents)
        values (${personalGoal}, null, 7000) returning id`;
      const [{ saved_cents: afterVirtual }] = await tx<{ saved_cents: string }[]>`
        select saved_cents from goal_progress where goal_id = ${personalGoal}`;
      assert(
        labels[4],
        virtualContribution.length === 1 && Number(afterVirtual) - Number(beforeVirtual) === 7000,
        `inserted rows = ${virtualContribution.length}, saved_cents ${beforeVirtual} → ${afterVirtual} (expected +7000)`,
      );

      // 59: the scope trigger refuses a movement of another scope on the personal goal.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into goal_contributions (goal_id, transaction_id, amount_cents)
            values (${personalGoal}, ${groupTxn}, 5000)`;
          assert(labels[1], false, "a foreign-scope movement was earmarked, which it must not be");
        })
        .catch((error: unknown) => {
          assert(labels[1], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
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

      // 104: the intruder's identical virtual insert on the leader's personal goal is barred by the write policy.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into goal_contributions (goal_id, transaction_id, amount_cents)
            values (${personalGoal}, null, 7000)`;
          assert(labels[5], false, "an intruder's virtual contribution stood, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[5], pgErrorCode(error) === "42501", `sqlstate ${pgErrorCode(error) ?? "none"}`);
        });

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

// Assertions 63-69: the debt_terms table. A profile attaches only to a liability the caller may write;
// the liability trigger, the amount-XOR-percentage check and the due-day range each reject a bad row;
// read is universal inside the group and a non-writer cannot mint a profile on another member's personal
// liability. Every fixture is seeded through the app's own policies and rolled back.
async function checkDebtTermsPolicies() {
  console.log("");
  const leaderUser = randomUUID();
  const memberUser = randomUUID();
  const secondLeader = randomUUID();
  const groupId = randomUUID();
  const secondGroup = randomUUID();

  const labels = [
    "63. a profile on the caller's own liability inserts",
    "64. a profile on an asset account is refused",
    "65. a minimum set as both an amount and a percentage is refused",
    "66. a payment due day outside 1..31 is refused",
    "67. a second group's debt terms stay invisible",
    "68. a member reads a group liability's terms",
    "69. a non-writer cannot mint terms on another member's personal liability",
  ];
  const tailLabel = "70. the rolled-back debt terms transaction leaves no trace";

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${leaderUser}), (${memberUser}), (${secondLeader})`;
      await tx`insert into app_users (id) values (${leaderUser}), (${memberUser}), (${secondLeader})`;

      await enterUserContext(tx, leaderUser);
      await tx`insert into groups (id, name, cash_mode) values (${groupId}, 'rls debt terms', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${leaderUser}, 'rls debt terms leader', 'leader')`;

      // A liability with a profile below, an asset the trigger rejects, a second liability for the check
      // constraints (which roll back, so it stays profileless), and a group liability the member reads.
      const [{ id: liabilityA }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_cents, initial_balance_on)
        values (${leaderUser}, 'rls debt terms leader card', 'liability', -500000, (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: assetAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls debt terms leader cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: liabilityB }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_cents, initial_balance_on)
        values (${leaderUser}, 'rls debt terms leader card B', 'liability', -100000, (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: groupLiability }] = await tx<{ id: string }[]>`
        insert into accounts (group_id, is_shared, name, kind, initial_balance_cents, initial_balance_on)
        values (${groupId}, true, 'rls debt terms group card', 'liability', -200000, (now() at time zone 'America/Bogota')::date) returning id`;

      // 63: a profile on the caller's own liability lands.
      const inserted = await tx<{ account_id: string }[]>`
        insert into debt_terms (account_id, debt_kind, annual_rate, minimum_payment_pct, credit_limit_cents, statement_cut_off_day, payment_due_day)
        values (${liabilityA}, 'revolving', 0.28, 0.05, 1500000, 15, 5) returning account_id`;
      assert(labels[0], inserted.length === 1, `inserted rows = ${inserted.length}`);

      // 64: the liability trigger refuses a profile on an asset account.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into debt_terms (account_id, debt_kind, annual_rate)
            values (${assetAccount}, 'revolving', 0.28)`;
          assert(labels[1], false, "a profile on an asset stood, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[1], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
        });

      // 65: the minimum is a fixed amount XOR a percentage — both at once is refused.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into debt_terms (account_id, debt_kind, annual_rate, minimum_payment_cents, minimum_payment_pct)
            values (${liabilityB}, 'revolving', 0.28, 50000, 0.05)`;
          assert(labels[2], false, "both an amount and a percentage stood, which they must not");
        })
        .catch((error: unknown) => {
          assert(labels[2], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
        });

      // 66: the payment due day is a real day of month — 0 and 32 are both refused.
      let dueZeroCode: string | undefined;
      let dueOverCode: string | undefined;
      await tx
        .savepoint(async (sp) => {
          await sp`insert into debt_terms (account_id, debt_kind, annual_rate, payment_due_day)
            values (${liabilityB}, 'revolving', 0.28, 0)`;
        })
        .catch((error: unknown) => {
          dueZeroCode = pgErrorCode(error);
        });
      await tx
        .savepoint(async (sp) => {
          await sp`insert into debt_terms (account_id, debt_kind, annual_rate, payment_due_day)
            values (${liabilityB}, 'revolving', 0.28, 32)`;
        })
        .catch((error: unknown) => {
          dueOverCode = pgErrorCode(error);
        });
      assert(
        labels[3],
        dueZeroCode === "23514" && dueOverCode === "23514",
        `day 0 sqlstate ${dueZeroCode ?? "none"}, day 32 sqlstate ${dueOverCode ?? "none"}`,
      );

      // Terms on the group liability, for the member read below.
      await tx`insert into debt_terms (account_id, debt_kind, annual_rate, minimum_payment_pct)
        values (${groupLiability}, 'revolving', 0.30, 0.05)`;

      // The plain member, seeded as the owner — no policy hands out a membership.
      await tx`reset role`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${memberUser}, 'rls debt terms member', 'member')`;

      // A second group with its own leader and a liability whose terms the subject must never see.
      await enterUserContext(tx, secondLeader);
      await tx`insert into groups (id, name, cash_mode) values (${secondGroup}, 'rls debt terms second', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${secondGroup}, ${secondLeader}, 'rls debt terms second leader', 'leader')`;
      const [{ id: secondLiability }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_cents, initial_balance_on)
        values (${secondLeader}, 'rls debt terms second card', 'liability', -300000, (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into debt_terms (account_id, debt_kind, annual_rate, minimum_payment_pct)
        values (${secondLiability}, 'revolving', 0.25, 0.04)`;

      // 67: back under the subject, the second group's terms are invisible.
      await enterUserContext(tx, leaderUser);
      const [{ count: seesSecond }] = await tx<{ count: string }[]>`
        select count(*)::text as count from debt_terms where account_id = ${secondLiability}`;
      assert(labels[4], seesSecond === "0", `subject→second terms = ${seesSecond}`);

      // 68: the member reads the group liability's terms through the universal read.
      await enterUserContext(tx, memberUser);
      const [{ count: seesGroup }] = await tx<{ count: string }[]>`
        select count(*)::text as count from debt_terms where account_id = ${groupLiability}`;
      assert(labels[5], seesGroup === "1", `member→group terms = ${seesGroup}`);

      // 69: the member cannot mint terms on the leader's personal liability.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into debt_terms (account_id, debt_kind, annual_rate)
            values (${liabilityB}, 'revolving', 0.28)`;
          assert(labels[6], false, "a non-writer minted terms, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[6], pgErrorCode(error) === "42501", `sqlstate ${pgErrorCode(error) ?? "none"}`);
        });

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from accounts where name like 'rls debt terms%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls debt terms%' = ${probeCount}`,
  );
}

// Assertions 71-76: the installment plans, their lines and the oldest-first allocator. A plan attaches
// only to a liability; a line links only to a movement touching the plan's account; and the FIFO walk,
// replicated inline, settles the fully-covered lines in due order, leaves the remainder unassigned and
// unwinds on deletion of the paying movement. Every fixture is seeded through the app's own policies and
// rolled back.
async function checkInstallmentPolicies() {
  console.log("");
  const leaderUser = randomUUID();

  const labels = [
    "71. a plan on the caller's liability inserts with its lines",
    "72. a plan on an asset account is refused",
    "73. a line links to a movement touching the plan account and rejects one that does not",
    "74. a 200000 payment settles exactly the two oldest 100000 lines and leaves the third unpaid",
    "75. a 150000 payment settles only the first line and leaves the remainder unassigned",
    "76. deleting the paying movement unlinks every line and restores the full pending",
  ];
  const tailLabel = "77. the rolled-back installment transaction leaves no trace";

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${leaderUser})`;
      await tx`insert into app_users (id) values (${leaderUser})`;
      await enterUserContext(tx, leaderUser);

      // The oldest-first FIFO allocator (RF-82), replicated inline against this transaction's own
      // connection: it links each fully-covered line to the payment in due order, subtracting its amount
      // from a running remainder, and stops at the first line the remainder cannot cover in full. A line
      // is never partially paid; the leftover remainder stays unassigned.
      const allocate = async (planId: string, paymentId: string, amount: number) => {
        const lines = await tx<{ id: string; amount_cents: string }[]>`
          select id, amount_cents from installment_lines
          where plan_id = ${planId} and paid_transaction_id is null
          order by due_date, seq`;
        let remainder = amount;
        for (const line of lines) {
          const owed = Number(line.amount_cents);
          if (remainder < owed) break;
          remainder -= owed;
          await tx`update installment_lines set paid_transaction_id = ${paymentId} where id = ${line.id}`;
        }
      };

      const [{ id: liability }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_cents, initial_balance_on)
        values (${leaderUser}, 'rls installment card', 'liability', -900000, (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: cash }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_cents, initial_balance_on)
        values (${leaderUser}, 'rls installment cash', 'asset', 1000000, (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: cashB }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls installment cash B', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;

      // 71: a plan on the caller's liability lands with its three lines.
      const [{ id: plan1 }] = await tx<{ id: string }[]>`
        insert into installment_plans (account_id, principal_cents, n_installments, frequency, start_date)
        values (${liability}, 300000, 3, 'monthly', (now() at time zone 'America/Bogota')::date) returning id`;
      const plan1Lines = await tx<{ id: string }[]>`
        insert into installment_lines (plan_id, seq, due_date, amount_cents) values
          (${plan1}, 1, '2026-01-15', 100000),
          (${plan1}, 2, '2026-02-15', 100000),
          (${plan1}, 3, '2026-03-15', 100000) returning id`;
      assert(labels[0], plan1Lines.length === 3, `line rows = ${plan1Lines.length}`);

      // 72: the plan trigger refuses a plan on an asset account.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into installment_plans (account_id, principal_cents, n_installments, frequency, start_date)
            values (${cash}, 300000, 3, 'monthly', (now() at time zone 'America/Bogota')::date)`;
          assert(labels[1], false, "a plan on an asset stood, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[1], pgErrorCode(error) === "23514", `sqlstate ${pgErrorCode(error) ?? "none"}`);
        });

      // 73: a settling movement must touch the plan's account. A cash→card transfer does; cash→cash does not.
      const [{ id: touchingTxn }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${cash}, ${liability}, 50000, (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: nonTouchingTxn }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${cash}, ${cashB}, 50000, (now() at time zone 'America/Bogota')::date) returning id`;
      const linkTouching = await tx`update installment_lines set paid_transaction_id = ${touchingTxn}
        where plan_id = ${plan1} and seq = 1`;
      let nonTouchCode: string | undefined;
      await tx
        .savepoint(async (sp) => {
          await sp`update installment_lines set paid_transaction_id = ${nonTouchingTxn}
            where plan_id = ${plan1} and seq = 2`;
        })
        .catch((error: unknown) => {
          nonTouchCode = pgErrorCode(error);
        });
      assert(
        labels[2],
        linkTouching.count === 1 && nonTouchCode === "23514",
        `touching link rows = ${linkTouching.count}, non-touching sqlstate ${nonTouchCode ?? "none"}`,
      );

      // 74: a 200000 payment covers the two oldest 100000 lines in full and stops; the third stays unpaid.
      const [{ id: plan2 }] = await tx<{ id: string }[]>`
        insert into installment_plans (account_id, principal_cents, n_installments, frequency, start_date)
        values (${liability}, 300000, 3, 'monthly', (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into installment_lines (plan_id, seq, due_date, amount_cents) values
        (${plan2}, 1, '2026-04-15', 100000),
        (${plan2}, 2, '2026-05-15', 100000),
        (${plan2}, 3, '2026-06-15', 100000)`;
      const [{ id: paymentA }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${cash}, ${liability}, 200000, (now() at time zone 'America/Bogota')::date) returning id`;
      await allocate(plan2, paymentA, 200000);
      const paidA = await tx<{ seq: number; paid: boolean }[]>`
        select seq, paid_transaction_id is not null as paid from installment_lines
        where plan_id = ${plan2} order by seq`;
      assert(
        labels[3],
        paidA.length === 3 && paidA[0].paid && paidA[1].paid && !paidA[2].paid,
        `paid by seq = ${paidA.map((row) => `${row.seq}:${row.paid}`).join(", ")}`,
      );

      // 75: a 150000 payment covers only the first line; the 50000 remainder never touches the second.
      const [{ id: plan3 }] = await tx<{ id: string }[]>`
        insert into installment_plans (account_id, principal_cents, n_installments, frequency, start_date)
        values (${liability}, 300000, 3, 'monthly', (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into installment_lines (plan_id, seq, due_date, amount_cents) values
        (${plan3}, 1, '2026-07-15', 100000),
        (${plan3}, 2, '2026-08-15', 100000),
        (${plan3}, 3, '2026-09-15', 100000)`;
      const [{ id: paymentB }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${cash}, ${liability}, 150000, (now() at time zone 'America/Bogota')::date) returning id`;
      await allocate(plan3, paymentB, 150000);
      const paidB = await tx<{ seq: number; paid: boolean }[]>`
        select seq, paid_transaction_id is not null as paid from installment_lines
        where plan_id = ${plan3} order by seq`;
      const [{ pending: pendingB }] = await tx<{ pending: string }[]>`
        select coalesce(sum(amount_cents) filter (where paid_transaction_id is null), 0)::text as pending
        from installment_lines where plan_id = ${plan3}`;
      assert(
        labels[4],
        paidB[0].paid && !paidB[1].paid && !paidB[2].paid && pendingB === "200000",
        `paid by seq = ${paidB.map((row) => `${row.seq}:${row.paid}`).join(", ")}, pending = ${pendingB}`,
      );

      // 76: deleting the paying movement (FK set null) unlinks every covered line and the pending returns
      // to the full 300000 sum.
      await tx`delete from transactions where id = ${paymentA}`;
      const [afterDelete] = await tx<{ paid: string; pending: string }[]>`
        select
          count(*) filter (where paid_transaction_id is not null)::text as paid,
          coalesce(sum(amount_cents) filter (where paid_transaction_id is null), 0)::text as pending
        from installment_lines where plan_id = ${plan2}`;
      assert(
        labels[5],
        afterDelete.paid === "0" && afterDelete.pending === "300000",
        `linked lines after delete = ${afterDelete.paid}, pending = ${afterDelete.pending}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from accounts where name like 'rls installment%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls installment%' = ${probeCount}`,
  );
}

// Assertions 78-79: the derived debt figures. No new policy ships — what is proved is that the overview's
// arithmetic reads true. The monthly interest is the effective twelfth-root step of the annual rate, not
// the linear annual/12; available credit nets the limit against the owed; and total owed is the sum of the
// balances, which an installment plan (a schedule, never a movement) leaves untouched. The same SQL the
// overview runs is replicated inline, and every fixture is seeded through the app's own policies and rolled
// back.
async function checkDebtDerivedFigures() {
  console.log("");
  const leaderUser = randomUUID();

  const labels = [
    "78. the monthly interest is the effective rate, matching the hand figure and unlike the linear one",
    "79. available credit nets the limit against the owed, and a plan never double-counts the total owed",
  ];
  const tailLabel = "80. the rolled-back debt figures transaction leaves no trace";

  const forcedRollback = Symbol("forced rollback");

  // The liability is seeded at −1000000, so the owed magnitude is 1000000 at a 0.28 effective annual rate.
  const owed = 1000000;
  const rate = 0.28;
  const expectedEffective = Math.round(owed * (Math.pow(1 + rate, 1 / 12) - 1));
  const expectedLinear = Math.round((owed * rate) / 12);

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${leaderUser})`;
      await tx`insert into app_users (id) values (${leaderUser})`;
      await enterUserContext(tx, leaderUser);

      const [{ id: cardA }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_cents, initial_balance_on)
        values (${leaderUser}, 'rls debt figures card A', 'liability', -1000000, (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: cardB }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_cents, initial_balance_on)
        values (${leaderUser}, 'rls debt figures card B', 'liability', -500000, (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into debt_terms (account_id, debt_kind, annual_rate, minimum_payment_pct, credit_limit_cents)
        values (${cardA}, 'revolving', ${rate}, 0.05, 1500000)`;

      // 78: the SQL effective estimate matches the hand figure and diverges from the linear one.
      const [figures] = await tx<{ effective: string; linear: string }[]>`
        select
          round(abs(b.balance_cents) * (power(1 + dt.annual_rate, 1.0/12) - 1))::bigint as effective,
          round(abs(b.balance_cents) * dt.annual_rate / 12)::bigint as linear
        from account_balances b
        join debt_terms dt on dt.account_id = b.id
        where b.id = ${cardA}`;
      assert(
        labels[0],
        Number(figures.effective) === expectedEffective &&
          Number(figures.linear) === expectedLinear &&
          figures.effective !== figures.linear,
        `effective = ${figures.effective} (expected ${expectedEffective}), linear = ${figures.linear} (expected ${expectedLinear})`,
      );

      // 79: available credit = limit − owed; total owed is the sum of the two balances. Materialising an
      // installment plan over one card adds a schedule, no movement, so the total owed does not budge.
      const [before] = await tx<{ available: string; total_owed: string }[]>`
        select
          (dt.credit_limit_cents - abs(b.balance_cents))::text as available,
          (select sum(balance_cents) from account_balances where id in (${cardA}, ${cardB}))::text as total_owed
        from account_balances b
        join debt_terms dt on dt.account_id = b.id
        where b.id = ${cardA}`;
      const [{ id: plan }] = await tx<{ id: string }[]>`
        insert into installment_plans (account_id, principal_cents, n_installments, frequency, start_date)
        values (${cardA}, 900000, 3, 'monthly', (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into installment_lines (plan_id, seq, due_date, amount_cents) values
        (${plan}, 1, '2026-01-15', 300000),
        (${plan}, 2, '2026-02-15', 300000),
        (${plan}, 3, '2026-03-15', 300000)`;
      const [{ total_owed: totalAfter }] = await tx<{ total_owed: string }[]>`
        select (select sum(balance_cents) from account_balances where id in (${cardA}, ${cardB}))::text as total_owed`;
      assert(
        labels[1],
        before.available === "500000" &&
          before.total_owed === "-1500000" &&
          totalAfter === "-1500000",
        `available = ${before.available} (expected 500000), total owed before = ${before.total_owed}, after plan = ${totalAfter} (expected -1500000)`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from accounts where name like 'rls debt figures%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls debt figures%' = ${probeCount}`,
  );
}

// Assertions 81-84: the debt_statements snapshots. The generator, replicated inline, freezes the balance
// to the movements on or before a past cut-off; the unique key makes a re-run a no-op; and the snapshot is
// immutable — no UPDATE grant — and gated by the account's scope, so an unrelated user can neither read nor
// mint one. Every fixture is seeded through the app's own policies and rolled back.
async function checkDebtStatementPolicies() {
  console.log("");
  const subject = randomUUID();
  const otherUser = randomUUID();

  const labels = [
    "81. the statement balance counts only the movements on or before the cut-off",
    "82. re-running the same insert under the unique key inserts nothing",
    "83. an update of a statement by authenticated is refused",
    "84. an unrelated member can neither read nor write a statement on the subject's liability",
  ];
  const tailLabel = "85. the rolled-back debt statement transaction leaves no trace";

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${subject}), (${otherUser})`;
      await tx`insert into app_users (id) values (${subject}), (${otherUser})`;
      await enterUserContext(tx, subject);

      const [{ id: card }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_cents, initial_balance_on)
        values (${subject}, 'rls debt statement card', 'liability', -200000, (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: cash }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_cents, initial_balance_on)
        values (${subject}, 'rls debt statement cash', 'asset', 1000000, (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into debt_terms (account_id, debt_kind, annual_rate, minimum_payment_pct, statement_cut_off_day, payment_due_day)
        values (${card}, 'revolving', 0.28, 0.05, 28, 15)`;

      // A past cut-off in Bogotá and sane bounds around it: the previous month's last day as the cut-off,
      // its month start as the period start, a due date a fortnight on. A payment lands before the cut-off,
      // a purchase after it (RNF-06 — every bound is a YYYY-MM-DD string).
      const [dates] = await tx<
        {
          cut_off: string;
          period_start: string;
          payment_due: string;
          before_cut: string;
          after_cut: string;
        }[]
      >`
        select
          to_char((date_trunc('month', now() at time zone 'America/Bogota') - interval '1 day'), 'YYYY-MM-DD') as cut_off,
          to_char((date_trunc('month', now() at time zone 'America/Bogota') - interval '1 month'), 'YYYY-MM-DD') as period_start,
          to_char((date_trunc('month', now() at time zone 'America/Bogota') - interval '1 day') + interval '15 days', 'YYYY-MM-DD') as payment_due,
          to_char((date_trunc('month', now() at time zone 'America/Bogota') - interval '10 days'), 'YYYY-MM-DD') as before_cut,
          to_char((date_trunc('month', now() at time zone 'America/Bogota') + interval '5 days'), 'YYYY-MM-DD') as after_cut`;

      // A payment (cash→card, +30000) before the cut-off and a purchase (card→cash, −50000) after it.
      await tx`insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${cash}, ${card}, 30000, ${dates.before_cut})`;
      await tx`insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${card}, ${cash}, 50000, ${dates.after_cut})`;

      // The statement generator, replicated inline: the balance is the opening figure plus the signed
      // movement sum windowed to the cut-off (the same signed sum account_balances uses), the minimum a
      // percentage of it, the interest the effective estimate. Guarded by the unique key so a re-run
      // inserts nothing (RF-84).
      const generate = () =>
        tx<{ statement_balance_cents: string }[]>`
          insert into debt_statements
            (account_id, period_start, cut_off_date, payment_due_date, statement_balance_cents, minimum_payment_cents, interest_estimate_cents)
          select ${card}, ${dates.period_start}, ${dates.cut_off}, ${dates.payment_due},
            bal.statement_balance,
            round(abs(bal.statement_balance) * dt.minimum_payment_pct)::bigint,
            round(abs(bal.statement_balance) * (power(1 + dt.annual_rate, 1.0/12) - 1))::bigint
          from debt_terms dt
          join accounts a on a.id = dt.account_id
          cross join lateral (
            select a.initial_balance_cents
              + coalesce((select sum(t.amount_cents) from transactions t where t.to_account_id = ${card} and t.occurred_at <= ${dates.cut_off}), 0)
              - coalesce((select sum(t.amount_cents) from transactions t where t.from_account_id = ${card} and t.occurred_at <= ${dates.cut_off}), 0)
              as statement_balance
          ) bal
          where dt.account_id = ${card}
          on conflict (account_id, cut_off_date) do nothing
          returning statement_balance_cents`;

      // 81: the windowed balance is −200000 + 30000 = −170000; the post-cut −50000 purchase is excluded.
      const first = await generate();
      assert(
        labels[0],
        first.length === 1 && first[0].statement_balance_cents === "-170000",
        `inserted rows = ${first.length}, statement balance = ${first[0]?.statement_balance_cents} (expected -170000)`,
      );

      // 82: the second run collides on (account_id, cut_off_date) and inserts nothing.
      const second = await generate();
      assert(labels[1], second.length === 0, `second-run inserted rows = ${second.length}`);

      // 83: no UPDATE grant on debt_statements — a rewrite is refused outright (immutability).
      const [{ id: statementId }] = await tx<{ id: string }[]>`
        select id from debt_statements where account_id = ${card} and cut_off_date = ${dates.cut_off}`;
      let updateCode: string | undefined;
      await tx
        .savepoint(async (sp) => {
          await sp`update debt_statements set statement_balance_cents = 0 where id = ${statementId}`;
        })
        .catch((error: unknown) => {
          updateCode = pgErrorCode(error);
        });
      assert(labels[2], updateCode === "42501", `sqlstate ${updateCode ?? "none"}`);

      // 84: an unrelated user (no shared group) sees no statement on the subject's liability and cannot
      // mint one there. The distinct cut-off keeps the unique key clear, so only the write policy can reject.
      await enterUserContext(tx, otherUser);
      const [{ count: otherSees }] = await tx<{ count: string }[]>`
        select count(*)::text as count from debt_statements where id = ${statementId}`;
      let otherInsertCode: string | undefined;
      await tx
        .savepoint(async (sp) => {
          await sp`insert into debt_statements
            (account_id, period_start, cut_off_date, payment_due_date, statement_balance_cents, minimum_payment_cents, interest_estimate_cents)
            values (${card}, ${dates.period_start}, ${dates.before_cut}, ${dates.payment_due}, -100000, 5000, 2000)`;
        })
        .catch((error: unknown) => {
          otherInsertCode = pgErrorCode(error);
        });
      assert(
        labels[3],
        otherSees === "0" && otherInsertCode === "42501",
        `unrelated read = ${otherSees}, unrelated insert sqlstate ${otherInsertCode ?? "none"}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from accounts where name like 'rls debt statement%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls debt statement%' = ${probeCount}`,
  );
}

// Assertions 86-93: the webhook credentials. The owner-scoped policies isolate one user's credentials from
// another; the owner-stamp trigger sets owner_user_id from auth.uid() on insert; the column grant hides
// token_hash from authenticated; and the resolver — run on the base postgres connection outside any user
// context, as the object owner the grant is revoked for everyone else — yields the owner, defaults and a
// fixed-window throttle verdict only for a live, non-revoked token. Every fixture is seeded through the
// app's own policies and rolled back.
async function checkWebhookCredentialPolicies() {
  console.log("");
  const subject = randomUUID();
  const intruder = randomUUID();

  const labels = [
    "86. an insert without owner_user_id comes back stamped with auth.uid()",
    "87. a second user can neither read, update nor delete another's credential",
    "88. token_hash is unreadable by authenticated while name and defaults read back",
    "89. the resolver yields the owner, defaults and throttled=false for a live token and stamps last_used_at",
    "90. the resolver yields no row for a revoked token and none for an unknown hash",
    "91. the throttle admits calls up to the limit, each throttled=false",
    "92. the over-limit call is throttled=true and is not counted",
    "93. the throttle resets after the window expires and admits again",
  ];
  const tailLabel = "94. the rolled-back webhook credential transaction leaves no trace";

  // 64 hex chars each: the token_hash length check demands exactly that, and the unique index keeps them apart.
  const liveHash = createHash("sha256").update(randomUUID()).digest("hex");
  const throttleHash = createHash("sha256").update(randomUUID()).digest("hex");
  const unknownHash = createHash("sha256").update(randomUUID()).digest("hex");

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${subject}), (${intruder})`;
      await tx`insert into app_users (id) values (${subject}), (${intruder})`;

      // The resolver executes as the object owner postgres; a helper keeps its four-column read in one place.
      const resolve = (hash: string) =>
        tx<
          {
            owner_user_id: string;
            default_account_id: string | null;
            default_category_id: string | null;
            throttled: boolean;
          }[]
        >`select owner_user_id, default_account_id, default_category_id, throttled
          from private.resolve_webhook_credential(${hash})`;

      await enterUserContext(tx, subject);

      // The defaults the ingest falls back to, both of the subject's own scope.
      const [{ id: account }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${subject}, 'rls webhook cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: category }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${subject}, 'rls webhook category', 'expense') returning id`;

      // 86: the insert names no owner (it is absent from the grant); the trigger stamps it from auth.uid().
      const [live] = await tx<
        { id: string; owner_user_id: string; default_account_id: string | null; default_category_id: string | null }[]
      >`insert into webhook_credentials (name, token_hash, default_account_id, default_category_id)
        values ('rls webhook live', ${liveHash}, ${account}, ${category})
        returning id, owner_user_id, default_account_id, default_category_id`;
      assert(
        labels[0],
        live.owner_user_id === subject,
        `owner_user_id = ${live.owner_user_id === subject ? "subject" : live.owner_user_id}`,
      );

      // A small-window credential the throttle assertions exercise below.
      const [{ id: throttleCred }] = await tx<{ id: string }[]>`
        insert into webhook_credentials (name, token_hash, rate_limit_per_min)
        values ('rls webhook throttle', ${throttleHash}, 3) returning id`;

      // 87: the intruder shares no scope with the subject — the row is invisible and its writes touch nothing.
      await enterUserContext(tx, intruder);
      const [{ count: intruderSees }] = await tx<{ count: string }[]>`
        select count(*)::text as count from webhook_credentials where id = ${live.id}`;
      const intruderUpdate = await tx`update webhook_credentials set name = 'x' where id = ${live.id}`;
      const intruderDelete = await tx`delete from webhook_credentials where id = ${live.id}`;
      assert(
        labels[1],
        intruderSees === "0" && intruderUpdate.count === 0 && intruderDelete.count === 0,
        `visible = ${intruderSees}, update rows = ${intruderUpdate.count}, delete rows = ${intruderDelete.count}`,
      );

      // 88: the SELECT grant lists name and the defaults but never token_hash; reading the hash is denied
      // by the column privilege, even to the owner whose row is otherwise fully visible.
      await enterUserContext(tx, subject);
      const [{ name: readName }] = await tx<{ name: string }[]>`
        select name from webhook_credentials where id = ${live.id}`;
      let hashCode: string | undefined;
      await tx
        .savepoint(async (sp) => {
          await sp`select token_hash from webhook_credentials where id = ${live.id}`;
        })
        .catch((error: unknown) => {
          hashCode = pgErrorCode(error);
        });
      assert(
        labels[2],
        readName === "rls webhook live" && hashCode === "42501",
        `name = ${readName}, token_hash read sqlstate ${hashCode ?? "none"}`,
      );

      // 89: the resolver, on the base postgres connection, returns the owner, both defaults and a false
      // throttle verdict for the live token, and stamps last_used_at.
      await tx`reset role`;
      const resolvedLive = await resolve(liveHash);
      const [{ stamped }] = await tx<{ stamped: boolean }[]>`
        select last_used_at is not null as stamped from webhook_credentials where id = ${live.id}`;
      assert(
        labels[3],
        resolvedLive.length === 1 &&
          resolvedLive[0].owner_user_id === subject &&
          resolvedLive[0].default_account_id === account &&
          resolvedLive[0].default_category_id === category &&
          resolvedLive[0].throttled === false &&
          stamped === true,
        `rows = ${resolvedLive.length}, owner = ${resolvedLive[0]?.owner_user_id === subject}, account = ${resolvedLive[0]?.default_account_id === account}, category = ${resolvedLive[0]?.default_category_id === category}, throttled = ${resolvedLive[0]?.throttled}, last_used_at set = ${stamped}`,
      );

      // 90: a revoked token and an unknown hash each resolve to nothing — the route maps that to 401.
      await tx`update webhook_credentials set revoked_at = now() where id = ${live.id}`;
      const resolvedRevoked = await resolve(liveHash);
      const resolvedUnknown = await resolve(unknownHash);
      assert(
        labels[4],
        resolvedRevoked.length === 0 && resolvedUnknown.length === 0,
        `revoked rows = ${resolvedRevoked.length}, unknown rows = ${resolvedUnknown.length}`,
      );

      // 91: the fixed window admits every call up to the limit; the limit-th call is still let through.
      const throttleRuns = [
        await resolve(throttleHash),
        await resolve(throttleHash),
        await resolve(throttleHash),
      ];
      assert(
        labels[5],
        throttleRuns.every((run) => run.length === 1 && run[0].throttled === false),
        `throttled verdicts = ${throttleRuns.map((run) => run[0]?.throttled).join(", ")}`,
      );

      // 92: the next call within the window is a valid token but throttled, and it does not raise the count.
      const overLimit = await resolve(throttleHash);
      const [{ rate_count: heldCount }] = await tx<{ rate_count: string }[]>`
        select rate_count::text as rate_count from webhook_credentials where id = ${throttleCred}`;
      assert(
        labels[6],
        overLimit.length === 1 && overLimit[0].throttled === true && heldCount === "3",
        `rows = ${overLimit.length}, throttled = ${overLimit[0]?.throttled}, rate_count = ${heldCount} (expected 3)`,
      );

      // 93: back-dating the window past a minute makes the next call reset it and admit again at count 1.
      await tx`update webhook_credentials set rate_window_started_at = now() - interval '2 minutes'
        where id = ${throttleCred}`;
      const afterReset = await resolve(throttleHash);
      const [{ rate_count: resetCount }] = await tx<{ rate_count: string }[]>`
        select rate_count::text as rate_count from webhook_credentials where id = ${throttleCred}`;
      assert(
        labels[7],
        afterReset.length === 1 && afterReset[0].throttled === false && resetCount === "1",
        `rows = ${afterReset.length}, throttled = ${afterReset[0]?.throttled}, rate_count = ${resetCount} (expected 1)`,
      );

      // Forces `sql.begin` to issue ROLLBACK: nothing this function wrote may survive it.
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from webhook_credentials where name like 'rls webhook%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls webhook%' = ${probeCount}`,
  );
}

// Assertions 95-96: the load-bearing security proof. The webhook ingest opens its session by synthesising
// `authenticated` claims from a resolved user id — never a Supabase login. Replicating `withImpersonatedDb`'s
// settle INLINE (the harness cannot nest a `db.transaction`), the same claims key and the same authenticated
// role are set transaction-local. Under that session user A writes A's own account, but a write to user B's
// personal account is refused by the very RLS a browser session obeys. Every fixture is seeded through the
// app's own policies and rolled back.
async function checkImpersonationBounds() {
  console.log("");
  const userA = randomUUID();
  const userB = randomUUID();

  const labels = [
    "95. an impersonated session writes user A's own account and stamps created_by = A",
    "96. an impersonated session is refused on user B's personal account",
  ];
  const tailLabel = "97. the rolled-back impersonation transaction leaves no trace";

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${userA}), (${userB})`;
      await tx`insert into app_users (id) values (${userA}), (${userB})`;

      // A's personal account and expense category, seeded under A's own scope.
      await enterUserContext(tx, userA);
      const [{ id: accountA }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${userA}, 'rls impersonation A cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: categoryA }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${userA}, 'rls impersonation A expense', 'expense') returning id`;

      // B's personal account, seeded under B's own scope. No group ties A to B, so A holds no write over it.
      await tx`reset role`;
      await enterUserContext(tx, userB);
      const [{ id: accountB }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${userB}, 'rls impersonation B cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;

      // Synthesise A's authenticated claims inline, exactly as `withImpersonatedDb` does: the claims key
      // built with json_build_object and the authenticated role, both transaction-local. This is the
      // webhook ingest's session — a resolved user id, never a request payload — and it must obey RLS.
      await tx`reset role`;
      await tx`select set_config('request.jwt.claims',
        json_build_object('sub', ${userA}::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true)`;
      await tx`select set_config('statement_timeout', '8000', true)`;
      await tx`set local role authenticated`;

      // 95: the impersonated session writes A's own account — a movement row plus its one split, the ledger's
      // insert shape replicated inline. The scope trigger stamps created_by from the synthesised claims.
      const [ownWrite] = await tx<{ id: string; created_by: string }[]>`
        insert into transactions (from_account_id, amount_cents, occurred_at)
        values (${accountA}, 5000, (now() at time zone 'America/Bogota')::date)
        returning id, created_by`;
      await tx`insert into transaction_splits (transaction_id, category_id, amount_cents)
        values (${ownWrite.id}, ${categoryA}, 5000)`;
      assert(
        labels[0],
        ownWrite.created_by === userA,
        `created_by = ${ownWrite.created_by === userA ? "A" : ownWrite.created_by}`,
      );

      // 96: the same session may not touch B's personal account — can_write_transaction refuses it with
      // 42501, proving the synthesised-claims path is bounded by the exact RLS a login is.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into transactions (from_account_id, amount_cents, occurred_at)
            values (${accountB}, 5000, (now() at time zone 'America/Bogota')::date)`;
          assert(labels[1], false, "the impersonated session wrote B's account, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[1], pgErrorCode(error) === "42501", `sqlstate ${pgErrorCode(error) ?? "none"}`);
        });

      // Unwind the impersonated role before the rollback probe.
      await tx`reset role`;

      // Forces `sql.begin` to issue ROLLBACK: nothing this function wrote may survive it.
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from accounts where name like 'rls impersonation%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls impersonation%' = ${probeCount}`,
  );
}

// Assertions 98-102: the invite claim (RF-06). A group carries a pending member — `user_id` null,
// `invite_email` set — that the invited person claims once their magic link proves that email. The
// claim policy admits exactly the caller whose `auth.email()` matches the row's `invite_email`, setting
// `user_id` to their own sub and clearing the invite; a different email is filtered out, and a caller
// who already holds a live membership is stopped by the one-group index. Every fixture rolls back.
async function checkInviteClaimPolicies() {
  console.log("");
  const leaderUser = randomUUID();
  const invitedUser = randomUUID();
  const strangerUser = randomUUID();
  const busyUser = randomUUID();

  const invitedEmail = `invited-${randomUUID()}@example.test`;
  const busyEmail = `busy-${randomUUID()}@example.test`;
  const strangerEmail = `stranger-${randomUUID()}@example.test`;

  const groupId = randomUUID();
  const busyGroupId = randomUUID();

  const labels = [
    "98. the invited caller claims their pending row, setting user_id and clearing the invite",
    "99. a caller whose email does not match the invite claims nothing",
    "100. a caller who already holds a live membership is refused a second by the one-group index",
    "101. row security stays enabled and forced on group_members",
  ];
  const tailLabel = "102. the rolled-back invite transaction leaves no trace";

  // 101: read the flags outside any transaction, so FORCE is proved on the committed catalog, not a local edit.
  const [gmRel] = await sql<{ rowsecurity: boolean; forced: boolean }[]>`
    select relrowsecurity as rowsecurity, relforcerowsecurity as forced
    from pg_class where oid = 'public.group_members'::regclass`;
  assert(
    labels[3],
    gmRel.rowsecurity === true && gmRel.forced === true,
    `relrowsecurity = ${gmRel.rowsecurity}, relforcerowsecurity = ${gmRel.forced}`,
  );

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${leaderUser}), (${invitedUser}), (${strangerUser}), (${busyUser})`;
      await tx`insert into app_users (id) values (${leaderUser}), (${invitedUser}), (${strangerUser}), (${busyUser})`;

      // The target group and its leader, plus two pending members the leader records (RF-07): one invite
      // waits on the plain invited caller, the other on the caller who already leads a group of their own.
      await enterUserContext(tx, leaderUser);
      await tx`insert into groups (id, name, cash_mode) values (${groupId}, 'rls invite', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${leaderUser}, 'rls invite leader', 'leader')`;
      const [{ id: pendingInvited }] = await tx<{ id: string }[]>`
        insert into group_members (group_id, name, role, invite_email)
        values (${groupId}, 'rls invite pending', 'member', ${invitedEmail}) returning id`;
      await tx`insert into group_members (group_id, name, role, invite_email)
        values (${groupId}, 'rls invite pending busy', 'member', ${busyEmail})`;

      // The busy caller leads a group of their own: a live membership that blocks any second claim.
      await tx`reset role`;
      await enterUserContext(tx, busyUser, busyEmail);
      await tx`insert into groups (id, name, cash_mode) values (${busyGroupId}, 'rls invite busy', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${busyGroupId}, ${busyUser}, 'rls invite busy leader', 'leader')`;

      // 98: the invited caller claims their own pending row. The SELECT policy still hides an unclaimed
      // row from the outsider, so the caller could not name it even if the claim took a target; it takes
      // none, and picks the row addressed to the email their magic link proved.
      await tx`reset role`;
      await enterUserContext(tx, invitedUser, invitedEmail);
      const [{ count: preClaimVisible }] = await tx<{ count: string }[]>`
        select count(*)::text as count from group_members where id = ${pendingInvited}`;
      const [{ claim_group_invite: claimedId }] = await tx<
        { claim_group_invite: string | null }[]
      >`select private.claim_group_invite()`;
      const [claimed] = await tx<{ user_id: string | null; invite_email: string | null; role: string }[]>`
        select user_id, invite_email, role from group_members where id = ${pendingInvited}`;
      assert(
        labels[0],
        preClaimVisible === "0" &&
          claimedId === pendingInvited &&
          claimed.user_id === invitedUser &&
          claimed.invite_email === null &&
          claimed.role === "member",
        `pre-claim visible = ${preClaimVisible}, claimed = ${claimedId === pendingInvited ? "the pending row" : claimedId}, user_id = ${claimed?.user_id === invitedUser ? "self" : claimed?.user_id}, invite_email = ${claimed?.invite_email}, role = ${claimed?.role}`,
      );

      // 99: a caller whose email matches no invite claims nothing — the function matches on auth.email()
      // alone, so there is no row for it to pick.
      await tx`reset role`;
      await enterUserContext(tx, strangerUser, strangerEmail);
      const [{ claim_group_invite: strangerId }] = await tx<
        { claim_group_invite: string | null }[]
      >`select private.claim_group_invite()`;
      assert(labels[1], strangerId === null, `returned ${strangerId ?? "null"}`);

      // 100: the busy caller's email matches the invite, so the function picks the pending row; the
      // one-group-per-user index then refuses it, since the caller already holds a live membership.
      await tx`reset role`;
      await enterUserContext(tx, busyUser, busyEmail);
      await tx
        .savepoint(async (sp) => {
          await sp`select private.claim_group_invite()`;
          assert(labels[2], false, "a second live membership landed, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[2], pgErrorCode(error) === "23505", `sqlstate ${pgErrorCode(error) ?? "none"}`);
        });

      // Forces `sql.begin` to issue ROLLBACK: nothing this function wrote may survive it.
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from groups where name like 'rls invite%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls invite%' = ${probeCount}`,
  );
}

// Assertions 105-108: the recurring rules and their in-DB generator. Read is universal inside the group
// and closed to an outsider; write is bounded to own-or-shared accounts and the scope is the trigger's,
// not the caller's; and `private.run_due_recurring_rules()`, run with no JWT like the daily cron, back-fills
// one unreviewed single-split transaction per missed period and advances the rule. Every fixture is seeded
// through the app's own policies and rolled back.
async function checkRecurringRulePolicies() {
  console.log("");
  const leaderUser = randomUUID();
  const memberUser = randomUUID();
  const intruderUser = randomUUID();
  const groupId = randomUUID();
  const intruderGroup = randomUUID();

  const labels = [
    "105. a member reads their own personal rule and the group's rule while an outsider reads neither",
    "106. a rule naming an account outside the caller's writable scope is refused",
    "107. a rule on an own account lands with the trigger's derived scope, not a supplied one",
    "108. the generator back-fills one unreviewed single-split transaction per missed period and advances the rule",
    "109. the member stamps reviewed_at on their generated row and it drops the unreviewed predicate; an outsider cannot",
  ];
  const tailLabel = "110. the rolled-back recurring rule transaction leaves no trace";

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${leaderUser}), (${memberUser}), (${intruderUser})`;
      await tx`insert into app_users (id) values (${leaderUser}), (${memberUser}), (${intruderUser})`;

      // The group, its leader, a personal leader account, a shared group account and a group expense category.
      await enterUserContext(tx, leaderUser);
      await tx`insert into groups (id, name, cash_mode) values (${groupId}, 'rls recurring', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${leaderUser}, 'rls recurring leader', 'leader')`;
      const [{ id: leaderAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls recurring leader cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: sharedAccount }] = await tx<{ id: string }[]>`
        insert into accounts (group_id, is_shared, name, kind, initial_balance_on)
        values (${groupId}, true, 'rls recurring shared cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: groupExpenseCat }] = await tx<{ id: string }[]>`
        insert into categories (group_id, name, kind)
        values (${groupId}, 'rls recurring group expense', 'expense') returning id`;

      // A group-scoped rule on the shared account, due only in the future so the generator leaves it be.
      const [{ id: groupRule }] = await tx<{ id: string }[]>`
        insert into recurring_rules (from_account_id, amount_cents, category_id, frequency, interval_n, day_of_month, next_run_on)
        values (${sharedAccount}, 6000, ${groupExpenseCat}, 'monthly', 1, 15,
          (now() at time zone 'America/Bogota')::date + 30) returning id`;

      // The plain member with their own account and expense category, seeded through their own context.
      await tx`reset role`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${memberUser}, 'rls recurring member', 'member')`;
      await enterUserContext(tx, memberUser);
      const [{ id: memberAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${memberUser}, 'rls recurring member cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: memberExpenseCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${memberUser}, 'rls recurring member expense', 'expense') returning id`;

      // 107: a rule on the member's own account lands personal, its scope and author the trigger's, not supplied.
      const [personalRule] = await tx<
        { id: string; owner_user_id: string | null; group_id: string | null; created_by: string }[]
      >`insert into recurring_rules (from_account_id, amount_cents, category_id, frequency, interval_n, day_of_month, next_run_on)
        values (${memberAccount}, 5000, ${memberExpenseCat}, 'monthly', 1, 15,
          (now() at time zone 'America/Bogota')::date + 30)
        returning id, owner_user_id, group_id, created_by`;
      assert(
        labels[2],
        personalRule.owner_user_id === memberUser &&
          personalRule.group_id === null &&
          personalRule.created_by === memberUser,
        `owner = ${personalRule.owner_user_id === memberUser ? "self" : personalRule.owner_user_id}, group = ${personalRule.group_id}, created_by = ${personalRule.created_by === memberUser}`,
      );

      // 106: the bounded write — the member may not book a rule out of the leader's personal account.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into recurring_rules (from_account_id, amount_cents, category_id, frequency, interval_n, day_of_month, next_run_on)
            values (${leaderAccount}, 5000, ${memberExpenseCat}, 'monthly', 1, 15,
              (now() at time zone 'America/Bogota')::date + 30)`;
          assert(labels[1], false, "a rule on another's account stood, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[1], pgErrorCode(error) === "42501", `sqlstate ${pgErrorCode(error) ?? "none"}`);
        });

      // An outsider who leads a group of their own and shares nothing with the member.
      await tx`reset role`;
      await enterUserContext(tx, intruderUser);
      await tx`insert into groups (id, name, cash_mode) values (${intruderGroup}, 'rls recurring intruder', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${intruderGroup}, ${intruderUser}, 'rls recurring intruder leader', 'leader')`;

      // 105: universal read inside the group, closed outside it.
      const [{ count: outsiderSeesPersonal }] = await tx<{ count: string }[]>`
        select count(*)::text as count from recurring_rules where id = ${personalRule.id}`;
      const [{ count: outsiderSeesGroup }] = await tx<{ count: string }[]>`
        select count(*)::text as count from recurring_rules where id = ${groupRule}`;
      await enterUserContext(tx, memberUser);
      const [{ count: memberSeesPersonal }] = await tx<{ count: string }[]>`
        select count(*)::text as count from recurring_rules where id = ${personalRule.id}`;
      const [{ count: memberSeesGroup }] = await tx<{ count: string }[]>`
        select count(*)::text as count from recurring_rules where id = ${groupRule}`;
      assert(
        labels[0],
        memberSeesPersonal === "1" &&
          memberSeesGroup === "1" &&
          outsiderSeesPersonal === "0" &&
          outsiderSeesGroup === "0",
        `member→own = ${memberSeesPersonal}, member→group = ${memberSeesGroup}, outsider→own = ${outsiderSeesPersonal}, outsider→group = ${outsiderSeesGroup}`,
      );

      // 108: a weekly rule three weeks overdue, generated with no JWT the way the daily cron runs it.
      const [{ id: dueRule }] = await tx<{ id: string }[]>`
        insert into recurring_rules (from_account_id, amount_cents, category_id, frequency, interval_n, next_run_on)
        values (${memberAccount}, 4000, ${memberExpenseCat}, 'weekly', 1,
          (now() at time zone 'America/Bogota')::date - 21) returning id`;

      // The generator runs as the owner with the JWT claims cleared, so `auth.uid()` is null like the cron's.
      await tx`reset role`;
      await tx`select set_config('request.jwt.claims', '', true)`;
      await tx`select private.run_due_recurring_rules()`;
      // Force the deferred split-sum triggers now, proving every generated movement balances its one split.
      await tx`set constraints all immediate`;

      const generated = await tx<
        { id: string; occurred_at: string; recurring_rule_id: string | null; reviewed_at: string | null; splits: string }[]
      >`
        select t.id, t.occurred_at::text as occurred_at, t.recurring_rule_id, t.reviewed_at,
          (select count(*)::text from transaction_splits s where s.transaction_id = t.id) as splits
        from transactions t
        where t.recurring_rule_id = ${dueRule}
        order by t.occurred_at`;
      const [{ expected }] = await tx<{ expected: string[] }[]>`
        select array[
          ((now() at time zone 'America/Bogota')::date - 21)::text,
          ((now() at time zone 'America/Bogota')::date - 14)::text,
          ((now() at time zone 'America/Bogota')::date - 7)::text,
          ((now() at time zone 'America/Bogota')::date)::text
        ] as expected`;
      const [{ count: unreviewed }] = await tx<{ count: string }[]>`
        select count(*)::text as count from transactions
        where recurring_rule_id = ${dueRule} and recurring_rule_id is not null and reviewed_at is null`;
      const [advanced] = await tx<{ next_run_on: string; is_active: boolean }[]>`
        select next_run_on::text, is_active from recurring_rules where id = ${dueRule}`;
      const [{ next_expected: nextExpected }] = await tx<{ next_expected: string }[]>`
        select ((now() at time zone 'America/Bogota')::date + 7)::text as next_expected`;

      const datesMatch =
        generated.length === expected.length &&
        generated.every((row, i) => row.occurred_at === expected[i]);
      const allMarked = generated.every(
        (row) => row.recurring_rule_id === dueRule && row.reviewed_at === null && row.splits === "1",
      );
      assert(
        labels[3],
        datesMatch &&
          allMarked &&
          unreviewed === String(expected.length) &&
          advanced.next_run_on === nextExpected &&
          advanced.is_active === true,
        `generated = ${generated.length} (expected ${expected.length}), dates match = ${datesMatch}, each marked+single-split = ${allMarked}, unreviewed = ${unreviewed}, next_run_on advanced = ${advanced.next_run_on === nextExpected}, is_active = ${advanced.is_active}`,
      );

      // 109: the review write. The row is the member's own, so as `authenticated` they stamp reviewed_at
      // through the new column grant and it leaves the unreviewed set; the outsider's write is barred by RLS.
      const reviewTarget = generated[0].id;
      await enterUserContext(tx, memberUser);
      const memberReview = await tx`update transactions set reviewed_at = now() where id = ${reviewTarget}`;
      const [{ count: stillUnreviewed }] = await tx<{ count: string }[]>`
        select count(*)::text as count from transactions
        where recurring_rule_id = ${dueRule} and recurring_rule_id is not null and reviewed_at is null`;
      await enterUserContext(tx, intruderUser);
      const outsiderReview = await tx`update transactions set reviewed_at = now() where id = ${reviewTarget}`;
      assert(
        labels[4],
        memberReview.count === 1 &&
          stillUnreviewed === String(expected.length - 1) &&
          outsiderReview.count === 0,
        `member review rows = ${memberReview.count}, remaining unreviewed = ${stillUnreviewed} (expected ${expected.length - 1}), outsider review rows = ${outsiderReview.count}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from groups where name like 'rls recurring%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls recurring%' = ${probeCount}`,
  );
}

// Assertions 111-116: the audit log. The definer trigger captures every write on an audited table
// (RF-43); the log itself is locked to every user role, readable and writable by none (RF-44); the
// recurring generator's own writes are captured with a null actor, marking a system write (RF-45); no
// RLS-enabled table save the log escapes the trigger (RF-45); and the daily purge drops rows past the
// 24-month horizon while sparing the recent (RNF-14). Fixtures roll back with their transaction.
async function checkAuditLogPolicies() {
  console.log("");
  const subject = randomUUID();

  const labels = [
    "111. an authenticated insert, update and delete of a category each land one audit row with the right action, before/after and the caller as actor",
    "112. an authenticated insert, update and delete against the log are each refused",
    "113. the recurring generator's transaction and its split are captured with a null actor",
    "114. every RLS-enabled table save the log itself carries the capture trigger",
    "115. the purge drops a row past 24 months and keeps a recent one",
  ];
  const tailLabel = "116. the rolled-back audit transaction leaves no trace";

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${subject})`;
      await tx`insert into app_users (id) values (${subject})`;

      // 111: the caller's own category, changed then removed; the definer trigger lands one row per op.
      await enterUserContext(tx, subject);
      const [{ id: catId }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${subject}, 'rls audit category', 'expense') returning id`;
      await tx`update categories set name = 'rls audit category renamed' where id = ${catId}`;
      await tx`delete from categories where id = ${catId}`;

      await tx`reset role`;
      const capRows = await tx<
        { action: string; actor_user_id: string | null; before_null: boolean; after_null: boolean }[]
      >`select action, actor_user_id, before_data is null as before_null, after_data is null as after_null
        from audit_log where entity = 'categories' and record_id = ${catId} order by id`;
      const capOk =
        capRows.length === 3 &&
        capRows[0].action === "INSERT" && capRows[0].before_null && !capRows[0].after_null &&
        capRows[1].action === "UPDATE" && !capRows[1].before_null && !capRows[1].after_null &&
        capRows[2].action === "DELETE" && !capRows[2].before_null && capRows[2].after_null &&
        capRows.every((row) => row.actor_user_id === subject);
      assert(
        labels[0],
        capOk,
        `rows = ${capRows.length}, actions = ${capRows.map((r) => r.action).join(",")}, actor = ${capRows.every((r) => r.actor_user_id === subject) ? "caller" : "other"}`,
      );

      // 112: the log grants no write to any user role (RF-44), so each direct mutation is denied (42501).
      // SELECT is now the sole user privilege — its bound is proved in checkAuditViewerPolicy below.
      await enterUserContext(tx, subject);
      const barred = { insert: "", update: "", delete: "" };
      await tx
        .savepoint(async (sp) => {
          await sp`insert into audit_log (entity, record_id, action) values ('categories', ${catId}, 'INSERT')`;
        })
        .catch((error: unknown) => {
          barred.insert = pgErrorCode(error) ?? "none";
        });
      await tx
        .savepoint(async (sp) => {
          await sp`update audit_log set action = 'DELETE' where entity = 'categories'`;
        })
        .catch((error: unknown) => {
          barred.update = pgErrorCode(error) ?? "none";
        });
      await tx
        .savepoint(async (sp) => {
          await sp`delete from audit_log where entity = 'categories'`;
        })
        .catch((error: unknown) => {
          barred.delete = pgErrorCode(error) ?? "none";
        });
      assert(
        labels[1],
        barred.insert === "42501" && barred.update === "42501" && barred.delete === "42501",
        `insert = ${barred.insert}, update = ${barred.update}, delete = ${barred.delete}`,
      );

      // 113: a rule one period overdue, generated with the JWT cleared the way the daily cron runs it.
      // Both the movement and its split are captured with a null actor — the mark of a system write.
      await enterUserContext(tx, subject);
      const [{ id: dueAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${subject}, 'rls audit account', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: dueCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${subject}, 'rls audit expense', 'expense') returning id`;
      const [{ id: dueRule }] = await tx<{ id: string }[]>`
        insert into recurring_rules (from_account_id, amount_cents, category_id, frequency, interval_n, next_run_on)
        values (${dueAccount}, 4000, ${dueCat}, 'weekly', 1, (now() at time zone 'America/Bogota')::date - 7) returning id`;

      await tx`reset role`;
      await tx`select set_config('request.jwt.claims', '', true)`;
      await tx`select private.run_due_recurring_rules()`;
      await tx`set constraints all immediate`;

      const [{ id: genTxn }] = await tx<{ id: string }[]>`
        select id from transactions where recurring_rule_id = ${dueRule} limit 1`;
      const [{ id: genSplit }] = await tx<{ id: string }[]>`
        select id from transaction_splits where transaction_id = ${genTxn} limit 1`;
      const [txnAudit] = await tx<{ actor_user_id: string | null }[]>`
        select actor_user_id from audit_log where entity = 'transactions' and record_id = ${genTxn}`;
      const [splitAudit] = await tx<{ actor_user_id: string | null }[]>`
        select actor_user_id from audit_log where entity = 'transaction_splits' and record_id = ${genSplit}`;
      assert(
        labels[2],
        txnAudit?.actor_user_id === null && splitAudit?.actor_user_id === null,
        `transaction actor = ${txnAudit?.actor_user_id ?? "null"}, split actor = ${splitAudit?.actor_user_id ?? "null"}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  // 114: no audited write path skips capture — every RLS-enabled public table but the log itself
  // carries a `capture_audit` trigger. Runs outside any role switch; it reads only the catalog.
  const uncovered = await sql<{ tablename: string }[]>`
    select c.relname as tablename
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname <> 'audit_log'
      and not exists (
        select 1 from pg_trigger t
        where t.tgrelid = c.oid and t.tgname = 'capture_audit' and not t.tgisinternal)`;
  assert(
    labels[3],
    uncovered.length === 0,
    `RLS tables missing the trigger = ${uncovered.length}${uncovered.length ? " (" + uncovered.map((r) => r.tablename).join(", ") + ")" : ""}`,
  );

  // 115: the purge is age-bounded. Seed one row past the horizon and one fresh, purge, and read back.
  await sql
    .begin(async (tx) => {
      const agedId = randomUUID();
      const freshId = randomUUID();
      await tx`insert into audit_log (entity, record_id, action, occurred_at)
        values ('categories', ${agedId}, 'INSERT', now() - interval '25 months')`;
      await tx`insert into audit_log (entity, record_id, action, occurred_at)
        values ('categories', ${freshId}, 'INSERT', now())`;
      await tx`select private.purge_audit_log()`;
      const [{ count: agedLeft }] = await tx<{ count: string }[]>`
        select count(*)::text as count from audit_log where record_id = ${agedId}`;
      const [{ count: freshLeft }] = await tx<{ count: string }[]>`
        select count(*)::text as count from audit_log where record_id = ${freshId}`;
      assert(
        labels[4],
        agedLeft === "0" && freshLeft === "1",
        `aged rows left = ${agedLeft} (expected 0), recent rows left = ${freshLeft} (expected 1)`,
      );
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from categories where name like 'rls audit%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls audit%' = ${probeCount}`,
  );
}

// Assertions 129-132: the read-only audit viewer (RF-53). The 0010 policy admits three kinds of row —
// one scoped to the reader personally, one scoped to a group they belong to, and one they themselves
// caused (the last surfaces the unscoped child rows to their actor alone) — and nothing else. A row of
// another user's personal scope or caused only by them stays hidden. The write ban (RF-44) holds: the
// reader's own INSERT, UPDATE and DELETE on the log are each refused. Fixtures roll back.
async function checkAuditViewerPolicy() {
  console.log("");
  const readerUser = randomUUID();
  const strangerUser = randomUUID();
  const groupId = randomUUID();

  const labels = [
    "129. the reader sees its own-scope row, its group-scope row and the unscoped row it caused",
    "130. the reader sees neither a stranger's personal-scope row nor the unscoped row the stranger caused",
    "131. the reader's insert, update and delete against the log are each refused",
  ];
  const tailLabel = "132. the rolled-back audit-viewer transaction leaves no trace";

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${readerUser}), (${strangerUser})`;
      await tx`insert into app_users (id) values (${readerUser}), (${strangerUser})`;

      // The reader, its group and its leadership: the personal category stamps an owner-scoped audit row,
      // the group category a group-scoped one, and the income's split an unscoped one the reader caused.
      await enterUserContext(tx, readerUser);
      await tx`insert into groups (id, name, cash_mode) values (${groupId}, 'rls audit viewer', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${readerUser}, 'rls audit viewer reader', 'leader')`;
      const [{ id: readerCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${readerUser}, 'rls audit viewer personal', 'expense') returning id`;
      const [{ id: readerGroupCat }] = await tx<{ id: string }[]>`
        insert into categories (group_id, name, kind)
        values (${groupId}, 'rls audit viewer group', 'expense') returning id`;
      const [{ id: readerAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${readerUser}, 'rls audit viewer cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: readerIncomeCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${readerUser}, 'rls audit viewer income', 'income') returning id`;
      const [{ id: readerTxn }] = await tx<{ id: string }[]>`
        insert into transactions (to_account_id, amount_cents, occurred_at)
        values (${readerAccount}, 5000, (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: readerSplit }] = await tx<{ id: string }[]>`
        insert into transaction_splits (transaction_id, category_id, amount_cents)
        values (${readerTxn}, ${readerIncomeCat}, 5000) returning id`;

      // The stranger, in a scope of their own and no shared group: a personal category and the split of
      // their own income — an owner-scoped row and an unscoped row the stranger, not the reader, caused.
      await enterUserContext(tx, strangerUser);
      const [{ id: strangerCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${strangerUser}, 'rls audit viewer stranger', 'expense') returning id`;
      const [{ id: strangerAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${strangerUser}, 'rls audit viewer stranger cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: strangerIncomeCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${strangerUser}, 'rls audit viewer stranger income', 'income') returning id`;
      const [{ id: strangerTxn }] = await tx<{ id: string }[]>`
        insert into transactions (to_account_id, amount_cents, occurred_at)
        values (${strangerAccount}, 5000, (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: strangerSplit }] = await tx<{ id: string }[]>`
        insert into transaction_splits (transaction_id, category_id, amount_cents)
        values (${strangerTxn}, ${strangerIncomeCat}, 5000) returning id`;

      // 129: back under the reader, each branch of the predicate yields its row.
      await enterUserContext(tx, readerUser);
      const [{ count: ownScope }] = await tx<{ count: string }[]>`
        select count(*)::text as count from audit_log where entity = 'categories' and record_id = ${readerCat}`;
      const [{ count: groupScope }] = await tx<{ count: string }[]>`
        select count(*)::text as count from audit_log where entity = 'categories' and record_id = ${readerGroupCat}`;
      const [{ count: selfCaused }] = await tx<{ count: string }[]>`
        select count(*)::text as count from audit_log where entity = 'transaction_splits' and record_id = ${readerSplit}`;
      assert(
        labels[0],
        ownScope === "1" && groupScope === "1" && selfCaused === "1",
        `own-scope = ${ownScope}, group-scope = ${groupScope}, self-caused unscoped = ${selfCaused}`,
      );

      // 130: no branch reaches the stranger's personal row or the unscoped row only the stranger caused.
      const [{ count: strangerScope }] = await tx<{ count: string }[]>`
        select count(*)::text as count from audit_log where entity = 'categories' and record_id = ${strangerCat}`;
      const [{ count: strangerCaused }] = await tx<{ count: string }[]>`
        select count(*)::text as count from audit_log where entity = 'transaction_splits' and record_id = ${strangerSplit}`;
      assert(
        labels[1],
        strangerScope === "0" && strangerCaused === "0",
        `stranger personal-scope = ${strangerScope}, stranger-caused unscoped = ${strangerCaused}`,
      );

      // 131: the viewer grant is SELECT only (RF-44) — every direct mutation is still denied (42501).
      const barred = { insert: "", update: "", delete: "" };
      await tx
        .savepoint(async (sp) => {
          await sp`insert into audit_log (entity, record_id, action) values ('categories', ${readerCat}, 'INSERT')`;
        })
        .catch((error: unknown) => {
          barred.insert = pgErrorCode(error) ?? "none";
        });
      await tx
        .savepoint(async (sp) => {
          await sp`update audit_log set action = 'DELETE' where record_id = ${readerCat}`;
        })
        .catch((error: unknown) => {
          barred.update = pgErrorCode(error) ?? "none";
        });
      await tx
        .savepoint(async (sp) => {
          await sp`delete from audit_log where record_id = ${readerCat}`;
        })
        .catch((error: unknown) => {
          barred.delete = pgErrorCode(error) ?? "none";
        });
      assert(
        labels[2],
        barred.insert === "42501" && barred.update === "42501" && barred.delete === "42501",
        `insert = ${barred.insert}, update = ${barred.update}, delete = ${barred.delete}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from groups where name = 'rls audit viewer'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls audit viewer' = ${probeCount}`,
  );
}

// Assertions 117-122: the durable account `subtype` (RF-56). The 0009 backfill classified every prior
// row — seeded cash to 'efectivo', any other liability to 'tarjeta', any other asset to 'bancaria' —
// and no row is left null; the subtype↔kind CHECK refuses a mismatch; the derive trigger fills an
// omitted subtype while the column grant lets a member pass and later change one; and the widened
// column changed no read policy, so a non-member still cannot SELECT another group's cash account.
// Fixtures roll back.
async function checkAccountSubtypeBackfill() {
  console.log("");
  const leaderUser = randomUUID();
  const memberUser = randomUUID();
  const outsiderUser = randomUUID();
  const groupId = randomUUID();

  const labels = [
    "117. the backfill's three outcomes hold: a seeded cash account is 'efectivo', a card 'tarjeta', a bank 'bancaria'",
    "118. no accounts row across the whole table carries a null subtype",
    "119. the subtype↔kind check refuses a liability marked efectivo — the one subtype the trigger keeps",
    "120. the derive trigger fills the caller-ungranted column, so an authenticated insert omitting subtype lands",
    "121. a non-member cannot SELECT another group's efectivo account — the widened column changed no read policy",
    "122. the column grant lets a member insert an explicit efectivo and later change it to bancaria; an efectivo liability is still refused",
  ];
  const tailLabel = "123. the rolled-back subtype transaction leaves no trace";

  // The exact CASE the 0009 backfill applied, replicated so the proof reads what the migration ran.
  const backfillSubtype = (name: string, kind: string) =>
    ["Efectivo del grupo", "Group cash", "Mi efectivo", "My cash"].includes(name)
      ? "efectivo"
      : kind === "liability"
        ? "tarjeta"
        : "bancaria";

  const forcedRollback = Symbol("forced rollback");

  // 118: a table-wide read outside any role switch — the applied migration left every existing row set.
  const [{ count: nullCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from accounts where subtype is null`;

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${leaderUser}), (${memberUser}), (${outsiderUser})`;
      await tx`insert into app_users (id) values (${leaderUser}), (${memberUser}), (${outsiderUser})`;

      await enterUserContext(tx, leaderUser);
      await tx`insert into groups (id, name, cash_mode) values (${groupId}, 'rls subtype', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${leaderUser}, 'rls subtype leader', 'leader')`;

      // The group's shared cash account. `efectivo` carries no INSERT grant, so it is seeded as the owner
      // with the value the backfill would have written, exactly as a renamed-free seeded cash row holds it.
      await tx`reset role`;
      const cashName = GROUP_CASH_ACCOUNT_NAME.es;
      const [{ id: cashAccount, subtype: cashSubtype }] = await tx<{ id: string; subtype: string }[]>`
        insert into accounts (group_id, is_shared, name, kind, subtype, initial_balance_on)
        values (${groupId}, true, ${cashName}, 'asset', 'efectivo', (now() at time zone 'America/Bogota')::date)
        returning id, subtype`;

      // A card and a bank, seeded through the leader's own context omitting subtype: the derive trigger
      // sets 'tarjeta' for the liability and 'bancaria' for the asset — the backfill's other two outcomes.
      await enterUserContext(tx, leaderUser);
      const [{ subtype: cardSubtype }] = await tx<{ subtype: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_cents, initial_balance_on)
        values (${leaderUser}, 'rls subtype leader card', 'liability', -100000, (now() at time zone 'America/Bogota')::date)
        returning subtype`;
      const [{ subtype: bankSubtype }] = await tx<{ subtype: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls subtype leader bank', 'asset', (now() at time zone 'America/Bogota')::date)
        returning subtype`;

      assert(
        labels[0],
        cashSubtype === backfillSubtype(cashName, "asset") &&
          cardSubtype === backfillSubtype("rls subtype leader card", "liability") &&
          bankSubtype === backfillSubtype("rls subtype leader bank", "asset") &&
          cashSubtype === "efectivo" && cardSubtype === "tarjeta" && bankSubtype === "bancaria",
        `cash = ${cashSubtype}, card = ${cardSubtype}, bank = ${bankSubtype}`,
      );

      assert(labels[1], nullCount === "0", `rows with a null subtype = ${nullCount}`);

      // 119: the subtype↔kind check. The trigger rewrites any non-'efectivo' value to follow the kind,
      // so 'efectivo' is the sole value it preserves — and 'efectivo' on a liability is what the CHECK
      // must reject. Seeded as the owner so the explicit value reaches the row untouched.
      let checkBreach = "";
      await tx
        .savepoint(async (sp) => {
          await sp`reset role`;
          await sp`insert into accounts (owner_user_id, name, kind, subtype, initial_balance_cents, initial_balance_on)
            values (${leaderUser}, 'rls subtype cash card', 'liability', 'efectivo', -100, (now() at time zone 'America/Bogota')::date)`;
          assert(labels[2], false, "an efectivo liability landed, which the check must not allow");
        })
        .catch((error: unknown) => {
          checkBreach = pgErrorCode(error) ?? "none";
          assert(labels[2], checkBreach === "23514", `sqlstate ${checkBreach}`);
        });

      // 120: the derive trigger already carried the two inserts above; assert both landed non-null.
      assert(
        labels[3],
        cardSubtype !== null && bankSubtype !== null,
        `authenticated insert filled card = ${cardSubtype}, bank = ${bankSubtype}`,
      );

      // 121: an outsider in no shared group sees zero rows for the group's efectivo account.
      await enterUserContext(tx, outsiderUser);
      const [{ count: outsiderSees }] = await tx<{ count: string }[]>`
        select count(*)::text as count from accounts where id = ${cashAccount}`;
      assert(labels[4], outsiderSees === "0", `visible rows = ${outsiderSees}`);

      // 122: the column grant, exercised as an authenticated member in scope. A member creates a cash
      // account by passing 'efectivo' — the trigger keeps the explicit value — then changes it to
      // 'bancaria'; but an 'efectivo' on a liability is still barred by the subtype↔kind CHECK.
      await enterUserContext(tx, memberUser);
      await tx`reset role`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${memberUser}, 'rls subtype member', 'member')`;
      await enterUserContext(tx, memberUser);
      const [{ subtype: pickedSubtype, id: pickedAccount }] = await tx<{ subtype: string; id: string }[]>`
        insert into accounts (owner_user_id, name, kind, subtype, initial_balance_on)
        values (${memberUser}, 'rls subtype member cash', 'asset', 'efectivo', (now() at time zone 'America/Bogota')::date)
        returning subtype, id`;
      const changed = await tx`update accounts set subtype = 'bancaria' where id = ${pickedAccount}`;
      const [{ subtype: changedSubtype }] = await tx<{ subtype: string }[]>`
        select subtype from accounts where id = ${pickedAccount}`;
      let liabilityBreach = "";
      await tx
        .savepoint(async (sp) => {
          await sp`insert into accounts (owner_user_id, name, kind, subtype, initial_balance_cents, initial_balance_on)
            values (${memberUser}, 'rls subtype member card', 'liability', 'efectivo', -100, (now() at time zone 'America/Bogota')::date)`;
        })
        .catch((error: unknown) => {
          liabilityBreach = pgErrorCode(error) ?? "none";
        });
      assert(
        labels[5],
        pickedSubtype === "efectivo" && changed.count === 1 && changedSubtype === "bancaria" &&
          liabilityBreach === "23514",
        `inserted = ${pickedSubtype}, updated rows = ${changed.count}, now = ${changedSubtype}, efectivo-liability sqlstate = ${liabilityBreach}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from accounts where name like 'rls subtype%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls subtype%' = ${probeCount}`,
  );
}

// Assertions 124-127: the cash slice's report invariants. A withdrawal is a transfer bank→cash — the
// member's contribution, settled on the way in; a cash expense flows out of the group's `efectivo`
// account; a return is a transfer cash→bank that debits the contribution. What is proved is that the
// two transfers never leak into income or expense (RF-40, RF-19), that the return nets down the
// contribution (RF-42, RF-66), and that handing cash writes no row (RF-41). The very aggregate SQL of
// the three report queries is replicated inside the transaction, never the query functions themselves
// (they open their own `withUserDb`). Every fixture is seeded through the app's own policies and rolled back.
async function checkCashReportInvariants() {
  console.log("");
  const memberUser = randomUUID();
  const groupId = randomUUID();

  const labels = [
    "124. the withdrawal and the return are transfers — the flow window's expense is the cash expense alone (6000), income 0",
    "125. expenses-by-category totals the cash expense's one split and no transfer — 6000 in the one category",
    "126. the return debits the member's contribution: net = withdrawal − return = 7000, not 10000",
    "127. no row records the physical hand-off — the withdrawal, the cash expense and the return are the only three movements",
  ];
  const tailLabel = "128. the rolled-back cash-report transaction leaves no trace";

  // The exact aggregate SQL of the flow and category report queries, replicated so the proof reads what ships.
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
      // One identity, its group and its leadership, seeded as the owner before any role switch.
      await tx`insert into auth.users (id) values (${memberUser})`;
      await tx`insert into app_users (id) values (${memberUser})`;

      await enterUserContext(tx, memberUser);
      await tx`insert into groups (id, name, cash_mode) values (${groupId}, 'rls cash report', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${memberUser}, 'rls cash report member', 'leader')`;

      // Mirrors `currentMonthRange()`: the first of the current Bogotá month and the first of the next.
      const [{ start: winStart, end_exclusive: winEnd }] = await tx<
        { start: string; end_exclusive: string }[]
      >`select
          to_char(date_trunc('month', now() at time zone 'America/Bogota'), 'YYYY-MM-DD') as start,
          to_char(date_trunc('month', now() at time zone 'America/Bogota') + interval '1 month', 'YYYY-MM-DD') as end_exclusive`;

      // The member's personal bank account, the group's shared `efectivo` cash and one group expense
      // category. `efectivo` carries no INSERT grant, so the cash row is seeded as the owner with the
      // subtype a seeded cash account holds, exactly as the fund's own does.
      const [{ id: bankAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${memberUser}, 'rls cash report bank', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`reset role`;
      const cashName = GROUP_CASH_ACCOUNT_NAME.es;
      const [{ id: cashAccount }] = await tx<{ id: string }[]>`
        insert into accounts (group_id, is_shared, name, kind, subtype, initial_balance_on)
        values (${groupId}, true, ${cashName}, 'asset', 'efectivo', (now() at time zone 'America/Bogota')::date) returning id`;
      await enterUserContext(tx, memberUser);
      const [{ id: expenseCat }] = await tx<{ id: string }[]>`
        insert into categories (group_id, name, kind)
        values (${groupId}, 'rls cash report groceries', 'expense') returning id`;

      // 1. Withdrawal: a transfer bank→cash of 10000 — the contribution, settled on the way in (FLOWS §4).
      const [{ id: withdrawalTxn }] = await tx<{ id: string; kind: string }[]>`
        insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${bankAccount}, ${cashAccount}, 10000, (now() at time zone 'America/Bogota')::date)
        returning id, kind`;

      // 2. Cash expense: 6000 out of the group `efectivo`, one split on the group category.
      const [{ id: expenseTxn }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, amount_cents, occurred_at)
        values (${cashAccount}, 6000, (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into transaction_splits (transaction_id, category_id, amount_cents)
        values (${expenseTxn}, ${expenseCat}, 6000)`;

      // 3. Return: a transfer cash→bank of 3000 — debits the member's contribution (RF-42).
      const [{ id: returnTxn }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${cashAccount}, ${bankAccount}, 3000, (now() at time zone 'America/Bogota')::date) returning id`;

      // 124 (RF-40, RF-19): the flow window sums the cash expense alone. The two transfers count in
      // neither total — the expense is 6000, never 16000, and there is no income at all.
      const [flow] = await flowSums(tx, winStart, winEnd);
      const income = Number(flow.income_cents);
      const expense = Number(flow.expense_cents);
      assert(
        labels[0],
        income === 0 && expense === 6000,
        `income = ${income}, expense = ${expense} (expected 0 and 6000, not 16000)`,
      );

      // 125 (RF-34): expenses-by-category holds one row for the cash expense's split, 6000; the two
      // transfers carry no split and add nothing.
      const catRows = await categoryTotals(tx, winStart, winEnd);
      const catTotal = catRows.reduce((sum, row) => sum + Number(row.total_cents), 0);
      assert(
        labels[1],
        catRows.length === 1 && catRows[0].category_id === expenseCat && catTotal === 6000,
        `rows = ${catRows.length}, total = ${catTotal} (expected 1 row, 6000)`,
      );

      // 126 (RF-42, RF-66): the contribution nets the withdrawal against the return. The exact SQL of
      // `getMemberContributions`, replicated: 10000 credited on the way in, 3000 debited on the return.
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
          contributions[0].user_id === memberUser &&
          Number(contributions[0].contribution_cents) === 7000,
        `rows = ${contributions.length}, net = ${contributions[0]?.contribution_cents} (expected 7000 = 10000 − 3000, not 10000)`,
      );

      // 127 (RF-41): handing cash over is not a transaction — the scenario writes no fourth row for it.
      // Every movement touching the bank or the cash account is one of the three seeded above.
      const [{ count: movementCount }] = await tx<{ count: string }[]>`
        select count(*)::text as count from transactions
        where from_account_id in (${bankAccount}, ${cashAccount})
           or to_account_id in (${bankAccount}, ${cashAccount})`;
      assert(
        labels[3],
        movementCount === "3" &&
          withdrawalTxn !== expenseTxn && expenseTxn !== returnTxn,
        `movements touching bank or cash = ${movementCount} (expected 3: withdrawal, cash expense, return — no hand-off row)`,
      );

      // Forces `sql.begin` to issue ROLLBACK: nothing this function wrote may survive it.
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from groups where name = 'rls cash report'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls cash report' = ${probeCount}`,
  );
}

// Assertions 129-135: the per-scope import key (RF-51). Each of the four new entities carries a
// partial unique index on `(scope, external_ref)`, so a duplicate ref in one scope is refused while
// the same ref in a different scope stands; the derive trigger fills an omitted ref with `id::text`
// on all five entities (transactions included) while an explicit ref survives; and the column grant
// lets an authenticated member write the key under RLS. Every fixture is seeded through the app's own
// policies or as the owner where no policy hands the row out, and rolled back.
async function checkExternalRefKeys() {
  console.log("");
  const leaderUser = randomUUID();
  const groupId = randomUUID();
  const secondGroup = randomUUID();

  const labels = [
    "129. accounts: a duplicate external_ref in one scope is refused (23505); the same ref in two scopes both persist",
    "130. categories: a duplicate external_ref in one scope is refused (23505); the same ref in two scopes both persist",
    "131. recurring_rules: a duplicate external_ref in one scope is refused (23505); the same ref in two scopes both persist",
    "132. group_members: a duplicate external_ref in one group is refused (23505); the same ref in two groups both persist",
    "133. a null external_ref lands as id::text on all five entities — the derive trigger fired",
    "134. an explicit external_ref survives on all five entities — the WHEN guard held",
    "135. the column grant lets an authenticated member insert and update external_ref on an account under RLS",
  ];
  const tailLabel = "136. the rolled-back external_ref transaction leaves no trace";

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${leaderUser})`;
      await tx`insert into app_users (id) values (${leaderUser})`;

      // The group, its leader, a personal and a shared account, and one expense category per scope:
      // enough to book a rule and a movement, and to hold a ref in each of the two scopes.
      await enterUserContext(tx, leaderUser);
      await tx`insert into groups (id, name, cash_mode) values (${groupId}, 'rls ext refs', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${leaderUser}, 'rls ext refs leader', 'leader')`;
      const [{ id: leaderAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls ext refs leader cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: sharedAccount }] = await tx<{ id: string }[]>`
        insert into accounts (group_id, is_shared, name, kind, initial_balance_on)
        values (${groupId}, true, 'rls ext refs shared cash', 'asset', (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: personalExpenseCat }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${leaderUser}, 'rls ext refs personal expense', 'expense') returning id`;
      const [{ id: groupExpenseCat }] = await tx<{ id: string }[]>`
        insert into categories (group_id, name, kind)
        values (${groupId}, 'rls ext refs group expense', 'expense') returning id`;

      // 129: accounts. Seeded as the owner so the explicit scope columns reach the row untouched; only
      // the partial unique index can reject the duplicate, and only within the one owner scope.
      await tx`reset role`;
      await tx`insert into accounts (owner_user_id, name, kind, external_ref, initial_balance_on)
        values (${leaderUser}, 'rls ext refs acct owner', 'asset', 'ext-acct-dup', (now() at time zone 'America/Bogota')::date)`;
      let acctDup = "";
      await tx
        .savepoint(async (sp) => {
          await sp`insert into accounts (owner_user_id, name, kind, external_ref, initial_balance_on)
            values (${leaderUser}, 'rls ext refs acct owner dup', 'asset', 'ext-acct-dup', (now() at time zone 'America/Bogota')::date)`;
        })
        .catch((error: unknown) => {
          acctDup = pgErrorCode(error) ?? "none";
        });
      await tx`insert into accounts (group_id, is_shared, name, kind, external_ref, initial_balance_on)
        values (${groupId}, true, 'rls ext refs acct group', 'asset', 'ext-acct-dup', (now() at time zone 'America/Bogota')::date)`;
      const [{ count: acctScopes }] = await tx<{ count: string }[]>`
        select count(*)::text as count from accounts where external_ref = 'ext-acct-dup'`;
      assert(
        labels[0],
        acctDup === "23505" && acctScopes === "2",
        `dup sqlstate ${acctDup}, rows across scopes = ${acctScopes} (expected 23505 and 2)`,
      );

      // 130: categories, the same shape — owner scope and group scope hold the ref side by side.
      await tx`insert into categories (owner_user_id, name, kind, external_ref)
        values (${leaderUser}, 'rls ext refs cat owner', 'expense', 'ext-cat-dup')`;
      let catDup = "";
      await tx
        .savepoint(async (sp) => {
          await sp`insert into categories (owner_user_id, name, kind, external_ref)
            values (${leaderUser}, 'rls ext refs cat owner dup', 'expense', 'ext-cat-dup')`;
        })
        .catch((error: unknown) => {
          catDup = pgErrorCode(error) ?? "none";
        });
      await tx`insert into categories (group_id, name, kind, external_ref)
        values (${groupId}, 'rls ext refs cat group', 'expense', 'ext-cat-dup')`;
      const [{ count: catScopes }] = await tx<{ count: string }[]>`
        select count(*)::text as count from categories where external_ref = 'ext-cat-dup'`;
      assert(
        labels[1],
        catDup === "23505" && catScopes === "2",
        `dup sqlstate ${catDup}, rows across scopes = ${catScopes} (expected 23505 and 2)`,
      );

      // 131: recurring_rules. Booked as the writing member so the scope trigger derives owner vs group
      // from the account; the ref rides on the derived scope, and only its own scope's index refuses it.
      await enterUserContext(tx, leaderUser);
      await tx`insert into recurring_rules (from_account_id, amount_cents, category_id, frequency, interval_n, day_of_month, next_run_on, external_ref)
        values (${leaderAccount}, 5000, ${personalExpenseCat}, 'monthly', 1, 15,
          (now() at time zone 'America/Bogota')::date + 30, 'ext-rule-dup')`;
      let ruleDup = "";
      await tx
        .savepoint(async (sp) => {
          await sp`insert into recurring_rules (from_account_id, amount_cents, category_id, frequency, interval_n, day_of_month, next_run_on, external_ref)
            values (${leaderAccount}, 5000, ${personalExpenseCat}, 'monthly', 1, 15,
              (now() at time zone 'America/Bogota')::date + 30, 'ext-rule-dup')`;
        })
        .catch((error: unknown) => {
          ruleDup = pgErrorCode(error) ?? "none";
        });
      await tx`insert into recurring_rules (from_account_id, amount_cents, category_id, frequency, interval_n, day_of_month, next_run_on, external_ref)
        values (${sharedAccount}, 6000, ${groupExpenseCat}, 'monthly', 1, 15,
          (now() at time zone 'America/Bogota')::date + 30, 'ext-rule-dup')`;
      await tx`reset role`;
      const [{ count: ruleScopes }] = await tx<{ count: string }[]>`
        select count(*)::text as count from recurring_rules where external_ref = 'ext-rule-dup'`;
      assert(
        labels[2],
        ruleDup === "23505" && ruleScopes === "2",
        `dup sqlstate ${ruleDup}, rows across scopes = ${ruleScopes} (expected 23505 and 2)`,
      );

      // 132: group_members carries a group scope alone — a duplicate ref in one group is refused, the
      // same ref in a second group stands. Seeded as the owner: no policy lets one member seed another group.
      await tx`insert into group_members (group_id, name, role, external_ref)
        values (${groupId}, 'rls ext refs gm one', 'member', 'ext-gm-dup')`;
      let gmDup = "";
      await tx
        .savepoint(async (sp) => {
          await sp`insert into group_members (group_id, name, role, external_ref)
            values (${groupId}, 'rls ext refs gm one dup', 'member', 'ext-gm-dup')`;
        })
        .catch((error: unknown) => {
          gmDup = pgErrorCode(error) ?? "none";
        });
      await tx`insert into groups (id, name, cash_mode) values (${secondGroup}, 'rls ext refs two', 'shared')`;
      await tx`insert into group_members (group_id, name, role, external_ref)
        values (${secondGroup}, 'rls ext refs gm two', 'member', 'ext-gm-dup')`;
      const [{ count: gmScopes }] = await tx<{ count: string }[]>`
        select count(*)::text as count from group_members where external_ref = 'ext-gm-dup'`;
      assert(
        labels[3],
        gmDup === "23505" && gmScopes === "2",
        `dup sqlstate ${gmDup}, rows across groups = ${gmScopes} (expected 23505 and 2)`,
      );

      // 133: an omitted ref is filled with the row's own id on every entity. Accounts, categories and
      // group_members as the owner; the rule and the movement as the writing member so their triggers run.
      await tx`reset role`;
      const [acctNull] = await tx<{ id: string; external_ref: string | null }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${leaderUser}, 'rls ext refs acct null', 'asset', (now() at time zone 'America/Bogota')::date)
        returning id, external_ref`;
      const [catNull] = await tx<{ id: string; external_ref: string | null }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${leaderUser}, 'rls ext refs cat null', 'expense') returning id, external_ref`;
      const [gmNull] = await tx<{ id: string; external_ref: string | null }[]>`
        insert into group_members (group_id, name, role)
        values (${groupId}, 'rls ext refs gm null', 'member') returning id, external_ref`;
      await enterUserContext(tx, leaderUser);
      const [ruleNull] = await tx<{ id: string; external_ref: string | null }[]>`
        insert into recurring_rules (from_account_id, amount_cents, category_id, frequency, interval_n, day_of_month, next_run_on)
        values (${leaderAccount}, 5000, ${personalExpenseCat}, 'monthly', 1, 15,
          (now() at time zone 'America/Bogota')::date + 30) returning id, external_ref`;
      const [txnNull] = await tx<{ id: string; external_ref: string | null }[]>`
        insert into transactions (from_account_id, amount_cents, occurred_at)
        values (${leaderAccount}, 5000, (now() at time zone 'America/Bogota')::date) returning id, external_ref`;
      assert(
        labels[4],
        acctNull.external_ref === acctNull.id &&
          catNull.external_ref === catNull.id &&
          gmNull.external_ref === gmNull.id &&
          ruleNull.external_ref === ruleNull.id &&
          txnNull.external_ref === txnNull.id,
        `acct ${acctNull.external_ref === acctNull.id}, cat ${catNull.external_ref === catNull.id}, gm ${gmNull.external_ref === gmNull.id}, rule ${ruleNull.external_ref === ruleNull.id}, txn ${txnNull.external_ref === txnNull.id}`,
      );

      // 134: an explicit ref is preserved unchanged on every entity — the WHEN guard skips the trigger.
      await tx`reset role`;
      const [acctKeep] = await tx<{ external_ref: string | null }[]>`
        insert into accounts (owner_user_id, name, kind, external_ref, initial_balance_on)
        values (${leaderUser}, 'rls ext refs acct keep', 'asset', 'ext-keep-acct', (now() at time zone 'America/Bogota')::date)
        returning external_ref`;
      const [catKeep] = await tx<{ external_ref: string | null }[]>`
        insert into categories (owner_user_id, name, kind, external_ref)
        values (${leaderUser}, 'rls ext refs cat keep', 'expense', 'ext-keep-cat') returning external_ref`;
      const [gmKeep] = await tx<{ external_ref: string | null }[]>`
        insert into group_members (group_id, name, role, external_ref)
        values (${groupId}, 'rls ext refs gm keep', 'member', 'ext-keep-gm') returning external_ref`;
      await enterUserContext(tx, leaderUser);
      const [ruleKeep] = await tx<{ external_ref: string | null }[]>`
        insert into recurring_rules (from_account_id, amount_cents, category_id, frequency, interval_n, day_of_month, next_run_on, external_ref)
        values (${leaderAccount}, 5000, ${personalExpenseCat}, 'monthly', 1, 15,
          (now() at time zone 'America/Bogota')::date + 30, 'ext-keep-rule') returning external_ref`;
      const [txnKeep] = await tx<{ external_ref: string | null }[]>`
        insert into transactions (from_account_id, amount_cents, occurred_at, external_ref)
        values (${leaderAccount}, 5000, (now() at time zone 'America/Bogota')::date, 'ext-keep-txn') returning external_ref`;
      assert(
        labels[5],
        acctKeep.external_ref === "ext-keep-acct" &&
          catKeep.external_ref === "ext-keep-cat" &&
          gmKeep.external_ref === "ext-keep-gm" &&
          ruleKeep.external_ref === "ext-keep-rule" &&
          txnKeep.external_ref === "ext-keep-txn",
        `acct ${acctKeep.external_ref}, cat ${catKeep.external_ref}, gm ${gmKeep.external_ref}, rule ${ruleKeep.external_ref}, txn ${txnKeep.external_ref}`,
      );

      // 135: the column grant, exercised as an authenticated member in scope. The import stamps the key
      // on insert and can correct it on update — both land through the narrow INSERT/UPDATE(external_ref) grant.
      await enterUserContext(tx, leaderUser);
      const [grantIns] = await tx<{ id: string; external_ref: string | null }[]>`
        insert into accounts (owner_user_id, name, kind, external_ref, initial_balance_on)
        values (${leaderUser}, 'rls ext refs grant', 'asset', 'ext-grant-1', (now() at time zone 'America/Bogota')::date)
        returning id, external_ref`;
      const grantUpdate = await tx`update accounts set external_ref = 'ext-grant-2' where id = ${grantIns.id}`;
      const [{ external_ref: grantNow }] = await tx<{ external_ref: string | null }[]>`
        select external_ref from accounts where id = ${grantIns.id}`;
      assert(
        labels[6],
        grantIns.external_ref === "ext-grant-1" && grantUpdate.count === 1 && grantNow === "ext-grant-2",
        `inserted = ${grantIns.external_ref}, updated rows = ${grantUpdate.count}, now = ${grantNow}`,
      );

      // Forces `sql.begin` to issue ROLLBACK: nothing this function wrote may survive it.
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from groups where name like 'rls ext refs%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls ext refs%' = ${probeCount}`,
  );
}

// Assertions 137-142: the import commit (RF-51/52/45). It writes the whole file in one
// transaction: new rows insert, update rows overwrite by their stable key, a movement
// links to a file-new account's REAL id, and any mid-write failure rolls back every
// entity. Driven through `commitImport` itself — the shipped body, not a replica — under
// an injected user, so RLS and the triggers decide each row. Every fixture rolls back.
async function checkImportCommit() {
  console.log("");
  const owner = randomUUID();
  const failOwner = randomUUID();
  const today = "2026-01-01";
  const color = CATEGORY_COLORS[0];

  const labels = [
    "137. a single-file commit inserts new rows and overwrites an update row in place by its stable key",
    "138. re-committing the same file duplicates nothing and leaves the stable-keyed rows updated in place",
    "139. a movement whose split fails rolls back every entity the same transaction wrote",
    "140. a movement referencing a file-new account links to that account's real inserted id, not a placeholder",
    "141. the commit lands an audit row for its writes",
  ];
  const tailLabel = "142. the rolled-back import-commit transaction leaves no trace";

  // The placeholders a dev→prod file assigns its new referenced entities; the movement
  // points at these, and the commit must swap each for the real inserted id.
  const phAccountA = randomUUID();
  const phAccountC = randomUUID();
  const phCategory = randomUUID();

  const forcedRollback = Symbol("forced rollback");

  type OrmTx = Parameters<Parameters<typeof orm.transaction>[0]>[0];
  const enter = (tx: OrmTx, subject: string) =>
    tx.execute(dsql`select
      set_config('request.jwt.claims', ${JSON.stringify({ sub: subject, role: "authenticated", aud: "authenticated" })}, true),
      set_config('statement_timeout', '8000', true),
      set_config('role', 'authenticated', true)`);

  const scope: CommitScope = { userId: owner, groupId: null };

  // The dev→prod file: two new accounts, one new category, and an expense that names a
  // file-new account and the file-new category — all by placeholder, never a real id.
  const firstFile: CommitInput = {
    members: [],
    categories: [
      {
        status: "new",
        externalRef: "imp-cat-1",
        placeholderId: phCategory,
        object: { name: "Imp Cat", kind: "expense", parentId: null, color },
      },
    ],
    accounts: [
      {
        status: "new",
        externalRef: "imp-acct-A",
        placeholderId: phAccountA,
        object: { name: "Imp A", kind: "asset", subtype: "efectivo", placement: "personal", institution: null, amount: "100", balanceOn: today },
      },
      {
        status: "new",
        externalRef: "imp-acct-C",
        placeholderId: phAccountC,
        object: { name: "Imp C", kind: "asset", subtype: "efectivo", placement: "personal", institution: null, amount: "200", balanceOn: today },
      },
    ],
    recurringRules: [],
    transactions: [
      {
        status: "new",
        externalRef: "imp-txn-1",
        placeholderId: null,
        object: {
          fromAccountId: phAccountC,
          toAccountId: null,
          amount: "50",
          occurredAt: today,
          description: null,
          externalRef: "imp-txn-1",
          splits: [{ categoryId: phCategory, amount: "50" }],
          labelIds: [],
        },
      },
    ],
  };

  await orm
    .transaction(async (tx) => {
      await tx.execute(dsql`insert into auth.users (id) values (${owner})`);
      await tx.execute(dsql`insert into app_users (id) values (${owner})`);
      await enter(tx, owner);

      await commitImport(tx, firstFile, scope);

      const [acctA] = await tx.execute<{ id: string; name: string }>(
        dsql`select id, name from accounts where external_ref = 'imp-acct-A'`,
      );
      const [acctC] = await tx.execute<{ id: string }>(
        dsql`select id from accounts where external_ref = 'imp-acct-C'`,
      );
      const [cat1] = await tx.execute<{ id: string }>(
        dsql`select id from categories where external_ref = 'imp-cat-1'`,
      );
      const [txn1] = await tx.execute<{ id: string; from_account_id: string | null }>(
        dsql`select id, from_account_id from transactions where external_ref = 'imp-txn-1'`,
      );
      const [split1] = await tx.execute<{ category_id: string }>(
        dsql`select category_id from transaction_splits where transaction_id = ${txn1.id}`,
      );

      // 140: the movement's account and its split's category are the REAL inserted ids,
      // never the placeholders the file carried.
      assert(
        labels[3],
        txn1.from_account_id === acctC.id &&
          split1.category_id === cat1.id &&
          txn1.from_account_id !== phAccountC &&
          split1.category_id !== phCategory,
        `from_account = ${txn1.from_account_id === acctC.id ? "real C" : txn1.from_account_id}, split cat = ${split1.category_id === cat1.id ? "real cat" : split1.category_id}`,
      );

      // A second file: one account updated by its key, one brand-new account.
      const secondFile: CommitInput = {
        members: [],
        categories: [],
        accounts: [
          {
            status: "update",
            externalRef: "imp-acct-A",
            placeholderId: null,
            object: { name: "Imp A2", kind: "asset", subtype: "bancaria", placement: "personal", institution: null, amount: "150", balanceOn: today },
          },
          {
            status: "new",
            externalRef: "imp-acct-B",
            placeholderId: randomUUID(),
            object: { name: "Imp B", kind: "asset", subtype: "efectivo", placement: "personal", institution: null, amount: "10", balanceOn: today },
          },
        ],
        recurringRules: [],
        transactions: [],
      };
      await commitImport(tx, secondFile, scope);

      const [acctARenamed] = await tx.execute<{ id: string; name: string }>(
        dsql`select id, name from accounts where external_ref = 'imp-acct-A'`,
      );
      const [{ count: acctBCount }] = await tx.execute<{ count: string }>(
        dsql`select count(*)::text as count from accounts where external_ref = 'imp-acct-B'`,
      );
      // 137: the update overwrote the existing row (same id, new name), the new row landed.
      assert(
        labels[0],
        acctARenamed.id === acctA.id && acctARenamed.name === "Imp A2" && acctBCount === "1",
        `A id held = ${acctARenamed.id === acctA.id}, A name = ${acctARenamed.name}, B rows = ${acctBCount}`,
      );

      // 141: the writes left an audit trail — the new account C is captured on INSERT (RF-45).
      await tx.execute(dsql`reset role`);
      const [{ count: auditCount }] = await tx.execute<{ count: string }>(
        dsql`select count(*)::text as count from audit_log
          where entity = 'accounts' and record_id = ${acctC.id} and action = 'INSERT'`,
      );
      assert(labels[4], Number(auditCount) >= 1, `audit rows for account C insert = ${auditCount}`);
      await enter(tx, owner);

      // Re-commit the FIRST file, now reclassified as updates the way the pipeline would on
      // a re-import: references resolve to the real ids, not placeholders.
      const [{ count: acctCountBefore }] = await tx.execute<{ count: string }>(
        dsql`select count(*)::text as count from accounts where external_ref like 'imp-acct-%'`,
      );
      const [{ count: catCountBefore }] = await tx.execute<{ count: string }>(
        dsql`select count(*)::text as count from categories where external_ref like 'imp-cat-%'`,
      );
      const [{ count: txnCountBefore }] = await tx.execute<{ count: string }>(
        dsql`select count(*)::text as count from transactions where external_ref like 'imp-txn-%'`,
      );

      const reimport: CommitInput = {
        members: [],
        categories: [
          {
            status: "update",
            externalRef: "imp-cat-1",
            placeholderId: null,
            object: { name: "Imp Cat", kind: "expense", parentId: null, color },
          },
        ],
        accounts: [
          {
            status: "update",
            externalRef: "imp-acct-A",
            placeholderId: null,
            object: { name: "Imp A", kind: "asset", subtype: "efectivo", placement: "personal", institution: null, amount: "100", balanceOn: today },
          },
          {
            status: "update",
            externalRef: "imp-acct-C",
            placeholderId: null,
            object: { name: "Imp C", kind: "asset", subtype: "efectivo", placement: "personal", institution: null, amount: "200", balanceOn: today },
          },
        ],
        recurringRules: [],
        transactions: [
          {
            status: "update",
            externalRef: "imp-txn-1",
            placeholderId: null,
            object: {
              fromAccountId: acctC.id,
              toAccountId: null,
              amount: "50",
              occurredAt: today,
              description: null,
              externalRef: "imp-txn-1",
              splits: [{ categoryId: cat1.id, amount: "50" }],
              labelIds: [],
            },
          },
        ],
      };
      await commitImport(tx, reimport, scope);

      const [{ count: acctCountAfter }] = await tx.execute<{ count: string }>(
        dsql`select count(*)::text as count from accounts where external_ref like 'imp-acct-%'`,
      );
      const [{ count: catCountAfter }] = await tx.execute<{ count: string }>(
        dsql`select count(*)::text as count from categories where external_ref like 'imp-cat-%'`,
      );
      const [{ count: txnCountAfter }] = await tx.execute<{ count: string }>(
        dsql`select count(*)::text as count from transactions where external_ref like 'imp-txn-%'`,
      );
      const [acctAReset] = await tx.execute<{ id: string; name: string }>(
        dsql`select id, name from accounts where external_ref = 'imp-acct-A'`,
      );
      // 138: no table gained a row, and the stable-keyed account is updated in place (same id, reset name).
      assert(
        labels[1],
        acctCountAfter === acctCountBefore &&
          catCountAfter === catCountBefore &&
          txnCountAfter === txnCountBefore &&
          acctAReset.id === acctA.id &&
          acctAReset.name === "Imp A",
        `accounts ${acctCountBefore}→${acctCountAfter}, categories ${catCountBefore}→${catCountAfter}, transactions ${txnCountBefore}→${txnCountAfter}, A in place = ${acctAReset.id === acctA.id}`,
      );

      // Nothing this section wrote may survive; force the ROLLBACK.
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  // 139: a file whose write fails mid-way. The expense names an INCOME category on its
  // split, which the match trigger refuses (23514) after the account and category already
  // landed — so the whole transaction must roll back, leaving zero rows on every entity.
  const failFile: CommitInput = {
    members: [],
    categories: [
      {
        status: "new",
        externalRef: "imp-fail-cat",
        placeholderId: randomUUID(),
        object: { name: "Imp Fail Cat", kind: "income", parentId: null, color },
      },
    ],
    accounts: [
      {
        status: "new",
        externalRef: "imp-fail-acct",
        placeholderId: randomUUID(),
        object: { name: "Imp Fail Acct", kind: "asset", subtype: "efectivo", placement: "personal", institution: null, amount: "100", balanceOn: today },
      },
    ],
    recurringRules: [],
    transactions: [],
  };
  // The movement points at the two file-new rows by their placeholders, an expense (from
  // set, to null) carrying the income category — the mismatch the trigger rejects.
  failFile.transactions = [
    {
      status: "new",
      externalRef: "imp-fail-txn",
      placeholderId: null,
      object: {
        fromAccountId: failFile.accounts[0].placeholderId,
        toAccountId: null,
        amount: "50",
        occurredAt: today,
        description: null,
        externalRef: "imp-fail-txn",
        splits: [{ categoryId: failFile.categories[0].placeholderId!, amount: "50" }],
        labelIds: [],
      },
    },
  ];

  let failCode = "";
  await orm
    .transaction(async (tx) => {
      await tx.execute(dsql`insert into auth.users (id) values (${failOwner})`);
      await tx.execute(dsql`insert into app_users (id) values (${failOwner})`);
      await enter(tx, failOwner);
      await commitImport(tx, failFile, { userId: failOwner, groupId: null });
    })
    .catch((error: unknown) => {
      failCode = pgErrorCode(error) ?? "none";
    });

  const [{ count: failAccts }] = await sql<{ count: string }[]>`
    select count(*)::text as count from accounts where external_ref = 'imp-fail-acct'`;
  const [{ count: failCats }] = await sql<{ count: string }[]>`
    select count(*)::text as count from categories where external_ref = 'imp-fail-cat'`;
  assert(
    labels[2],
    failCode === "23514" && failAccts === "0" && failCats === "0",
    `sqlstate ${failCode}, account rows = ${failAccts}, category rows = ${failCats} (expected 23514 and 0, 0)`,
  );

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from accounts where external_ref like 'imp-acct-%' or external_ref like 'imp-fail-%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, import rows surviving = ${probeCount}`,
  );
}

// Assertions 143-151: label governance. A group's labels bend to its leader and to no plain member,
// a personal label to its owner alone, read is universal inside the group, a label only tags a
// movement of its own scope, and the RF-89 filter narrows the ledger without widening it. Every
// fixture is seeded through the app's own policies inside a transaction that rolls back.
async function checkLabelPolicies() {
  console.log("");
  const leaderUser = randomUUID();
  const memberUser = randomUUID();
  const outsideUser = randomUUID();
  const groupId = randomUUID();
  const outsideGroupId = randomUUID();
  const color = CATEGORY_COLORS[0];

  const labels = [
    "143. a member reads the group's label",
    "144. a member cannot mint a label for the group",
    "145. a member's update of the group's label touches nothing",
    "146. a member's delete of the group's label touches nothing and the row survives",
    "147. the leader's insert, update and delete of a group label all stand",
    "148. a personal label yields to its owner and to no one else, the leader included",
    "149. a label only tags a movement of its own scope",
    "150. the RF-89 filter narrows the ledger to the labelled movement and never widens it",
  ];
  const tailLabel = "151. the rolled-back label transaction leaves no trace";

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      // Base identities, seeded as the owner before any role switch: `auth.users` is the FK target
      // for `app_users`, and both must exist before the app's own policies can seed anything else.
      await tx`insert into auth.users (id) values (${leaderUser}), (${memberUser}), (${outsideUser})`;
      await tx`insert into app_users (id) values (${leaderUser}), (${memberUser}), (${outsideUser})`;

      await enterUserContext(tx, leaderUser);
      await tx`insert into groups (id, name, cash_mode) values (${groupId}, 'rls labels', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${leaderUser}, 'rls labels leader', 'leader')`;
      const [{ id: sharedAccount }] = await tx<{ id: string }[]>`
        insert into accounts (group_id, is_shared, name, kind, initial_balance_on)
        values (${groupId}, true, 'rls labels shared cash', 'asset',
          (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: groupLabel }] = await tx<{ id: string }[]>`
        insert into labels (group_id, name, color)
        values (${groupId}, 'rls labels group', ${color}) returning id`;

      // A second member with a login: no policy hands one member another's membership, so seed it as the owner.
      await tx`reset role`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${groupId}, ${memberUser}, 'rls labels member', 'member')`;

      await enterUserContext(tx, memberUser);
      const [{ id: memberAccount }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${memberUser}, 'rls labels member cash', 'asset',
          (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: personalLabel }] = await tx<{ id: string }[]>`
        insert into labels (owner_user_id, name, color)
        values (${memberUser}, 'rls labels personal', ${color}) returning id`;

      // Two group movements, both transfers so neither needs a split: the group wins the scope the
      // moment one side is the shared account. Only the first is ever labelled.
      const [{ id: labelledTxn }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${memberAccount}, ${sharedAccount}, 4000,
          (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${sharedAccount}, ${memberAccount}, 1500, (now() at time zone 'America/Bogota')::date)`;

      // A second group neither of them belongs to, with a label and a movement of its own.
      await enterUserContext(tx, outsideUser);
      await tx`insert into groups (id, name, cash_mode)
        values (${outsideGroupId}, 'rls labels outside', 'shared')`;
      await tx`insert into group_members (group_id, user_id, name, role)
        values (${outsideGroupId}, ${outsideUser}, 'rls labels outside leader', 'leader')`;
      const [{ id: outsideShared }] = await tx<{ id: string }[]>`
        insert into accounts (group_id, is_shared, name, kind, initial_balance_on)
        values (${outsideGroupId}, true, 'rls labels outside cash', 'asset',
          (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: outsideOwn }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${outsideUser}, 'rls labels outside personal', 'asset',
          (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: outsideLabel }] = await tx<{ id: string }[]>`
        insert into labels (group_id, name, color)
        values (${outsideGroupId}, 'rls labels outside group', ${color}) returning id`;
      const [{ id: outsideTxn }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at)
        values (${outsideOwn}, ${outsideShared}, 2500,
          (now() at time zone 'America/Bogota')::date) returning id`;
      await tx`insert into transaction_labels (transaction_id, label_id)
        values (${outsideTxn}, ${outsideLabel})`;

      // 143: universal read inside the group — a plain member sees the label the leader defined.
      await enterUserContext(tx, memberUser);
      const [{ count: memberSeesGroupLabel }] = await tx<{ count: string }[]>`
        select count(*)::text as count from labels where id = ${groupLabel}`;
      assert(labels[0], memberSeesGroupLabel === "1", `visible rows = ${memberSeesGroupLabel}`);

      // 144: `labels_insert_group` gates on the leader claim, so the member's group label never lands.
      await tx
        .savepoint(async (sp) => {
          await sp`insert into labels (group_id, name, color)
            values (${groupId}, 'rls labels forged', ${color})`;
          assert(labels[1], false, "a member minted a group label, which it must not");
        })
        .catch((error: unknown) => {
          assert(labels[1], pgErrorCode(error) === "42501", `sqlstate ${pgErrorCode(error) ?? "none"}`);
        });

      // 145-146: the same gate on update and delete — the row is filtered out, so both touch nothing.
      const memberUpdate = await tx`update labels set name = 'x' where id = ${groupLabel}`;
      assert(labels[2], memberUpdate.count === 0, `update rows = ${memberUpdate.count}`);
      const memberDelete = await tx`delete from labels where id = ${groupLabel}`;
      const [{ count: survives }] = await tx<{ count: string }[]>`
        select count(*)::text as count from labels where id = ${groupLabel}`;
      assert(
        labels[3],
        memberDelete.count === 0 && survives === "1",
        `delete rows = ${memberDelete.count}, surviving rows = ${survives}`,
      );

      // 147: the leader holds the whole of the group's set, on a label of its own so the fixture stands.
      await enterUserContext(tx, leaderUser);
      const [{ id: leaderLabel }] = await tx<{ id: string }[]>`
        insert into labels (group_id, name, color)
        values (${groupId}, 'rls labels leader made', ${color}) returning id`;
      const leaderUpdate = await tx`update labels set name = 'rls labels leader renamed'
        where id = ${leaderLabel}`;
      const leaderDelete = await tx`delete from labels where id = ${leaderLabel}`;
      assert(
        labels[4],
        leaderUpdate.count === 1 && leaderDelete.count === 1,
        `insert rows = 1, update rows = ${leaderUpdate.count}, delete rows = ${leaderDelete.count}`,
      );

      // 148: a personal label answers to its owner id, and the leader holds no exception over it.
      await enterUserContext(tx, memberUser);
      const [{ id: ownLabel }] = await tx<{ id: string }[]>`
        insert into labels (owner_user_id, name, color)
        values (${memberUser}, 'rls labels personal own', ${color}) returning id`;
      const ownerRename = await tx`update labels set name = 'rls labels personal renamed'
        where id = ${ownLabel}`;
      await enterUserContext(tx, leaderUser);
      const leaderOnPersonal = await tx`update labels set name = 'x' where id = ${ownLabel}`;
      await enterUserContext(tx, memberUser);
      const ownerDelete = await tx`delete from labels where id = ${ownLabel}`;
      assert(
        labels[5],
        ownerRename.count === 1 && leaderOnPersonal.count === 0 && ownerDelete.count === 1,
        `owner update rows = ${ownerRename.count}, leader update rows = ${leaderOnPersonal.count}, ` +
          `owner delete rows = ${ownerDelete.count}`,
      );

      // 149: the join policy admits the member's write on a group movement either way, so only
      // `assert_label_matches_transaction` can tell the two tags apart. The matching one stays, for 150.
      await enterUserContext(tx, memberUser);
      const matching = await tx`insert into transaction_labels (transaction_id, label_id)
        values (${labelledTxn}, ${groupLabel})`;
      await tx
        .savepoint(async (sp) => {
          await sp`insert into transaction_labels (transaction_id, label_id)
            values (${labelledTxn}, ${personalLabel})`;
          assert(labels[6], false, "a personal label tagged a group movement, which it must not");
        })
        .catch((error: unknown) => {
          const code = pgErrorCode(error);
          assert(
            labels[6],
            code === "23514" && matching.count === 1,
            `mismatched sqlstate ${code ?? "none"}, matching rows = ${matching.count}`,
          );
        });

      // 150: the predicate `listTransactions` composes for a label filter, replicated inline. The group's
      // own label narrows to the movement it tags; the other group's label yields nothing, and never
      // reaches past what the transactions policy already shows.
      const [{ count: visible }] = await tx<{ count: string }[]>`
        select count(*)::text as count from transactions`;
      const byGroupLabel = await tx<{ id: string }[]>`
        select id from transactions where exists (
          select 1 from transaction_labels tl
          where tl.transaction_id = transactions.id and tl.label_id = ${groupLabel})`;
      const byOutsideLabel = await tx<{ id: string }[]>`
        select id from transactions where exists (
          select 1 from transaction_labels tl
          where tl.transaction_id = transactions.id and tl.label_id = ${outsideLabel})`;
      assert(
        labels[7],
        visible === "2" &&
          byGroupLabel.length === 1 &&
          byGroupLabel[0].id === labelledTxn &&
          byOutsideLabel.length === 0,
        `visible rows = ${visible}, group-label rows = ${byGroupLabel.length}, ` +
          `other-group-label rows = ${byOutsideLabel.length}`,
      );

      // Forces `sql.begin` to issue ROLLBACK: nothing this function wrote may survive it.
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from labels where name like 'rls labels%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, labels surviving = ${probeCount}`,
  );
}

// Assertions 152-157: the credential write paths the screen drives. `owner_user_id` sits outside the
// INSERT grant, so no one mints a credential for someone else; the owner's eight-column read stands;
// the revoke lands under `authenticated` alone and takes the token out of the resolver's reach; and the
// token hash and the throttle counters stay outside the UPDATE grant. Every fixture is seeded through
// the app's own policies inside a transaction that rolls back.
async function checkWebhookCredentialOwnerWrites() {
  console.log("");
  const owner = randomUUID();
  const other = randomUUID();

  const labels = [
    "152. an insert naming another user as owner is refused",
    "153. the owner reads back the eight columns the list projects",
    "154. the owner's revoke lands and the second user's identical revoke touches nothing",
    "155. the resolver yields no row for a credential its owner revoked",
    "156. token_hash and both throttle counters are outside the update grant",
  ];
  const tailLabel = "157. the rolled-back credential write transaction leaves no trace";

  // 64 hex chars each: the token_hash length check demands exactly that.
  const ownerHash = createHash("sha256").update(randomUUID()).digest("hex");
  const forgedHash = createHash("sha256").update(randomUUID()).digest("hex");
  const rotatedHash = createHash("sha256").update(randomUUID()).digest("hex");

  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${owner}), (${other})`;
      await tx`insert into app_users (id) values (${owner}), (${other})`;

      // Runs a barred statement in its own savepoint so the transaction survives the refusal, and
      // hands back whatever sqlstate Postgres raised — never one copied from the migration.
      const refusalOf = async (
        run: (sp: postgres.TransactionSql) => Promise<unknown>,
      ): Promise<string> => {
        let code: string | undefined;
        await tx
          .savepoint(async (sp) => {
            await run(sp);
          })
          .catch((error: unknown) => {
            code = pgErrorCode(error);
          });
        return code ?? "none";
      };

      await enterUserContext(tx, owner);
      const [credential] = await tx<{ id: string }[]>`
        insert into webhook_credentials (name, token_hash)
        values ('rls webhook writes live', ${ownerHash}) returning id`;

      // 152: the column privilege refuses the statement before the owner trigger can overwrite the
      // value, so the issue path has no way to mint a credential in someone else's name.
      const forgedCode = await refusalOf(
        (sp) => sp`insert into webhook_credentials (owner_user_id, name, token_hash)
          values (${other}, 'rls webhook writes forged', ${forgedHash})`,
      );
      assert(labels[0], forgedCode === "42501", `sqlstate ${forgedCode}`);

      // 153: the SELECT grant covers every column `listWebhookCredentials` projects. A column left out
      // of it would surface here as a privilege error, not as a null.
      type Projection = {
        id: string;
        name: string;
        default_account_id: string | null;
        default_category_id: string | null;
        rate_limit_per_min: number;
        last_used_at: Date | null;
        revoked_at: Date | null;
        created_at: Date;
      };
      let projected: Projection[] = [];
      let projectionCode: string | undefined;
      await tx
        .savepoint(async (sp) => {
          projected = await sp<Projection[]>`
            select id, name, default_account_id, default_category_id, rate_limit_per_min,
              last_used_at, revoked_at, created_at
            from webhook_credentials where id = ${credential.id}`;
        })
        .catch((error: unknown) => {
          projectionCode = pgErrorCode(error);
        });
      const projectedColumns = Object.keys(projected[0] ?? {});
      assert(
        labels[1],
        projectionCode === undefined &&
          projected.length === 1 &&
          projected[0].id === credential.id &&
          projectedColumns.length === 8,
        `rows = ${projected.length}, columns = ${projectedColumns.length}, sqlstate ${projectionCode ?? "none"}`,
      );

      // 154: both statements are identical and both run as `authenticated`; only the update policy's
      // owner filter tells them apart, so the second user's revoke finds no row to touch.
      const ownerRevoke = await tx`update webhook_credentials set revoked_at = now()
        where id = ${credential.id}`;
      const [{ stamped }] = await tx<{ stamped: boolean }[]>`
        select revoked_at is not null as stamped from webhook_credentials where id = ${credential.id}`;
      await enterUserContext(tx, other);
      const otherRevoke = await tx`update webhook_credentials set revoked_at = now()
        where id = ${credential.id}`;
      assert(
        labels[2],
        ownerRevoke.count === 1 && stamped === true && otherRevoke.count === 0,
        `owner update rows = ${ownerRevoke.count}, revoked_at set = ${stamped}, ` +
          `second user update rows = ${otherRevoke.count}`,
      );

      // 155: assertion 90 revokes as the object owner; this one revoked through the screen's own path,
      // and the resolver on the base connection stops answering for the hash either way.
      await tx`reset role`;
      const resolved = await tx<{ owner_user_id: string }[]>`
        select owner_user_id from private.resolve_webhook_credential(${ownerHash})`;
      assert(labels[3], resolved.length === 0, `resolver rows = ${resolved.length}`);

      // 156: the UPDATE grant lists name, the defaults, the rate limit and revoked_at and nothing else.
      // A token is replaced by issuing a new credential, and the window answers to the resolver alone.
      await enterUserContext(tx, owner);
      const tokenCode = await refusalOf(
        (sp) => sp`update webhook_credentials set token_hash = ${rotatedHash}
          where id = ${credential.id}`,
      );
      const countCode = await refusalOf(
        (sp) => sp`update webhook_credentials set rate_count = 0 where id = ${credential.id}`,
      );
      const windowCode = await refusalOf(
        (sp) => sp`update webhook_credentials set rate_window_started_at = now()
          where id = ${credential.id}`,
      );
      assert(
        labels[4],
        tokenCode === "42501" && countCode === "42501" && windowCode === "42501",
        `token_hash sqlstate ${tokenCode}, rate_count sqlstate ${countCode}, ` +
          `rate_window_started_at sqlstate ${windowCode}`,
      );

      // Forces `sql.begin` to issue ROLLBACK: nothing this function wrote may survive it.
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from webhook_credentials where name like 'rls webhook writes%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls webhook writes%' = ${probeCount}`,
  );
}

// Assertions 158-164: delivery and shape ownership, derived state, immutable insert state,
// per-owner idempotency and the checks tying pending rows to unresolved proposals.
async function checkIngestDeliveryPolicies() {
  console.log("");
  const owner = randomUUID();
  const other = randomUUID();
  const ownerShape = createHash("sha256").update(randomUUID()).digest("hex");
  const rejectedShape = createHash("sha256").update(randomUUID()).digest("hex");
  const approvedShape = createHash("sha256").update(randomUUID()).digest("hex");
  const auditShape = createHash("sha256").update(randomUUID()).digest("hex");
  const forcedRollback = Symbol("forced rollback");

  const labels = [
    "158. delivery and shape owner triggers stamp auth.uid and every ingest table writes an audit row",
    "159. a second user reads and updates none of the first user's deliveries",
    "160. insert grants bar forged state while a plain delivery lands pending and unresolved",
    "161. rejected shapes silence new deliveries while approved shapes leave them pending",
    "162. delivery references are unique per owner, not globally",
    "163. pending deliveries cannot name a transaction or a resolution time",
    "164. shape decisions are owner-isolated and unique per owner and shape",
  ];

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${owner}), (${other})`;
      await tx`insert into app_users (id) values (${owner}), (${other})`;

      const refusalOf = async (
        run: (sp: postgres.TransactionSql) => Promise<unknown>,
      ): Promise<string> => {
        let code: string | undefined;
        await tx
          .savepoint(async (sp) => {
            await run(sp);
          })
          .catch((error: unknown) => {
            code = pgErrorCode(error);
          });
        return code ?? "none";
      };

      await enterUserContext(tx, owner);
      const [{ id: categoryId }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${owner}, 'rls ingest audit category', 'expense') returning id`;
      const [{ id: accountId }] = await tx<{ id: string }[]>`
        insert into accounts (owner_user_id, name, kind, initial_balance_on)
        values (${owner}, 'rls ingest account', 'asset',
          (now() at time zone 'America/Bogota')::date) returning id`;
      const [{ id: transactionId }] = await tx<{ id: string }[]>`
        insert into transactions (from_account_id, amount_cents, occurred_at)
        values (${accountId}, 100, (now() at time zone 'America/Bogota')::date) returning id`;

      const forgedOwnerCode = await refusalOf(
        (sp) => sp`insert into ingest_deliveries
          (owner_user_id, external_ref, raw_text, shape_hash)
          values (${other}, 'rls-ingest-forged-owner', 'fixture', ${ownerShape})`,
      );
      const [delivery] = await tx<
        { id: string; owner_user_id: string; status: string; resolved_at: Date | null }[]
      >`insert into ingest_deliveries (external_ref, raw_text, shape_hash)
        values ('rls-ingest-owner', 'fixture', ${ownerShape})
        returning id, owner_user_id, status, resolved_at`;
      const [shape] = await tx<{ id: string; owner_user_id: string }[]>`
        insert into ingest_shapes (shape_hash, decision, sample_text)
        values (${auditShape}, 'approved', 'fixture') returning id, owner_user_id`;
      await tx`select private.remember_ingest_merchant(
        'rls-ingest-audit-merchant', 'RLS ingest audit merchant', ${categoryId})`;
      const [merchant] = await tx<{ id: string; owner_user_id: string }[]>`
        select id, owner_user_id from ingest_merchants
        where merchant_key = 'rls-ingest-audit-merchant'`;
      await tx`reset role`;
      const auditRows = await tx<{ entity: string; record_id: string }[]>`
        select entity, record_id from audit_log
        where action = 'INSERT' and (
          (entity = 'ingest_deliveries' and record_id = ${delivery.id}) or
          (entity = 'ingest_shapes' and record_id = ${shape.id}) or
          (entity = 'ingest_merchants' and record_id = ${merchant.id})
        )`;
      const audited = new Set(
        auditRows.map((row) => `${row.entity}:${row.record_id}`),
      );
      assert(
        labels[0],
        forgedOwnerCode === "42501" &&
          delivery.owner_user_id === owner &&
          shape.owner_user_id === owner &&
          merchant.owner_user_id === owner &&
          audited.has(`ingest_deliveries:${delivery.id}`) &&
          audited.has(`ingest_shapes:${shape.id}`) &&
          audited.has(`ingest_merchants:${merchant.id}`),
        `owner sqlstate ${forgedOwnerCode}, stamped owners = ${delivery.owner_user_id === owner}/${shape.owner_user_id === owner}/${merchant.owner_user_id === owner}, audit rows = ${auditRows.length}`,
      );

      await enterUserContext(tx, other);
      const [{ count: otherVisible }] = await tx<{ count: string }[]>`
        select count(*)::text as count from ingest_deliveries where id = ${delivery.id}`;
      const otherUpdate = await tx`update ingest_deliveries
        set status = 'rejected', resolved_at = now() where id = ${delivery.id}`;
      assert(
        labels[1],
        otherVisible === "0" && otherUpdate.count === 0,
        `visible rows = ${otherVisible}, updated rows = ${otherUpdate.count}`,
      );

      await enterUserContext(tx, owner);
      const statusCode = await refusalOf(
        (sp) => sp`insert into ingest_deliveries
          (external_ref, raw_text, shape_hash, status)
          values ('rls-ingest-forged-status', 'fixture', ${ownerShape}, 'accepted')`,
      );
      const resolvedCode = await refusalOf(
        (sp) => sp`insert into ingest_deliveries
          (external_ref, raw_text, shape_hash, resolved_at)
          values ('rls-ingest-forged-resolved', 'fixture', ${ownerShape}, now())`,
      );
      const transactionCode = await refusalOf(
        (sp) => sp`insert into ingest_deliveries
          (external_ref, raw_text, shape_hash, transaction_id)
          values ('rls-ingest-forged-transaction', 'fixture', ${ownerShape}, ${transactionId})`,
      );
      const [plain] = await tx<{ status: string; resolved_at: Date | null }[]>`
        insert into ingest_deliveries (external_ref, raw_text, shape_hash)
        values ('rls-ingest-plain', 'fixture', ${ownerShape})
        returning status, resolved_at`;
      assert(
        labels[2],
        statusCode === "42501" &&
          resolvedCode === "42501" &&
          transactionCode === "42501" &&
          plain.status === "pending" &&
          plain.resolved_at === null,
        `status sqlstate ${statusCode}, resolved_at sqlstate ${resolvedCode}, transaction_id sqlstate ${transactionCode}, stored ${plain.status}/${plain.resolved_at === null ? "null" : "set"}`,
      );

      await tx`insert into ingest_shapes (shape_hash, decision, sample_text)
        values (${rejectedShape}, 'rejected', 'fixture'),
               (${approvedShape}, 'approved', 'fixture')`;
      const [silenced] = await tx<{ status: string; resolved_at: Date | null }[]>`
        insert into ingest_deliveries (external_ref, raw_text, shape_hash)
        values ('rls-ingest-silenced', 'fixture', ${rejectedShape})
        returning status, resolved_at`;
      const [approved] = await tx<{ status: string; resolved_at: Date | null }[]>`
        insert into ingest_deliveries (external_ref, raw_text, shape_hash)
        values ('rls-ingest-approved', 'fixture', ${approvedShape})
        returning status, resolved_at`;
      assert(
        labels[3],
        silenced.status === "rejected" &&
          silenced.resolved_at !== null &&
          approved.status === "pending" &&
          approved.resolved_at === null,
        `rejected shape stored ${silenced.status}/${silenced.resolved_at ? "set" : "null"}, approved shape stored ${approved.status}/${approved.resolved_at ? "set" : "null"}`,
      );

      const duplicateCode = await refusalOf(
        (sp) => sp`insert into ingest_deliveries (external_ref, raw_text, shape_hash)
          values ('rls-ingest-owner', 'fixture duplicate', ${ownerShape})`,
      );
      await enterUserContext(tx, other);
      const sameRefOther = await tx<{ id: string }[]>`
        insert into ingest_deliveries (external_ref, raw_text, shape_hash)
        values ('rls-ingest-owner', 'fixture other owner', ${ownerShape}) returning id`;
      assert(
        labels[4],
        duplicateCode === "23505" && sameRefOther.length === 1,
        `owner duplicate sqlstate ${duplicateCode}, second-owner rows = ${sameRefOther.length}`,
      );

      await enterUserContext(tx, owner);
      const transactionPendingCode = await refusalOf(
        (sp) => sp`update ingest_deliveries set transaction_id = ${transactionId}
          where id = ${delivery.id}`,
      );
      const resolvedPendingCode = await refusalOf(
        (sp) => sp`update ingest_deliveries set resolved_at = now()
          where id = ${delivery.id}`,
      );
      assert(
        labels[5],
        transactionPendingCode === "23514" && resolvedPendingCode === "23514",
        `transaction_id sqlstate ${transactionPendingCode}, resolved_at sqlstate ${resolvedPendingCode}`,
      );

      await enterUserContext(tx, other);
      const [{ count: otherShapes }] = await tx<{ count: string }[]>`
        select count(*)::text as count from ingest_shapes where id = ${shape.id}`;
      const otherShapeUpdate = await tx`update ingest_shapes set decision = 'rejected'
        where id = ${shape.id}`;
      await enterUserContext(tx, owner);
      const shapeDuplicateCode = await refusalOf(
        (sp) => sp`insert into ingest_shapes (shape_hash, decision, sample_text)
          values (${auditShape}, 'rejected', 'fixture duplicate')`,
      );
      assert(
        labels[6],
        otherShapes === "0" &&
          otherShapeUpdate.count === 0 &&
          shapeDuplicateCode === "23505",
        `second-user rows = ${otherShapes}, updates = ${otherShapeUpdate.count}, duplicate sqlstate ${shapeDuplicateCode}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });
}

type MerchantSnapshot = {
  id: string;
  owner_user_id: string;
  merchant_key: string;
  merchant_label: string;
  state: "learning" | "trusted" | "ambiguous";
  candidate_category_id: string | null;
  streak: number;
  trusted_category_id: string | null;
  created_at: Date;
  updated_at: Date;
};

// Assertions 165-172: only the definer writes merchant memory, its transition is sticky and
// owner-scoped, the shape definer can read forced-RLS rows, and the resolver returns its id.
async function checkIngestMerchantTrust() {
  console.log("");
  const owner = randomUUID();
  const other = randomUUID();
  const rejectedShape = createHash("sha256").update(randomUUID()).digest("hex");
  const tokenHash = createHash("sha256").update(randomUUID()).digest("hex");
  const forcedRollback = Symbol("forced rollback");

  const labels = [
    "165. authenticated cannot insert or update merchant memory directly",
    "166. two matching approvals trust a merchant and a contradiction makes it ambiguous",
    "167. ambiguity stays pinned after later matching approvals",
    "168. a disagreement while learning restarts the streak without pinning ambiguity",
    "169. merchant memory is isolated per user even for the same merchant key",
    "170. the delivery-state definer owner bypasses forced RLS to read silenced shapes",
    "171. the credential resolver permanently proves the credential id projection",
  ];
  const tailLabel = "172. the rolled-back ingest transaction leaves no trace";

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${owner}), (${other})`;
      await tx`insert into app_users (id) values (${owner}), (${other})`;

      const refusalOf = async (
        run: (sp: postgres.TransactionSql) => Promise<unknown>,
      ): Promise<string> => {
        let code: string | undefined;
        await tx
          .savepoint(async (sp) => {
            await run(sp);
          })
          .catch((error: unknown) => {
            code = pgErrorCode(error);
          });
        return code ?? "none";
      };
      const readMerchant = async (key: string): Promise<MerchantSnapshot> => {
        const [row] = await tx<MerchantSnapshot[]>`
          select * from ingest_merchants where merchant_key = ${key}`;
        if (!row) throw new Error(`missing merchant fixture ${key}`);
        return row;
      };

      await enterUserContext(tx, owner);
      const [{ id: categoryA }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${owner}, 'rls ingest merchant A', 'expense') returning id`;
      const [{ id: categoryB }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${owner}, 'rls ingest merchant B', 'expense') returning id`;
      await tx`select private.remember_ingest_merchant(
        'rls-ingest-main', 'RLS ingest main', ${categoryA})`;

      const directInsertCode = await refusalOf(
        (sp) => sp`insert into ingest_merchants
          (owner_user_id, merchant_key, merchant_label)
          values (${owner}, 'rls-ingest-forged', 'RLS ingest forged')`,
      );
      const directUpdateCode = await refusalOf(
        (sp) => sp`update ingest_merchants set state = 'trusted'
          where merchant_key = 'rls-ingest-main'`,
      );
      assert(
        labels[0],
        directInsertCode === "42501" && directUpdateCode === "42501",
        `insert sqlstate ${directInsertCode}, update sqlstate ${directUpdateCode}`,
      );

      const first = await readMerchant("rls-ingest-main");
      await tx`select private.remember_ingest_merchant(
        'rls-ingest-main', 'RLS ingest main', ${categoryA})`;
      const second = await readMerchant("rls-ingest-main");
      await tx`select private.remember_ingest_merchant(
        'rls-ingest-main', 'RLS ingest main', ${categoryB})`;
      const third = await readMerchant("rls-ingest-main");
      assert(
        labels[1],
        first.state === "learning" &&
          first.streak === 1 &&
          first.trusted_category_id === null &&
          second.state === "trusted" &&
          second.streak === 2 &&
          second.trusted_category_id === categoryA &&
          third.state === "ambiguous" &&
          third.trusted_category_id === null,
        `first ${first.state}/${first.streak}/${first.trusted_category_id}, second ${second.state}/${second.streak}/${second.trusted_category_id}, third ${third.state}/${third.streak}/${third.trusted_category_id}`,
      );

      await tx`select private.remember_ingest_merchant(
        'rls-ingest-main', 'RLS ingest main', ${categoryA})`;
      await tx`select private.remember_ingest_merchant(
        'rls-ingest-main', 'RLS ingest main', ${categoryA})`;
      const sticky = await readMerchant("rls-ingest-main");
      assert(
        labels[2],
        sticky.state === "ambiguous" && sticky.trusted_category_id === null,
        `state = ${sticky.state}, streak = ${sticky.streak}, trusted_category_id = ${sticky.trusted_category_id}`,
      );

      await tx`select private.remember_ingest_merchant(
        'rls-ingest-learning', 'RLS ingest learning', ${categoryA})`;
      await tx`select private.remember_ingest_merchant(
        'rls-ingest-learning', 'RLS ingest learning', ${categoryB})`;
      const learning = await readMerchant("rls-ingest-learning");
      assert(
        labels[3],
        learning.state === "learning" &&
          learning.streak === 1 &&
          learning.candidate_category_id === categoryB &&
          learning.trusted_category_id === null,
        `state = ${learning.state}, streak = ${learning.streak}, candidate_category_id = ${learning.candidate_category_id}, trusted_category_id = ${learning.trusted_category_id}`,
      );

      const ownerBefore = await readMerchant("rls-ingest-main");
      await enterUserContext(tx, other);
      const [{ id: otherCategory }] = await tx<{ id: string }[]>`
        insert into categories (owner_user_id, name, kind)
        values (${other}, 'rls ingest merchant other', 'expense') returning id`;
      await tx`select private.remember_ingest_merchant(
        'rls-ingest-main', 'RLS ingest main', ${otherCategory})`;
      const otherRows = await tx<MerchantSnapshot[]>`
        select * from ingest_merchants where merchant_key = 'rls-ingest-main'`;
      await enterUserContext(tx, owner);
      const ownerAfter = await readMerchant("rls-ingest-main");
      assert(
        labels[4],
        otherRows.length === 1 &&
          otherRows[0].owner_user_id === other &&
          JSON.stringify(ownerAfter) === JSON.stringify(ownerBefore),
        `second-user visible rows = ${otherRows.length}, owns row = ${otherRows[0]?.owner_user_id === other}, first row unchanged = ${JSON.stringify(ownerAfter) === JSON.stringify(ownerBefore)}`,
      );

      await tx`insert into ingest_shapes (shape_hash, decision, sample_text)
        values (${rejectedShape}, 'rejected', 'fixture')`;
      const [silenced] = await tx<{ status: string; resolved_at: Date | null }[]>`
        insert into ingest_deliveries (external_ref, raw_text, shape_hash)
        values ('rls-ingest-definer', 'fixture', ${rejectedShape})
        returning status, resolved_at`;
      await tx`reset role`;
      const [definer] = await tx<
        { security_definer: boolean; owner: string; bypass: boolean; forced: boolean }[]
      >`select p.prosecdef as security_definer, r.rolname as owner,
          r.rolbypassrls as bypass, c.relforcerowsecurity as forced
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join pg_roles r on r.oid = p.proowner
        join pg_class c on c.oid = 'public.ingest_shapes'::regclass
        where n.nspname = 'private' and p.proname = 'set_ingest_delivery_state'`;
      assert(
        labels[5],
        definer.security_definer &&
          definer.owner === "postgres" &&
          definer.bypass &&
          definer.forced &&
          silenced.status === "rejected" &&
          silenced.resolved_at !== null,
        `security definer = ${definer.security_definer}, owner = ${definer.owner}, bypass = ${definer.bypass}, forced = ${definer.forced}, stored = ${silenced.status}/${silenced.resolved_at ? "set" : "null"}`,
      );

      await enterUserContext(tx, owner);
      const [credential] = await tx<{ id: string }[]>`
        insert into webhook_credentials (name, token_hash)
        values ('rls ingest resolver id', ${tokenHash}) returning id`;
      await tx`reset role`;
      const resolved = await tx<{ id: string; owner_user_id: string }[]>`
        select id, owner_user_id from private.resolve_webhook_credential(${tokenHash})`;
      assert(
        labels[6],
        resolved.length === 1 &&
          resolved[0].id === credential.id &&
          resolved[0].owner_user_id === owner,
        `rows = ${resolved.length}, credential id matches = ${resolved[0]?.id === credential.id}, owner matches = ${resolved[0]?.owner_user_id === owner}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`
    select current_user`;
  const [survivors] = await sql<
    { deliveries: string; shapes: string; merchants: string }[]
  >`select
      (select count(*)::text from ingest_deliveries
        where external_ref like 'rls-ingest-%') as deliveries,
      (select count(*)::text from ingest_shapes
        where sample_text = 'fixture' and shape_hash = ${rejectedShape}) as shapes,
      (select count(*)::text from ingest_merchants
        where merchant_key like 'rls-ingest-%') as merchants`;
  assert(
    tailLabel,
    afterUser === "postgres" &&
      survivors.deliveries === "0" &&
      survivors.shapes === "0" &&
      survivors.merchants === "0",
    `current_user = ${afterUser}, deliveries = ${survivors.deliveries}, shapes = ${survivors.shapes}, merchants = ${survivors.merchants}`,
  );
}

// A DrizzleQueryError names only the query it ran: the driver's message hangs off
// the cause chain, like its sqlstate. Both are reported, because `permission denied
// for table X` and `new row violates row-level security policy` are both 42501.
function describeRefusal(error: unknown): string {
  let current: unknown = error;
  let message = String(error);

  for (let hop = 0; hop < 5; hop++) {
    if (typeof current !== "object" || current === null) break;
    if ("message" in current && typeof current.message === "string") {
      message = current.message;
    }
    current = "cause" in current ? current.cause : undefined;
  }

  return `sqlstate ${pgErrorCode(error) ?? "none"} — ${message.split("\n")[0]}`;
}

// The mapping `insertRow` writes through: a JS key becomes a column name here, and
// nowhere else. `getTableConfig(...).columns[].name` returns the key itself, so a
// proof built on it would agree with the helper while both were wrong.
const insertCasing = new CasingCache("snake_case");

// Every table `db/schema` exports, with the column names the helper would write.
function schemaTables(): { name: string; columns: string[] }[] {
  // Cast first: the exports are a union of concrete table types, and a predicate
  // narrowing to the base class is not assignable to any one of them.
  return (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => ({
      name: getTableConfig(table).name,
      columns: Object.values(getTableColumns(table) as Record<string, PgColumn>).map(
        (column) => insertCasing.getColumnCasing(column),
      ),
    }))
    .sort((first, second) => first.name.localeCompare(second.name));
}

// The columns `authenticated` holds NO INSERT on, per table, read off the live
// database and pinned here. A migration that widens or narrows a grant fails 174
// and has to change this map on purpose. An empty array is a table whose every
// column may be written; a table absent from the app's schema is a failure too.
const INSERT_GRANT_GAPS: Record<string, string[]> = {
  accounts: ["archived_at", "created_at", "id", "updated_at"],
  app_users: [],
  audit_log: [
    "action",
    "actor_user_id",
    "after_data",
    "before_data",
    "entity",
    "group_id",
    "id",
    "occurred_at",
    "owner_user_id",
    "record_id",
  ],
  budgets: ["archived_at", "created_at", "id", "updated_at"],
  categories: ["created_at", "id", "updated_at"],
  debt_statements: ["closed_at", "id"],
  debt_terms: ["created_at", "updated_at"],
  goal_contributions: ["id"],
  group_members: [],
  groups: ["created_at", "currency", "updated_at"],
  ingest_deliveries: [
    "created_at",
    "id",
    "owner_user_id",
    "resolved_at",
    "status",
    "transaction_id",
    "updated_at",
  ],
  ingest_merchants: [
    "candidate_category_id",
    "created_at",
    "id",
    "merchant_key",
    "merchant_label",
    "owner_user_id",
    "state",
    "streak",
    "trusted_category_id",
    "updated_at",
  ],
  ingest_shapes: ["created_at", "id", "owner_user_id", "updated_at"],
  installment_lines: ["created_at", "id", "paid_transaction_id"],
  installment_plans: ["created_at", "id", "updated_at"],
  labels: ["created_at", "id", "updated_at"],
  planned_payments: [
    "created_at",
    "created_by",
    "group_id",
    "id",
    "owner_user_id",
    "settled_transaction_id",
    "status",
    "updated_at",
  ],
  recurring_rules: [
    "created_at",
    "created_by",
    "group_id",
    "id",
    "is_active",
    "owner_user_id",
    "updated_at",
  ],
  savings_goals: ["archived_at", "created_at", "id", "updated_at"],
  transaction_labels: [],
  transaction_splits: ["id"],
  transactions: [
    "created_at",
    "created_by",
    "group_id",
    "id",
    "kind",
    "owner_user_id",
    "recurring_rule_id",
    "reviewed_at",
    "updated_at",
  ],
  webhook_credentials: [
    "created_at",
    "id",
    "last_used_at",
    "owner_user_id",
    "rate_count",
    "rate_window_started_at",
    "revoked_at",
    "updated_at",
  ],
};

// Assertions 173-174: the two facts `insertRow` rests on — that its snake_case map
// names real columns, and that the per-column INSERT grants are still the ones the
// helper exists to satisfy. Catalogue reads only: no fixture, no write, no role switch.
async function checkInsertGrantMap() {
  console.log("");
  const tables = schemaTables();

  const live = await sql<{ table_name: string; column_name: string }[]>`
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
     and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'`;

  const realColumns = new Set(live.map((row) => `${row.table_name}.${row.column_name}`));
  const unmapped = tables.flatMap((table) =>
    table.columns
      .map((column) => `${table.name}.${column}`)
      .filter((qualified) => !realColumns.has(qualified)),
  );
  const mappedCount = tables.reduce((total, table) => total + table.columns.length, 0);

  assert(
    "173. every column name insertRow derives is a real column",
    unmapped.length === 0,
    `${tables.length} tables, ${mappedCount} columns mapped, ${unmapped.length} unmapped${
      unmapped.length > 0 ? `: ${unmapped.join(", ")}` : ""
    }`,
  );

  const gaps = await sql<{ table_name: string; column_name: string }[]>`
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
     and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and not has_column_privilege(
        'authenticated',
        ('public.' || quote_ident(c.table_name))::regclass,
        c.column_name,
        'INSERT')`;

  const liveGaps: Record<string, string[]> = {};
  for (const { table_name } of live) liveGaps[table_name] ??= [];
  for (const { table_name, column_name } of gaps) liveGaps[table_name].push(column_name);

  const compared = [
    ...new Set([...Object.keys(liveGaps), ...Object.keys(INSERT_GRANT_GAPS)]),
  ].sort();
  const drifted = compared.filter(
    (table) =>
      JSON.stringify((liveGaps[table] ?? ["<no such table>"]).sort()) !==
      JSON.stringify((INSERT_GRANT_GAPS[table] ?? ["<not recorded>"]).sort()),
  );

  assert(
    "174. the per-column INSERT grants are the ones recorded here",
    drifted.length === 0,
    `compared ${compared.length} tables (${compared.join(", ")})${
      drifted.length > 0
        ? `; drifted: ${drifted
            .map(
              (table) =>
                `${table} recorded [${(INSERT_GRANT_GAPS[table] ?? []).join(", ")}] live [${(liveGaps[table] ?? []).join(", ")}]`,
            )
            .join("; ")}`
        : ""
    }`,
  );
}

// Assertions 175-178: `insertRow` against the grants, and the Drizzle insert builder
// against the same values as the negative control — without that refusal the suite
// would pass on a database that granted INSERT on every column. Fixtures are seeded
// inside one transaction that is forced to roll back, entered with the one-statement
// settle `withUserDb` uses; each barred statement runs in its own savepoint.
async function checkInsertHelper() {
  console.log("");
  const owner = randomUUID();
  const today = "2026-01-01";
  const forcedRollback = Symbol("forced rollback");

  const labels = [
    "175. insertRow writes the account the builder is refused",
    "176. the columns insertRow omits are stamped, not lost",
    "177. insertRow writes both splits the builder is refused",
  ];
  const tailLabel =
    "178. insertRow upserts debt terms, updated_at in the SET is refused, and nothing survived";

  type OrmTx = Parameters<Parameters<typeof orm.transaction>[0]>[0];
  const enter = (tx: OrmTx, subject: string) =>
    tx.execute(dsql`select
      set_config('request.jwt.claims', ${JSON.stringify({ sub: subject, role: "authenticated", aud: "authenticated" })}, true),
      set_config('statement_timeout', '8000', true),
      set_config('role', 'authenticated', true)`);

  // `permission denied for table X` and `new row violates row-level security
  // policy` share sqlstate 42501, and only the first is the grant this suite is
  // about — so every refusal carries its message too.
  let upsertOutcome = "the transaction never ran";

  await orm
    .transaction(async (tx) => {
      await tx.execute(dsql`insert into auth.users (id) values (${owner})`);
      await tx.execute(dsql`insert into app_users (id) values (${owner})`);
      await enter(tx, owner);

      const refusalOf = async (run: (sp: OrmTx) => Promise<unknown>): Promise<string> => {
        let refusal = "no refusal — the statement was accepted";
        await tx
          .transaction(async (sp) => {
            await run(sp);
          })
          .catch((error: unknown) => {
            refusal = describeRefusal(error);
          });
        return refusal;
      };

      // 175: `createAccount`'s exact key set — the ten columns a caller sends, with
      // `id`, `created_at` and `updated_at` left to the triggers.
      const cardValues = {
        name: "RLS insert helper card",
        kind: "liability" as const,
        subtype: "bancaria" as const,
        ownerUserId: owner,
        groupId: null,
        isShared: false,
        institution: "Bancolombia",
        lastFour: "4321",
        initialBalanceCents: -150000,
        initialBalanceOn: today,
      };

      const [card] = await insertRow(tx, schema.accounts, cardValues, {
        returning: { id: schema.accounts.id },
      });
      const builderRefusal = await refusalOf((sp) =>
        sp.insert(schema.accounts).values(cardValues),
      );

      assert(
        labels[0],
        card?.id !== undefined &&
          builderRefusal.includes("42501") &&
          builderRefusal.includes("permission denied for table accounts"),
        `helper wrote ${card?.id ?? "nothing"}, builder ${builderRefusal}`,
      );

      // 176: the same row read back. `subtype` went in as 'bancaria' and comes out
      // 'tarjeta' — `set_account_subtype` follows the kind, and the helper's
      // statement reaches the trigger like any other.
      const [stamped] = await tx.execute<{
        id: string;
        created_at: Date | null;
        updated_at: Date | null;
        subtype: string;
      }>(
        dsql`select id, created_at, updated_at, subtype from accounts where id = ${card.id}`,
      );
      assert(
        labels[1],
        stamped.id === card.id &&
          stamped.created_at !== null &&
          stamped.updated_at !== null &&
          stamped.subtype === "tarjeta",
        `created_at = ${stamped.created_at !== null}, updated_at = ${stamped.updated_at !== null}, subtype = ${stamped.subtype} from 'bancaria'`,
      );

      // 177: two rows, one statement, against a movement of the owner's own.
      const [cash] = await tx.execute<{ id: string }>(
        dsql`insert into accounts
          (owner_user_id, name, kind, subtype, initial_balance_cents, initial_balance_on)
          values (${owner}, 'RLS insert helper cash', 'asset', 'efectivo', 100000, ${today})
          returning id`,
      );
      const [category] = await tx.execute<{ id: string }>(
        dsql`insert into categories (owner_user_id, name, kind)
          values (${owner}, 'RLS insert helper spend', 'expense') returning id`,
      );
      const [movement] = await tx.execute<{ id: string }>(
        dsql`insert into transactions (from_account_id, amount_cents, occurred_at)
          values (${cash.id}, 5000, ${today}) returning id`,
      );

      const splitValues = [
        { transactionId: movement.id, categoryId: category.id, amountCents: 3000 },
        { transactionId: movement.id, categoryId: category.id, amountCents: 2000 },
      ];
      await insertRow(tx, schema.transactionSplits, splitValues);
      const [{ count: splitCount }] = await tx.execute<{ count: string }>(
        dsql`select count(*)::text as count from transaction_splits
          where transaction_id = ${movement.id}`,
      );
      const splitBuilderRefusal = await refusalOf((sp) =>
        sp.insert(schema.transactionSplits).values(splitValues),
      );

      assert(
        labels[2],
        splitCount === "2" &&
          splitBuilderRefusal.includes("42501") &&
          splitBuilderRefusal.includes("permission denied for table transaction_splits"),
        `helper wrote ${splitCount} splits, builder ${splitBuilderRefusal}`,
      );

      // 178: the upsert `upsertDebtTerms` runs, then the same statement with
      // `updated_at` in the SET — no UPDATE grant covers that column, and Postgres
      // checks the SET privileges whether or not a row conflicts.
      const terms = {
        debtKind: "revolving" as const,
        annualRate: "0.2800",
        minimumPaymentCents: 5000,
        minimumPaymentPct: null,
        creditLimitCents: 1000000,
        statementCutOffDay: 15,
        paymentDueDay: 5,
        avalCents: null,
      };
      const upsert = (on: OrmTx, set: InsertValues<typeof schema.debtTerms>) =>
        insertRow(
          on,
          schema.debtTerms,
          { accountId: card.id, ...terms },
          { onConflict: { target: schema.debtTerms.accountId, set } },
        );

      await upsert(tx, terms);
      await upsert(tx, { ...terms, annualRate: "0.3500" });
      const [{ count: termCount, rate }] = await tx.execute<{
        count: string;
        rate: string;
      }>(
        dsql`select count(*)::text as count, max(annual_rate)::text as rate
          from debt_terms where account_id = ${card.id}`,
      );
      const stampedSetRefusal = await refusalOf((sp) =>
        upsert(sp, { ...terms, updatedAt: dsql`now()` }),
      );

      upsertOutcome = `${termCount} row at rate ${rate}, updated_at in the SET ${stampedSetRefusal}`;
      const upsertHeld =
        termCount === "1" &&
        Number(rate) === 0.35 &&
        stampedSetRefusal.includes("42501") &&
        stampedSetRefusal.includes("permission denied for table debt_terms");

      // Nothing this section wrote may survive; force the ROLLBACK.
      if (!upsertHeld) upsertOutcome = `${upsertOutcome} — not what was expected`;
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`
    select current_user`;
  const [survivors] = await sql<{ accounts: string; terms: string }[]>`
    select
      (select count(*)::text from accounts
        where name like 'RLS insert helper%') as accounts,
      (select count(*)::text from debt_terms t
        join accounts a on a.id = t.account_id
        where a.name like 'RLS insert helper%') as terms`;

  assert(
    tailLabel,
    upsertOutcome.includes("permission denied for table debt_terms") &&
      !upsertOutcome.includes("not what was expected") &&
      afterUser === "postgres" &&
      survivors.accounts === "0" &&
      survivors.terms === "0",
    `${upsertOutcome}; current_user = ${afterUser}, accounts surviving = ${survivors.accounts}, terms surviving = ${survivors.terms}`,
  );
}

// Assertions 179-183: the `user_id` lock on group_members. `grant update (user_id, invite_email)`
// served the invite claim, but a grant spans every UPDATE policy on the table, and
// `group_members_update_member` admits every row in the group: a plain member could repoint the
// leader's `user_id` at a second account of his own, evicting her and inheriting the group with the
// `role = 'leader'` the row keeps. The attack is executed here, not read off the policy text.
// Fixtures live in one transaction forced to roll back; each barred statement runs in its own savepoint.
async function checkGroupMemberUserIdLock() {
  console.log("");
  const leaderUser = randomUUID();
  const memberUser = randomUUID();
  // The attacker's second sign-up: a real row, since `user_id` carries a foreign key.
  const strangerUser = randomUUID();
  const memberEmail = `member-${randomUUID()}@example.test`;
  const groupId = randomUUID();
  const forcedRollback = Symbol("forced rollback");

  const labels = [
    "179. the invited caller's claim lands on their own pending row and clears the invite",
    "180. a second claim by the same caller returns null",
    "181. a plain member cannot repoint the leader's user_id at an account of his own",
    "182. a plain member still renames their own row",
  ];
  const tailLabel = "183. the rolled-back escalation transaction leaves no trace";

  type OrmTx = Parameters<Parameters<typeof orm.transaction>[0]>[0];
  const enter = (tx: OrmTx, subject: string, email?: string) =>
    tx.execute(dsql`select
      set_config('request.jwt.claims', ${JSON.stringify({ sub: subject, role: "authenticated", aud: "authenticated", ...(email ? { email } : {}) })}, true),
      set_config('statement_timeout', '8000', true),
      set_config('role', 'authenticated', true)`);

  await orm
    .transaction(async (tx) => {
      const refusalOf = async (run: (sp: OrmTx) => Promise<unknown>): Promise<string> => {
        let refusal = "no refusal — the statement was accepted";
        await tx
          .transaction(async (sp) => {
            await run(sp);
          })
          .catch((error: unknown) => {
            refusal = describeRefusal(error);
          });
        return refusal;
      };

      await tx.execute(
        dsql`insert into auth.users (id) values (${leaderUser}), (${memberUser}), (${strangerUser})`,
      );
      await tx.execute(
        dsql`insert into app_users (id) values (${leaderUser}), (${memberUser}), (${strangerUser})`,
      );

      // The leader opens the group and records the person she invites by email (RF-07).
      await enter(tx, leaderUser);
      await tx.execute(
        dsql`insert into groups (id, name, cash_mode) values (${groupId}, 'rls escalation', 'shared')`,
      );
      const [leaderRow] = await tx.execute<{ id: string }>(
        dsql`insert into group_members (group_id, user_id, name, role)
          values (${groupId}, ${leaderUser}, 'rls escalation leader', 'leader') returning id`,
      );
      const [pending] = await tx.execute<{ id: string }>(
        dsql`insert into group_members (group_id, name, role, invite_email)
          values (${groupId}, 'rls escalation member', 'member', ${memberEmail}) returning id`,
      );

      // 179: the claim takes no argument, so the caller cannot aim it: the function reads auth.email()
      // and picks the oldest pending row addressed to it.
      await tx.execute(dsql`reset role`);
      await enter(tx, memberUser, memberEmail);
      const [{ claim_group_invite: claimedId }] = await tx.execute<{
        claim_group_invite: string | null;
      }>(dsql`select private.claim_group_invite()`);
      const [claimedRow] = await tx.execute<{
        user_id: string | null;
        invite_email: string | null;
        role: string;
      }>(dsql`select user_id, invite_email, role from group_members where id = ${pending.id}`);
      assert(
        labels[0],
        claimedId === pending.id &&
          claimedRow.user_id === memberUser &&
          claimedRow.invite_email === null &&
          claimedRow.role === "member",
        `claimed = ${claimedId === pending.id ? "the pending row" : claimedId}, user_id = ${claimedRow?.user_id === memberUser ? "self" : claimedRow?.user_id}, invite_email = ${claimedRow?.invite_email}, role = ${claimedRow?.role}`,
      );

      // 180: nothing pends on that email any more, so the same call claims nothing.
      const [{ claim_group_invite: repeatId }] = await tx.execute<{
        claim_group_invite: string | null;
      }>(dsql`select private.claim_group_invite()`);
      assert(labels[1], repeatId === null, `returned ${repeatId ?? "null"}`);

      // 181: the escalation itself, run as the plain member it was proved with. Before the grant was
      // narrowed this returned UPDATE 1 and left `role = 'leader'` on a row pointing at the stranger.
      let attackRows = -1;
      const attackRefusal = await refusalOf(async (sp) => {
        const rows = await sp.execute<{ id: string }>(
          dsql`update group_members set user_id = ${strangerUser}
            where id = ${leaderRow.id} returning id`,
        );
        attackRows = rows.length;
      });
      const [leaderNow] = await tx.execute<{ user_id: string | null; role: string }>(
        dsql`select user_id, role from group_members where id = ${leaderRow.id}`,
      );
      assert(
        labels[2],
        (attackRows === 0 || attackRefusal.includes("42501")) &&
          leaderNow.user_id === leaderUser &&
          leaderNow.role === "leader",
        `rows = ${attackRows === -1 ? "none issued" : attackRows}, ${attackRefusal}, leader row user_id = ${leaderNow?.user_id === leaderUser ? "still hers" : leaderNow?.user_id}, role = ${leaderNow?.role}`,
      );

      // 182: the negative control — the fix narrowed the grant, it did not withdraw the feature.
      const renamed = await tx.execute<{ id: string; name: string }>(
        dsql`update group_members set name = 'rls escalation renamed'
          where id = ${pending.id} returning id, name`,
      );
      assert(
        labels[3],
        renamed.length === 1 && renamed[0].name === "rls escalation renamed",
        `renamed ${renamed.length} row to '${renamed[0]?.name}'`,
      );

      // Nothing this section wrote may survive; force the ROLLBACK.
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from groups where name like 'rls escalation%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls escalation%' = ${probeCount}`,
  );
}

// Assertions 184-190: RF-100. `group_members_update_member` used `is_group_member` in its USING and a
// WITH CHECK that admitted any row but the caller's own, and `group_members_delete_member` the same,
// so a plain member archived and removed every other member — the leader's row answered `UPDATE 1`
// and `DELETE 1` on the live database, with only the deferred `assert_group_keeps_leader` between a
// group and no leader at all. Both attacks are executed here, then the two negative controls that say
// the feature survived. Fixtures live in one transaction forced to roll back; each barred statement
// runs in its own savepoint.
async function checkMemberManagementLeaderOnly() {
  console.log("");
  const leaderUser = randomUUID();
  const memberUser = randomUUID();
  const groupId = randomUUID();
  const forcedRollback = Symbol("forced rollback");

  const labels = [
    "184. a plain member's archive of the leader's row touches nothing",
    "185. a plain member's delete of the leader's row touches nothing",
    "186. a plain member cannot add a member",
    "187. a plain member still renames their own row",
    "188. the leader still adds, archives and removes a member",
    "189. a member the leader archived cannot restore herself",
  ];
  const tailLabel = "190. the rolled-back member management transaction leaves no trace";

  type OrmTx = Parameters<Parameters<typeof orm.transaction>[0]>[0];
  const enter = (tx: OrmTx, subject: string) =>
    tx.execute(dsql`select
      set_config('request.jwt.claims', ${JSON.stringify({ sub: subject, role: "authenticated", aud: "authenticated" })}, true),
      set_config('statement_timeout', '8000', true),
      set_config('role', 'authenticated', true)`);

  await orm
    .transaction(async (tx) => {
      const refusalOf = async (run: (sp: OrmTx) => Promise<unknown>): Promise<string> => {
        let refusal = "no refusal — the statement was accepted";
        await tx
          .transaction(async (sp) => {
            await run(sp);
          })
          .catch((error: unknown) => {
            refusal = describeRefusal(error);
          });
        return refusal;
      };

      await tx.execute(dsql`insert into auth.users (id) values (${leaderUser}), (${memberUser})`);
      await tx.execute(dsql`insert into app_users (id) values (${leaderUser}), (${memberUser})`);

      // The leader opens the group and records two people with no login: one for her to archive, one
      // for her to remove. The plain member's own row carries a login, which no policy hands out, so
      // it is seeded as `postgres`.
      await enter(tx, leaderUser);
      await tx.execute(
        dsql`insert into groups (id, name, cash_mode) values (${groupId}, 'rls member mgmt', 'shared')`,
      );
      const [leaderRow] = await tx.execute<{ id: string }>(
        dsql`insert into group_members (group_id, user_id, name, role)
          values (${groupId}, ${leaderUser}, 'rls member mgmt leader', 'leader') returning id`,
      );
      const [toArchive] = await tx.execute<{ id: string }>(
        dsql`insert into group_members (group_id, name, role)
          values (${groupId}, 'rls member mgmt archivable', 'member') returning id`,
      );
      const [toRemove] = await tx.execute<{ id: string }>(
        dsql`insert into group_members (group_id, name, role)
          values (${groupId}, 'rls member mgmt removable', 'member') returning id`,
      );
      await tx.execute(dsql`reset role`);
      const [memberRow] = await tx.execute<{ id: string }>(
        dsql`insert into group_members (group_id, user_id, name, role)
          values (${groupId}, ${memberUser}, 'rls member mgmt member', 'member') returning id`,
      );

      await enter(tx, memberUser);

      // 184: the archive attack. Before the policies were narrowed this answered UPDATE 1 and left the
      // leader out of her own group on the next request.
      let archiveRows = -1;
      const archiveRefusal = await refusalOf(async (sp) => {
        const rows = await sp.execute<{ id: string }>(
          dsql`update group_members set archived_at = now() where id = ${leaderRow.id} returning id`,
        );
        archiveRows = rows.length;
      });
      const [leaderAfterArchive] = await tx.execute<{ archived_at: string | null }>(
        dsql`select archived_at::text from group_members where id = ${leaderRow.id}`,
      );
      assert(
        labels[0],
        (archiveRows === 0 || archiveRefusal.includes("42501")) &&
          leaderAfterArchive.archived_at === null,
        `rows = ${archiveRows === -1 ? "none issued" : archiveRows}, ${archiveRefusal}, leader archived_at = ${leaderAfterArchive?.archived_at ?? "null"}`,
      );

      // 185: the delete attack. It answered DELETE 1, and only the deferred keep-leader trigger stood
      // between the group and no leader — and it stands for the last leader alone.
      let deleteRows = -1;
      const deleteRefusal = await refusalOf(async (sp) => {
        const rows = await sp.execute<{ id: string }>(
          dsql`delete from group_members where id = ${leaderRow.id} returning id`,
        );
        deleteRows = rows.length;
      });
      const [{ count: leaderSurvives }] = await tx.execute<{ count: string }>(
        dsql`select count(*)::text as count from group_members where id = ${leaderRow.id}`,
      );
      assert(
        labels[1],
        (deleteRows === 0 || deleteRefusal.includes("42501")) && leaderSurvives === "1",
        `rows = ${deleteRows === -1 ? "none issued" : deleteRows}, ${deleteRefusal}, leader rows surviving = ${leaderSurvives}`,
      );

      // 186: an INSERT has no USING to filter it, so the refusal is the WITH CHECK itself.
      const insertRefusal = await refusalOf((sp) =>
        sp.execute(
          dsql`insert into group_members (group_id, name, role)
            values (${groupId}, 'rls member mgmt smuggled', 'member')`,
        ),
      );
      const [{ count: smuggled }] = await tx.execute<{ count: string }>(
        dsql`select count(*)::text as count from group_members
          where group_id = ${groupId} and name = 'rls member mgmt smuggled'`,
      );
      assert(
        labels[2],
        insertRefusal.includes("42501") && smuggled === "0",
        `${insertRefusal}, rows landed = ${smuggled}`,
      );

      // 187: the first negative control — every member keeps their own name (RF-100).
      const renamed = await tx.execute<{ id: string; name: string }>(
        dsql`update group_members set name = 'rls member mgmt renamed'
          where id = ${memberRow.id} returning id, name`,
      );
      assert(
        labels[3],
        renamed.length === 1 && renamed[0].name === "rls member mgmt renamed",
        `renamed ${renamed.length} row to '${renamed[0]?.name}'`,
      );

      // 188: the second negative control — the leader keeps the whole feature.
      await tx.execute(dsql`reset role`);
      await enter(tx, leaderUser);
      const added = await tx.execute<{ id: string }>(
        dsql`insert into group_members (group_id, name, role)
          values (${groupId}, 'rls member mgmt added', 'member') returning id`,
      );
      const archived = await tx.execute<{ archived_at: string | null }>(
        dsql`update group_members set archived_at = now()
          where id = ${toArchive.id} returning archived_at::text`,
      );
      const removed = await tx.execute<{ id: string }>(
        dsql`delete from group_members where id = ${toRemove.id} returning id`,
      );
      assert(
        labels[4],
        added.length === 1 &&
          archived.length === 1 &&
          archived[0].archived_at !== null &&
          removed.length === 1,
        `added ${added.length}, archived ${archived.length} at ${archived[0]?.archived_at ?? "nothing"}, removed ${removed.length}`,
      );

      // 189: restoring is the leader's too, and the caller's own row is the one exception the update
      // policy carries — so the USING drops it once it is archived, or an eviction would undo itself.
      await tx.execute(
        dsql`update group_members set archived_at = now() where id = ${memberRow.id}`,
      );
      await tx.execute(dsql`reset role`);
      await enter(tx, memberUser);
      let restoreRows = -1;
      const restoreRefusal = await refusalOf(async (sp) => {
        const rows = await sp.execute<{ id: string }>(
          dsql`update group_members set archived_at = null
            where id = ${memberRow.id} returning id`,
        );
        restoreRows = rows.length;
      });
      await tx.execute(dsql`reset role`);
      const [selfNow] = await tx.execute<{ archived_at: string | null }>(
        dsql`select archived_at::text from group_members where id = ${memberRow.id}`,
      );
      assert(
        labels[5],
        (restoreRows === 0 || restoreRefusal.includes("42501")) && selfNow.archived_at !== null,
        `rows = ${restoreRows === -1 ? "none issued" : restoreRows}, ${restoreRefusal}, own archived_at = ${selfNow?.archived_at ?? "null"}`,
      );

      // Nothing this section wrote may survive; force the ROLLBACK.
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [{ current_user: afterUser }] = await sql<{ current_user: string }[]>`select current_user`;
  const [{ count: probeCount }] = await sql<{ count: string }[]>`
    select count(*)::text as count from groups where name like 'rls member mgmt%'`;
  assert(
    tailLabel,
    afterUser === "postgres" && probeCount === "0",
    `current_user = ${afterUser}, rows named 'rls member mgmt%' = ${probeCount}`,
  );
}

// Wrapped in an async IIFE (not top-level await) so the runner can transpile
// this to CJS and run it on any Node version, not only Node 22's native strip.
void (async () => {
  try {
    await main();
  } catch (error) {
    console.error("FAIL  the check aborted —", error);
    failed = true;
  } finally {
    await sql.end();
  }

  process.exit(failed ? 1 : 0);
})();
