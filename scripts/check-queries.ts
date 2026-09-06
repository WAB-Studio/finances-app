/**
 * Layer 1 of the harness: the app's OWN query functions, driven against the
 * remote database with RLS on. `scripts/check-rls.ts` builds every fixture with
 * raw SQL and proves the policies without ever executing the code a screen runs;
 * this executes exactly that code and asserts on what comes back.
 *
 * No transaction wraps a suite. `withUserDb` opens and commits its own, and
 * running the production control flow rather than a replica of it is the point.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { z } from "zod";

// FIRST, and it has to stay first: it plants the counted pool `@/db/client` picks
// up, and a client already built is a client that cannot be instrumented.
import { roundTrips } from "./harness/instrument";

import {
  createInstallmentPlanAction,
  recordDebtPaymentAction,
} from "@/app/actions/installment-plans";
import { getAccountBalances } from "@/db/queries/account-balances";
import { getShellSummary } from "@/db/queries/app-shell";
import {
  archiveAccount,
  createAccount,
  listAccounts,
  restoreAccount,
  updateAccount,
} from "@/db/queries/accounts";
import { getAuditFilterOptions, listAuditLog } from "@/db/queries/audit-log";
import {
  archiveBudget,
  createBudget,
  listBudgetsWithStatus,
  updateBudget,
} from "@/db/queries/budgets";
import { resolveWithdrawalTarget, withdrawCash } from "@/db/queries/cash";
import {
  createCategory,
  listCategories,
  listParentCategories,
  listUsedCategoryColors,
  updateCategory,
} from "@/db/queries/categories";
import { createGroup } from "@/db/queries/create-group";
import { getDebtDetail } from "@/db/queries/debt-detail";
import { getDebtOverview } from "@/db/queries/debt-overview";
import { listStatements } from "@/db/queries/debt-statements";
import { getDebtTerms, upsertDebtTerms } from "@/db/queries/debt-terms";
import { getDebtsScreenData } from "@/db/queries/debts-screen";
import type { DebtsScreenData } from "@/db/queries/debts-screen";
import { readExport } from "@/db/queries/export";
import {
  claimInviteForUser,
  createMember,
  listMembers,
} from "@/db/queries/group-members";
import { getUserGroup, updateGroupSettings } from "@/db/queries/groups";
import { readImportScope } from "@/db/queries/import-preview";
import {
  countPendingDeliveries,
  listOwnMerchants,
  listPendingDeliveries,
  listSilencedShapes,
  restoreShape,
} from "@/db/queries/ingest-review";
import {
  createInstallmentPlan,
  listPlanPositions,
  listPlansForAccount,
  recordDebtPayment,
} from "@/db/queries/installment-plans";
import {
  createLabel,
  listLabels,
  listManagedLabels,
  listUsedLabelColors,
  updateLabel,
} from "@/db/queries/labels";
import { seedPersonalCategories } from "@/db/queries/personal-space";
import {
  createPlannedPayment,
  listPlannedPayments,
  settlePlannedPayment,
} from "@/db/queries/planned-payments";
import {
  countUnreviewedGenerated,
  createRecurringRule,
  listRecurringRules,
} from "@/db/queries/recurring-rules";
import { getMemberContributions } from "@/db/queries/reports/contributions";
import { getDashboardData } from "@/db/queries/reports/dashboard";
import { getExpensesByCategory } from "@/db/queries/reports/expenses-by-category";
import { getMonthlyFlow, getSixMonthFlow } from "@/db/queries/reports/monthly-flow";
import { netWorthByOwner } from "@/db/queries/reports/net-worth";
import { getReportsData } from "@/db/queries/reports/reports-screen";
import {
  addGoalContribution,
  archiveGoal,
  createGoal,
  listGoalsWithProgress,
} from "@/db/queries/savings-goals";
import {
  getLastUsedAccountId,
  getTransactionFormOptions,
} from "@/db/queries/transaction-form";
import {
  createTransaction,
  deleteTransaction,
  getTransactionById,
  listTransactions,
  updateTransaction,
} from "@/db/queries/transactions";
import { getUserLocale, upsertUserLocale } from "@/db/queries/user-locale";
import {
  getWebhookCredentialOptions,
  issueWebhookCredential,
  listWebhookCredentials,
} from "@/db/queries/webhook-credentials";
import { withUserDb } from "@/db/session";
import { BASE_CURRENCY } from "@/lib/currency";
import {
  addCivilMonths,
  currentMonthRange,
  priorCutOffDates,
  todayInBogota,
} from "@/lib/dates";
import { pgErrorCode } from "@/lib/db-error";
import { SEED_CATEGORIES } from "@/lib/fund/seed";
import {
  accountRowSchema,
  categoryRowSchema,
  memberRowSchema,
  recurringRuleRowSchema,
  SHEET_ENTITIES,
  transactionRowSchema,
} from "@/lib/spreadsheet/schema";
import { createTransactionSchema } from "@/lib/validation/transaction";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

import { assert, report, skip } from "./harness/assert";
import type { FixtureTable, HarnessScope, HarnessUser } from "./harness/fixtures";
import {
  asUser,
  cleanup,
  countOwnedMovements,
  createHarnessUser,
  createMembershipFreeUser,
  findUserByEmail,
  fixtureSql,
  seedHarnessScope,
  track,
  YEAR_OF_MOVEMENTS,
} from "./harness/fixtures";
import { HARNESS_EMAIL } from "./harness/session";

// The user the decisions note as already seeded. Read once for the transcript,
// never written, and no assertion depends on it.
const SEEDED_USER_ID = "30e3acba-7122-404e-b961-c65a98bf1e37";

let counter = 0;

function next(name: string): string {
  counter += 1;
  return `Q${counter}. ${name}`;
}

// The entity/record pairs this run wrote THROUGH the app's own functions, which
// the audit invariant then reads back. Fixture rows are not in here.
const written: { entity: FixtureTable; recordId: string }[] = [];

function keep(entity: FixtureTable, recordId: string): void {
  track(entity, recordId);
  written.push({ entity, recordId });
}

function summarise(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} rows`;
  if (value === null || value === undefined) return String(value);
  if (typeof value === "object") return `keys: ${Object.keys(value).join(", ")}`;
  return String(value);
}

// The driver's message hangs off the cause chain, like its sqlstate: the thrown
// DrizzleQueryError only says which query failed, never why.
function rootMessage(error: unknown): string {
  let current: unknown = error;
  let message = String(error);

  for (let hop = 0; hop < 5; hop++) {
    if (typeof current !== "object" || current === null) break;
    if ("message" in current && typeof current.message === "string") {
      message = current.message;
    }
    current = "cause" in current ? current.cause : undefined;
  }

  return message.split("\n")[0];
}

function refusal(error: unknown): string {
  return `sqlstate ${pgErrorCode(error) ?? "none"} — ${rootMessage(error)}`;
}

async function checkRead(name: string, run: () => Promise<unknown>): Promise<void> {
  const label = next(name);
  try {
    assert(label, true, summarise(await run()));
  } catch (error) {
    assert(label, false, refusal(error));
  }
}

type Outcome = { ok: boolean; detail: string };

/**
 * A write path and the two things worth knowing about it: what it returned, and
 * what the row reads back as. A refusal reports its sqlstate AND its message —
 * a bare code names the wrong defect as often as the right one.
 */
async function checkWrite<T>(
  name: string,
  run: () => Promise<T>,
  outcome: (value: T) => Promise<Outcome> | Outcome,
): Promise<T | null> {
  const label = next(name);
  try {
    const value = await run();
    const { ok, detail } = await outcome(value);
    assert(label, ok, detail);
    return value;
  } catch (error) {
    assert(label, false, refusal(error));
    return null;
  }
}

// The same drive-and-assert as `checkWrite`, under the name a read belongs under:
// `checkRead` above asserts the literal `true`, so it passes on `[]` and on another
// user's rows alike. A read that has something to say about its rows uses this.
const checkReadValue = checkWrite;

// Reads back as the owner, outside RLS: the assertion is about what was STORED,
// not about what a policy would show.
async function readColumn<T>(
  table: string,
  idColumn: string,
  id: string,
  column: string,
): Promise<T | undefined> {
  const [row] = await fixtureSql<{ value: T }[]>`
    select ${fixtureSql(column)} as value
    from ${fixtureSql(table)}
    where ${fixtureSql(idColumn)} = ${id}`;

  return row?.value;
}

type SilencedFixture = {
  shapeId: string;
  sampleText: string;
  silencedIds: string[];
  humanRejectedId: string;
};

/**
 * One silenced shape as RF-92 leaves it: a delivery a person rejected by hand before
 * the memory existed, then the memory, then two deliveries that memory discarded on
 * arrival. Nothing here names `status` or `silenced_on_arrival` — the trigger settles
 * both, so the fixture is what the database decides rather than what the harness wants.
 */
async function seedSilencedShape(
  userId: string,
  tag: string,
): Promise<SilencedFixture> {
  const shapeHash = createHash("sha256").update(randomUUID()).digest("hex");
  const sampleText = `Harness mensaje silenciado ${tag}`;
  const ref = (suffix: string) => `harness-${tag}-${suffix}-${shapeHash.slice(0, 12)}`;
  const claims = JSON.stringify({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
  });

  return fixtureSql.begin<SilencedFixture>(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;

    // Inserted while no memory exists, so it arrives pending and the rejection below is
    // a person's — the one row a restore must never touch.
    const [human] = await tx<{ id: string }[]>`
      insert into ingest_deliveries (external_ref, raw_text, shape_hash)
      values (${ref("human")}, ${sampleText}, ${shapeHash}) returning id`;
    await tx`
      update ingest_deliveries set status = 'rejected', resolved_at = now()
      where id = ${human.id} and status = 'pending'`;

    const [shape] = await tx<{ id: string }[]>`
      insert into ingest_shapes (shape_hash, decision, sample_text)
      values (${shapeHash}, 'rejected', ${sampleText}) returning id`;

    const silenced = await tx<{ id: string }[]>`
      insert into ingest_deliveries (external_ref, raw_text, shape_hash)
      values (${ref("silenced-a")}, ${sampleText}, ${shapeHash}),
             (${ref("silenced-b")}, ${sampleText}, ${shapeHash})
      returning id`;

    return {
      shapeId: shape.id,
      sampleText,
      silencedIds: silenced.map((row) => row.id),
      humanRejectedId: human.id,
    };
  });
}

type SilencedFixtures = {
  // Restored by the write suite; the read suite then proves it is gone.
  restored: SilencedFixture;
  // Left silenced, so the read has rows of its own to be asserted on.
  listed: SilencedFixture;
};

// A pending invitation, written as the owner but under the leader's claims, the
// way `seedHarnessScope` writes its rows: the stamping triggers read auth.uid()
// while the owner's privileges do the insert.
async function seedPendingInvite({
  groupId,
  memberId,
  actorId,
  name,
  email,
  archived,
}: {
  groupId: string;
  memberId: string;
  actorId: string;
  name: string;
  email: string;
  archived: boolean;
}): Promise<void> {
  const claims = JSON.stringify({
    sub: actorId,
    role: "authenticated",
    aud: "authenticated",
  });

  await fixtureSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx`
      insert into group_members (id, group_id, name, role, invite_email, archived_at)
      values (${memberId}, ${groupId}, ${name}, 'member', ${email},
        ${archived ? tx`now()` : null})`;
  });

  track("group_members", memberId);
}

/**
 * A second identity inside the leader's group: a plain member, who reads the
 * leader's personal accounts (RF-58) and can write none of them, since
 * `can_write_account` admits only their owner or a shared group account. It is
 * what `canWrite` has to be driven against — a fabricated boolean would prove
 * nothing about the policy the screens are asking after.
 */
async function seedFellowMember(
  actorId: string,
  groupId: string,
): Promise<HarnessUser> {
  const user = await createMembershipFreeUser();
  const memberId = randomUUID();
  const claims = JSON.stringify({
    sub: actorId,
    role: "authenticated",
    aud: "authenticated",
  });

  await fixtureSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx`
      insert into group_members (id, group_id, user_id, name, role)
      values (${memberId}, ${groupId}, ${user.id}, 'Harness miembra', 'member')`;
  });

  track("group_members", memberId);

  return user;
}

type MemberSnapshot = {
  id: string;
  user_id: string | null;
  invite_email: string | null;
  name: string;
  archived_at: string | null;
};

// Every row of a group, archived ones included: the UPDATE this replaced carried
// no WHERE, so the whole group is the blast radius a claim has to leave alone.
async function readGroupMembers(groupId: string): Promise<MemberSnapshot[]> {
  return fixtureSql<MemberSnapshot[]>`
    select id, user_id, invite_email, name, archived_at::text as archived_at
    from group_members where group_id = ${groupId} order by id`;
}

// The limit the write suite's card is given, and the only limit in the run: the
// consolidated credit totals are asserted against it.
const CREDIT_LIMIT_CENTS = 500000000;

// The write suite's own plan: three lines of this, one closed by its payment.
const CARD_LINE_CENTS = 40000000;

// Three equal lines, so a payment of two of them plus a few cents leaves a
// remainder no line can take.
const PLAN_LINE_CENTS = 100000;
const PLAN_REMAINDER_CENTS = 5000;

// The day of the month the fixture debt cuts its statements on.
const CUT_OFF_DAY = 15;

type DebtFixture = {
  // A liability whose terms name NO credit limit, opened six months back so its
  // past statement periods are there to be cut.
  unlimitedAccountId: string;
  unlimitedName: string;
  openedOn: string;
  // A plan on the scope's terms-less liability, its three lines a month apart.
  planId: string;
  dueDates: string[];
};

/**
 * The two debts the installment, credit and statement checks read, beside the card
 * the write suite creates: a liability that carries terms without a limit (RF-117)
 * and a plan on a liability that carries no terms at all (RF-81, RF-82). Written as
 * the owner under the caller's claims, the way `seedHarnessScope` writes: the
 * stamping triggers see `auth.uid()` while the owner's privileges do the insert.
 */
async function seedDebtFixture(
  userId: string,
  scope: HarnessScope,
): Promise<DebtFixture> {
  const today = todayInBogota();
  const fixture: DebtFixture = {
    unlimitedAccountId: randomUUID(),
    unlimitedName: "Harness credit line",
    openedOn: addCivilMonths(today, -6),
    planId: randomUUID(),
    dueDates: [today, addCivilMonths(today, 1), addCivilMonths(today, 2)],
  };
  const claims = JSON.stringify({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
  });

  await fixtureSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;

    await tx`
      insert into accounts
        (id, owner_user_id, name, kind, subtype, initial_balance_cents, initial_balance_on)
      values
        (${fixture.unlimitedAccountId}, ${userId}, ${fixture.unlimitedName},
         'liability', 'tarjeta', -1200000, ${fixture.openedOn})`;

    // No credit limit and no minimum percentage: the limit is what the credit
    // totals must skip, and the cut-off day is what gives the history periods.
    await tx`
      insert into debt_terms
        (account_id, debt_kind, annual_rate, minimum_payment_cents,
         credit_limit_cents, statement_cut_off_day, payment_due_day)
      values
        (${fixture.unlimitedAccountId}, 'revolving', 0.2400, 30000,
         null, ${CUT_OFF_DAY}, 4)`;

    await tx`
      insert into installment_plans
        (id, account_id, description, principal_cents, n_installments, frequency, start_date)
      values
        (${fixture.planId}, ${scope.liabilityAccountId}, 'Harness plan without terms',
         ${PLAN_LINE_CENTS * 3}, 3, 'monthly', ${today})`;

    await tx`
      insert into installment_lines (plan_id, seq, due_date, amount_cents) values
        (${fixture.planId}, 1, ${fixture.dueDates[0]}, ${PLAN_LINE_CENTS}),
        (${fixture.planId}, 2, ${fixture.dueDates[1]}, ${PLAN_LINE_CENTS}),
        (${fixture.planId}, 3, ${fixture.dueDates[2]}, ${PLAN_LINE_CENTS})`;
  });

  track("accounts", fixture.unlimitedAccountId);
  track("debt_terms", fixture.unlimitedAccountId);
  // The lines go with the plan: the foreign key cascades.
  track("installment_plans", fixture.planId);

  return fixture;
}

// Which of a plan's lines a movement closed, read as the owner and in due order:
// the allocation is oldest-first, so WHICH lines were taken is the assertion, not
// how many.
async function readPaidLines(planId: string): Promise<string> {
  const rows = await fixtureSql<{ seq: number; paid: boolean }[]>`
    select seq, paid_transaction_id is not null as paid
    from installment_lines where plan_id = ${planId} order by due_date, seq`;

  return rows.map((row) => `${row.seq}:${row.paid}`).join(", ");
}

type WriteResults = {
  accountId: string | null;
  transactionId: string | null;
  withdrawalId: string | null;
};

/**
 * Suite Q-write: every write path, with a realistic argument set, asserted on
 * its return value and on the row read back. It runs first because Q1 is the
 * failing-before assertion and the account it creates is what the suites below
 * read; a dependent falls back to a seeded row only when its parent was refused.
 */
async function writeSuite(
  userId: string,
  scope: HarnessScope,
  groupless: HarnessUser,
  silenced: SilencedFixture,
  debt: DebtFixture,
): Promise<WriteResults> {
  const today = todayInBogota();
  const personal = { ownerUserId: userId } as const;

  const account = await checkWrite(
    "createAccount",
    () =>
      createAccount({
        name: "Harness tarjeta",
        kind: "liability",
        subtype: "tarjeta",
        ownerUserId: userId,
        groupId: null,
        isShared: false,
        institution: "Bancolombia",
        lastFour: "4321",
        settlementCurrency: BASE_CURRENCY,
        amountMinor: 1500,
        balanceOn: today,
      }),
    ({ accountId }) => {
      keep("accounts", accountId);
      return { ok: true, detail: `account ${accountId}` };
    },
  );

  // The seeded card stands in when the create was refused, so the edit paths are
  // still measured against a row the caller really owns.
  const accountId = account?.accountId ?? scope.liabilityAccountId;

  await checkWrite(
    "updateAccount",
    () =>
      updateAccount({
        accountId,
        name: "Harness tarjeta editada",
        subtype: "tarjeta",
        isShared: false,
        institution: "Davivienda",
        lastFour: "9876",
        settlementCurrency: BASE_CURRENCY,
        amountMinor: 1800,
        balanceOn: today,
      }),
    async (updated) => ({
      ok: updated,
      detail: `updated = ${updated}, name = ${await readColumn("accounts", "id", accountId, "name")}`,
    }),
  );

  await checkWrite(
    "archiveAccount",
    () => archiveAccount({ accountId }),
    async (archived) => ({
      ok: archived,
      detail: `archived = ${archived}, archived_at = ${await readColumn("accounts", "id", accountId, "archived_at")}`,
    }),
  );

  await checkWrite(
    "restoreAccount",
    () => restoreAccount({ accountId }),
    async (restored) => ({
      ok: restored,
      detail: `restored = ${restored}, archived_at = ${await readColumn("accounts", "id", accountId, "archived_at")}`,
    }),
  );

  const category = await checkWrite(
    "createCategory",
    () =>
      createCategory({
        scope: personal,
        name: "Harness transporte",
        kind: "expense",
        parentId: null,
        color: "#B4542F",
      }),
    ({ categoryId }) => {
      keep("categories", categoryId);
      return { ok: true, detail: `category ${categoryId}` };
    },
  );

  const categoryId = category?.categoryId ?? scope.categoryId;

  await checkWrite(
    "updateCategory",
    () =>
      updateCategory({
        categoryId,
        name: "Harness transporte editada",
        parentId: null,
        color: "#2F6FB4",
      }),
    async (updated) => ({
      ok: updated,
      detail: `updated = ${updated}, name = ${await readColumn("categories", "id", categoryId, "name")}`,
    }),
  );

  // Driven by the membership-free user, never the run's own: `seedHarnessScope`
  // already made that one a leader, and RF-55 holds a user to one live
  // membership — the refusal that follows is asserted in `invariantSuite`.
  await checkWrite(
    "createGroup",
    () =>
      asUser(groupless, () =>
        createGroup({
          name: "Harness fondo nuevo",
          leaderName: "Harness leader",
          cashMode: "shared",
          locale: "es",
        }),
      ),
    async ({ groupId }) => {
      track("groups", groupId);

      // Four rows in one round trip, read as the owner: the group, the leader
      // the caller became, the cash account `cash_mode = 'shared'` seeds and the
      // categories a new fund files against. Not `keep`: the audit invariant
      // reads the trail of the run's own user, and none of this is written by it.
      const [written] = await fixtureSql<
        {
          group_name: string | null;
          member_id: string | null;
          account_id: string | null;
          category_ids: string[] | null;
        }[]
      >`
        select
          (select name from groups where id = ${groupId}) as group_name,
          (select id from group_members
             where group_id = ${groupId} and user_id = ${groupless.id}
               and role = 'leader') as member_id,
          (select id from accounts
             where group_id = ${groupId} and subtype = 'efectivo') as account_id,
          (select array_agg(id) from categories where group_id = ${groupId})
            as category_ids`;

      const categoryIds = written.category_ids ?? [];
      if (written.member_id !== null) track("group_members", written.member_id);
      if (written.account_id !== null) track("accounts", written.account_id);
      for (const categoryId of categoryIds) track("categories", categoryId);

      const expectedCategories = SEED_CATEGORIES.reduce(
        (total, category) => total + 1 + (category.children?.length ?? 0),
        0,
      );

      return {
        ok:
          written.group_name === "Harness fondo nuevo" &&
          written.member_id !== null &&
          written.account_id !== null &&
          categoryIds.length === expectedCategories,
        detail: `group ${groupId} named ${written.group_name}, leader member ${written.member_id}, cash account ${written.account_id}, ${categoryIds.length} of ${expectedCategories} categories`,
      };
    },
  );

  // The other half of what `createGroup` writes, for the personal-only user RF-55 allows:
  // the confirm route calls this inside its own `withUserDb`, so the proof opens one too.
  const seeded = await createMembershipFreeUser();

  await checkWrite(
    "seedPersonalCategories",
    () =>
      asUser(seeded, () =>
        withUserDb((tx) => seedPersonalCategories(tx, { userId: seeded.id, locale: "es" })),
      ),
    async (written) => {
      const rows = await fixtureSql<
        { id: string; owner_user_id: string | null; group_id: string | null }[]
      >`
        select id, owner_user_id, group_id from categories
        where owner_user_id = ${seeded.id}`;
      for (const row of rows) track("categories", row.id);

      const expected = SEED_CATEGORIES.reduce(
        (total, category) => total + 1 + (category.children?.length ?? 0),
        0,
      );
      const personal = rows.every(
        (row) => row.owner_user_id === seeded.id && row.group_id === null,
      );

      return {
        ok: written === expected && rows.length === expected && personal,
        detail: `reported ${written} rows, ${rows.length} of ${expected} landed, every one owned by the user and in no group = ${personal}`,
      };
    },
  );

  await checkWrite(
    "createMember",
    () =>
      createMember({
        groupId: scope.groupId,
        name: "Harness invitada",
        inviteEmail: `harness-${randomUUID()}@example.invalid`,
      }),
    ({ memberId }) => {
      keep("group_members", memberId);
      return { ok: true, detail: `member ${memberId}` };
    },
  );

  // RF-06 from the three sides that decide it, driven by three sessions rather
  // than three arguments: the claim reads the caller's own identity, so who runs
  // it IS the input. The middle call is why this assertion exists — the UPDATE it
  // replaced carried no WHERE, and for a caller already in the group it stamped
  // her user_id onto every row of it and then reported "claimed".
  const invitee = await createMembershipFreeUser();
  const leaderEmail = process.env.HARNESS_USER_EMAIL ?? "";

  await checkWrite(
    "claimInviteForUser",
    async () => {
      const invitedId = randomUUID();
      const archivedId = randomUUID();
      const leaderInviteId = randomUUID();

      await seedPendingInvite({
        groupId: scope.groupId,
        memberId: invitedId,
        actorId: userId,
        name: "Harness invitada con login",
        email: invitee.email,
        archived: false,
      });
      // Archived and invited: the row the proved escalation wrote onto.
      await seedPendingInvite({
        groupId: scope.groupId,
        memberId: archivedId,
        actorId: userId,
        name: "Harness invitada archivada",
        email: `harness-${randomUUID()}@example.invalid`,
        archived: true,
      });

      const claimed = await asUser(invitee, () =>
        claimInviteForUser({ email: invitee.email }),
      );
      const [claimedRow] = await fixtureSql<
        { user_id: string | null; invite_email: string | null }[]
      >`select user_id, invite_email from group_members where id = ${invitedId}`;

      // The leader is in the group and holds no invitation: nothing may move.
      const before = await readGroupMembers(scope.groupId);
      const none = await claimInviteForUser({ email: leaderEmail });
      const after = await readGroupMembers(scope.groupId);

      // Now she does hold one, and her live leader row already carries her
      // user_id, so `group_members_user_unique` refuses the claim (RF-55).
      await seedPendingInvite({
        groupId: scope.groupId,
        memberId: leaderInviteId,
        actorId: userId,
        name: "Harness lider invitada",
        email: leaderEmail,
        archived: false,
      });
      const already = await claimInviteForUser({ email: leaderEmail });

      return {
        claimed,
        claimedRow,
        before,
        untouched: JSON.stringify(before) === JSON.stringify(after),
        none,
        already,
      };
    },
    (result) => ({
      ok:
        result.claimed === "claimed" &&
        result.claimedRow.user_id === invitee.id &&
        result.claimedRow.invite_email === null &&
        result.none === "none" &&
        result.untouched &&
        result.already === "already-in-group",
      detail: `invited caller = ${result.claimed}, her row carries her user_id = ${
        result.claimedRow.user_id === invitee.id
      } and invite_email = ${result.claimedRow.invite_email}; uninvited member = ${
        result.none
      }, ${result.before.length} group rows unchanged = ${
        result.untouched
      }; member holding a live membership = ${result.already}`,
    }),
  );

  const label = await checkWrite(
    "createLabel",
    () => createLabel({ scope: personal, name: "Harness viaje", color: "#7A4CB4" }),
    ({ labelId }) => {
      keep("labels", labelId);
      return { ok: true, detail: `label ${labelId}` };
    },
  );

  const labelId = label?.labelId ?? scope.labelId;

  await checkWrite(
    "updateLabel",
    () => updateLabel({ labelId, name: "Harness viaje editada", color: "#B44C7A" }),
    async (updated) => ({
      ok: updated,
      detail: `updated = ${updated}, name = ${await readColumn("labels", "id", labelId, "name")}`,
    }),
  );

  const budget = await checkWrite(
    "createBudget",
    () =>
      createBudget({
        ownerUserId: userId,
        groupId: null,
        categoryId: scope.categoryId,
        accountId: null,
        labelId: null,
        period: "monthly",
        limitCents: 40000000,
        thresholdPct: 80,
        name: "Harness mercado",
      }),
    ({ budgetId }) => {
      keep("budgets", budgetId);
      return { ok: true, detail: `budget ${budgetId}` };
    },
  );

  const budgetId = budget?.budgetId ?? randomUUID();

  await checkWrite(
    "updateBudget",
    () =>
      updateBudget({
        budgetId,
        accountId: null,
        labelId: null,
        period: "weekly",
        limitCents: 20000000,
        thresholdPct: 90,
        name: "Harness mercado semanal",
      }),
    async (updated) => ({
      ok: updated,
      detail:
        budget === null
          ? "updated = false — createBudget was refused, so this run has no budget to edit"
          : `updated = ${updated}, period = ${await readColumn("budgets", "id", budgetId, "period")}`,
    }),
  );

  // RF-120 from the read that has to honour it: the two calls partition the caller's
  // readable budgets, and an archived one derives its spent the same way a live one does.
  await checkWrite(
    "listBudgetsWithStatus partitions the archived from the live",
    async () => {
      const { budgetId: archivedId } = await createBudget({
        ownerUserId: userId,
        groupId: null,
        categoryId: scope.categoryId,
        accountId: null,
        labelId: null,
        period: "monthly",
        limitCents: 30000000,
        thresholdPct: 70,
        name: "Harness mercado archivado",
      });
      keep("budgets", archivedId);
      await archiveBudget({ budgetId: archivedId });

      const [live, archived] = await Promise.all([
        listBudgetsWithStatus(),
        listBudgetsWithStatus(undefined, { archived: true }),
      ]);

      return { archivedId, live, archived };
    },
    ({ archivedId, live, archived }) => {
      const liveIds = live.map((budget) => budget.id);
      const archivedIds = archived.map((budget) => budget.id);
      const overlap = liveIds.filter((id) => archivedIds.includes(id));

      return {
        ok:
          overlap.length === 0 &&
          archivedIds.includes(archivedId) &&
          liveIds.includes(budgetId),
        detail: `${liveIds.length} live and ${archivedIds.length} archived, ${overlap.length} named by both; the archived one is on the archived side = ${archivedIds.includes(archivedId)}, the edited one on the live side = ${liveIds.includes(budgetId)}`,
      };
    },
  );

  const goal = await checkWrite(
    "createGoal",
    () =>
      createGoal({
        ownerUserId: userId,
        groupId: null,
        name: "Harness viaje",
        targetAmountCents: 200000000,
        targetDate: null,
        accountId: null,
        initialContributionCents: 5000000,
      }),
    ({ goalId }) => {
      keep("savings_goals", goalId);
      return { ok: true, detail: `goal ${goalId}` };
    },
  );

  const goalId = goal?.goalId ?? randomUUID();

  await checkWrite(
    "addGoalContribution",
    () => addGoalContribution({ goalId, amountCents: 1500000 }),
    async ({ contributionId }) => {
      keep("goal_contributions", contributionId);
      return {
        ok: true,
        detail: `contribution ${contributionId}, amount_cents = ${await readColumn("goal_contributions", "id", contributionId, "amount_cents")}`,
      };
    },
  );

  // The same partition on the goals, plus the identity RF-120 rests on: archiving writes no
  // aporte, so an archived goal's progress is still the sum of the rows it always had.
  await checkWrite(
    "listGoalsWithProgress partitions the archived from the live",
    async () => {
      const { goalId: archivedId } = await createGoal({
        ownerUserId: userId,
        groupId: null,
        name: "Harness viaje archivado",
        targetAmountCents: 100000000,
        targetDate: null,
        accountId: null,
        initialContributionCents: 2500000,
      });
      keep("savings_goals", archivedId);
      await archiveGoal({ goalId: archivedId });

      const [live, archived] = await Promise.all([
        listGoalsWithProgress(),
        listGoalsWithProgress({ archived: true }),
      ]);
      // Read as the owner: the sum the progress must equal, taken from the rows themselves.
      const [{ sum }] = await fixtureSql<{ sum: string }[]>`
        select coalesce(sum(amount_cents), 0)::text as sum
        from goal_contributions where goal_id = ${archivedId}`;

      return { archivedId, live, archived, contributed: Number(sum) };
    },
    ({ archivedId, live, archived, contributed }) => {
      const liveIds = live.map((goal) => goal.id);
      const archivedIds = archived.map((goal) => goal.id);
      const overlap = liveIds.filter((id) => archivedIds.includes(id));
      const savedCents = archived.find((goal) => goal.id === archivedId)?.savedCents;

      return {
        ok:
          overlap.length === 0 &&
          archivedIds.includes(archivedId) &&
          liveIds.includes(goalId) &&
          savedCents === contributed,
        detail: `${liveIds.length} live and ${archivedIds.length} archived, ${overlap.length} named by both; the archived one reads ${savedCents} cents against ${contributed} summed from its aportes, the live one is on the live side = ${liveIds.includes(goalId)}`,
      };
    },
  );

  const planned = await checkWrite(
    "createPlannedPayment",
    () =>
      createPlannedPayment({
        fromAccountId: scope.assetAccountId,
        toAccountId: null,
        amountCents: 9000000,
        categoryId: scope.categoryId,
        dueDate: today,
        remindOn: null,
        description: "Harness arriendo",
      }),
    ({ plannedPaymentId }) => {
      keep("planned_payments", plannedPaymentId);
      return { ok: true, detail: `planned payment ${plannedPaymentId}` };
    },
  );

  const plannedPaymentId = planned?.plannedPaymentId ?? randomUUID();

  await checkWrite(
    "settlePlannedPayment",
    () =>
      settlePlannedPayment({
        plannedPaymentId,
        fromAccountId: scope.assetAccountId,
        toAccountId: null,
        amountCents: 9000000,
        categoryId: scope.categoryId,
        occurredAt: today,
        description: "Harness arriendo",
      }),
    async (result) => {
      if (result.settled) keep("transactions", result.transactionId);
      return {
        ok: result.settled,
        detail: result.settled
          ? `movement ${result.transactionId}, status = ${await readColumn("planned_payments", "id", plannedPaymentId, "status")}`
          : "settled = false, the payment was not pending",
      };
    },
  );

  await checkWrite(
    "createRecurringRule",
    () =>
      createRecurringRule({
        fromAccountId: scope.assetAccountId,
        toAccountId: null,
        amountCents: 3500000,
        categoryId: scope.categoryId,
        description: "Harness suscripción",
        frequency: "monthly",
        intervalN: 1,
        dayOfMonth: 5,
        nextRunOn: today,
        endsOn: null,
      }),
    async ({ recurringRuleId }) => {
      keep("recurring_rules", recurringRuleId);
      return {
        ok: true,
        detail: `rule ${recurringRuleId}, next_run_on = ${await readColumn("recurring_rules", "id", recurringRuleId, "next_run_on")}`,
      };
    },
  );

  await checkWrite(
    "upsertDebtTerms",
    () =>
      upsertDebtTerms({
        accountId,
        debtKind: "revolving",
        annualRate: "0.2800",
        minimumPaymentCents: 5000000,
        minimumPaymentPct: null,
        creditLimitCents: CREDIT_LIMIT_CENTS,
        statementCutOffDay: 15,
        paymentDueDay: 5,
        avalCents: null,
      }),
    async (terms) => {
      keep("debt_terms", terms.accountId);
      return {
        ok: terms.accountId === accountId,
        detail: `terms on ${terms.accountId}, annual_rate = ${await readColumn("debt_terms", "account_id", accountId, "annual_rate")}`,
      };
    },
  );

  await checkWrite(
    "createInstallmentPlan",
    () =>
      createInstallmentPlan({
        accountId,
        description: "Harness nevera",
        principalCents: CARD_LINE_CENTS * 3,
        nInstallments: 3,
        frequency: "monthly",
        interestRate: "0.0200",
        downPaymentCents: null,
        avalCents: null,
        startDate: today,
        merchant: "Harness store",
        lines: [
          { seq: 1, dueDate: today, amountCents: CARD_LINE_CENTS },
          { seq: 2, dueDate: today, amountCents: CARD_LINE_CENTS },
          { seq: 3, dueDate: today, amountCents: CARD_LINE_CENTS },
        ],
      }),
    async ({ planId }) => {
      keep("installment_plans", planId);
      return {
        ok: true,
        detail: `plan ${planId}, n_installments = ${await readColumn("installment_plans", "id", planId, "n_installments")}`,
      };
    },
  );

  await checkWrite(
    "recordDebtPayment",
    () =>
      recordDebtPayment({
        fromAccountId: scope.assetAccountId,
        toAccountId: accountId,
        amountCents: CARD_LINE_CENTS,
        occurredAt: today,
      }),
    async ({ transactionId, paidLineIds }) => {
      keep("transactions", transactionId);
      return {
        ok: true,
        detail: `movement ${transactionId}, lines paid = ${paidLineIds.length}, kind = ${await readColumn("transactions", "id", transactionId, "kind")}`,
      };
    },
  );

  // RF-82 end to end through the app's own allocator: two lines closed oldest
  // first, the third left standing because the payment does not cover it whole,
  // and the cents over the two returned unallocated.
  await checkWrite(
    "recordDebtPayment closes the oldest lines and hands back the remainder",
    () =>
      recordDebtPayment({
        fromAccountId: scope.assetAccountId,
        toAccountId: scope.liabilityAccountId,
        amountCents: PLAN_LINE_CENTS * 2 + PLAN_REMAINDER_CENTS,
        occurredAt: today,
      }),
    async ({ transactionId, paidLineIds, remainderCents }) => {
      keep("transactions", transactionId);
      const paid = await readPaidLines(debt.planId);

      return {
        ok:
          paidLineIds.length === 2 &&
          remainderCents === PLAN_REMAINDER_CENTS &&
          paid === "1:true, 2:true, 3:false",
        detail: `${paidLineIds.length} lines closed, remainder ${remainderCents} cents of the ${PLAN_LINE_CENTS * 2 + PLAN_REMAINDER_CENTS} paid, lines by seq = ${paid}`,
      };
    },
  );

  // RF-16: a debt is paid from an asset. The kinds are read in the statement that
  // reads the lines, one statement ahead of the INSERT, so the refusal costs no
  // movement — and a movement written and rolled back would still burn an id.
  const notFromAsset = next("a payment from a liability writes no movement");
  const movementsBefore = await fixtureSql<{ total: string }[]>`
    select count(*)::text as total from transactions
    where from_account_id = ${scope.liabilityAccountId}`;
  try {
    const { transactionId } = await recordDebtPayment({
      fromAccountId: scope.liabilityAccountId,
      toAccountId: accountId,
      amountCents: PLAN_LINE_CENTS,
      occurredAt: today,
    });
    // Tracked, not left behind: an accepted call is the failure this asserts on.
    track("transactions", transactionId);
    assert(notFromAsset, false, `it was accepted as movement ${transactionId}`);
  } catch (error) {
    const movementsAfter = await fixtureSql<{ total: string }[]>`
      select count(*)::text as total from transactions
      where from_account_id = ${scope.liabilityAccountId}`;
    assert(
      notFromAsset,
      pgErrorCode(error) === "23514" &&
        rootMessage(error).includes("comes from an asset account") &&
        movementsAfter[0].total === movementsBefore[0].total,
      `${refusal(error)}; movements out of the liability ${movementsBefore[0].total} before, ${movementsAfter[0].total} after`,
    );
  }

  // The action's own reading of the refusals, which the dialog shows: all three
  // arrive as 23514, and only the message tells the source's from the rest. The
  // client logs each one as it maps it, so a failed action is loud above.
  await checkReadValue(
    "recordDebtPaymentAction answers a liability source with the source's key",
    () =>
      recordDebtPaymentAction({
        fromAccountId: scope.liabilityAccountId,
        toAccountId: accountId,
        amount: "1000",
        occurredAt: today,
      }),
    (result) => ({
      ok: result?.serverError === "installments.errors.notFromAsset",
      detail: `serverError = ${result?.serverError ?? "none"}`,
    }),
  );

  // Aiming a payment at an account that is no debt is the same mistake as aiming a
  // plan at one, so the two paths answer with the same key.
  await checkReadValue(
    "recordDebtPaymentAction answers a destination that is no debt with the account key",
    () =>
      recordDebtPaymentAction({
        fromAccountId: scope.assetAccountId,
        toAccountId: scope.cashAccountId,
        amount: "1000",
        occurredAt: today,
      }),
    (result) => ({
      ok: result?.serverError === "installments.errors.notLiability",
      detail: `serverError = ${result?.serverError ?? "none"}`,
    }),
  );

  await checkReadValue(
    "createInstallmentPlanAction answers an asset account with that same key",
    () =>
      createInstallmentPlanAction({
        accountId: scope.assetAccountId,
        description: null,
        principal: "1000",
        nInstallments: 3,
        frequency: "monthly",
        interestRate: null,
        downPayment: null,
        aval: null,
        startDate: today,
        merchant: null,
      }),
    async (result) => {
      const [row] = await fixtureSql<{ total: string }[]>`
        select count(*)::text as total from installment_plans
        where account_id = ${scope.assetAccountId}`;

      return {
        ok:
          result?.serverError === "installments.errors.notLiability" &&
          row.total === "0",
        detail: `serverError = ${result?.serverError ?? "none"}, plans on the asset = ${row.total}`,
      };
    },
  );

  // The leftover key, and it is reachable: the shared peso schema bounds only the
  // upper end, so a zero clears Zod and the kinds guard and is refused by
  // `transactions_amount_positive` — one more 23514, and neither kind's message.
  await checkReadValue(
    "recordDebtPaymentAction answers a zero with the payment key, and writes nothing",
    async () => {
      const movements = async () => {
        const [row] = await fixtureSql<{ total: string }[]>`
          select count(*)::text as total from transactions
          where from_account_id = ${scope.assetAccountId}
            and to_account_id = ${accountId}`;

        return row.total;
      };

      const before = await movements();
      const result = await recordDebtPaymentAction({
        fromAccountId: scope.assetAccountId,
        toAccountId: accountId,
        amount: "0",
        occurredAt: today,
      });

      return { result, before, after: await movements() };
    },
    ({ result, before, after }) => ({
      ok:
        result?.serverError === "installments.errors.paymentInvalid" &&
        after === before,
      detail: `serverError = ${result?.serverError ?? "none"}, movements into the debt ${before} before, ${after} after`,
    }),
  );

  await checkWrite(
    "issueWebhookCredential",
    () =>
      issueWebhookCredential({
        name: "Harness shortcut",
        defaultAccountId: scope.assetAccountId,
        defaultCategoryId: scope.categoryId,
      }),
    ({ id, token }) => {
      keep("webhook_credentials", id);
      // The plaintext is never printed: this return is the only moment it exists.
      return { ok: token.startsWith("whk_"), detail: `credential ${id}` };
    },
  );

  const movement = await checkWrite(
    "createTransaction",
    () =>
      createTransaction({
        fromAccountId: scope.assetAccountId,
        toAccountId: null,
        amountCents: 2500000,
        occurredAt: today,
        description: "Harness mercado",
        externalRef: null,
        splits: [{ categoryId: scope.categoryId, amountCents: 2500000 }],
        labelIds: [scope.labelId],
      }),
    async ({ transactionId }) => {
      keep("transactions", transactionId);
      return {
        ok: true,
        detail: `movement ${transactionId}, kind = ${await readColumn("transactions", "id", transactionId, "kind")}`,
      };
    },
  );

  const transactionId = movement?.transactionId ?? randomUUID();

  await checkWrite(
    "updateTransaction",
    () =>
      updateTransaction({
        transactionId,
        fromAccountId: scope.assetAccountId,
        toAccountId: null,
        amountCents: 2700000,
        occurredAt: today,
        description: "Harness mercado corregido",
        splits: [{ categoryId: scope.categoryId, amountCents: 2700000 }],
        labelIds: [],
      }),
    async (updated) => ({
      ok: updated,
      detail: `updated = ${updated}, amount_cents = ${await readColumn("transactions", "id", transactionId, "amount_cents")}`,
    }),
  );

  await checkWrite(
    "deleteTransaction",
    () => deleteTransaction({ transactionId }),
    async (deleted) => ({
      ok: deleted,
      detail: `deleted = ${deleted}, row still there = ${(await readColumn("transactions", "id", transactionId, "id")) !== undefined}`,
    }),
  );

  const withdrawal = await checkWrite(
    "withdrawCash",
    () =>
      withdrawCash({
        sourceAccountId: scope.assetAccountId,
        amountCents: 500000,
        cashAccountName: "Efectivo",
      }),
    async (result) => {
      keep("transactions", result.transactionId);
      if (result.createdCashAccount) keep("accounts", result.targetCashAccountId);
      return {
        ok: true,
        detail: `movement ${result.transactionId}, cash account created = ${result.createdCashAccount}, kind = ${await readColumn("transactions", "id", result.transactionId, "kind")}`,
      };
    },
  );

  // RF-99: the shape memory and the deliveries it discarded move in one statement. The
  // read-back is the whole promise — two silenced deliveries back in the queue with the
  // flag cleared, and the rejection this person made still standing.
  await checkWrite(
    "restoreShape",
    () => restoreShape({ shapeId: silenced.shapeId }),
    async ({ deliveriesRestored }) => {
      const [row] = await fixtureSql<
        { shapes: string; queued: string; human: string | null }[]
      >`
        select
          (select count(*)::text from ingest_shapes
             where id = ${silenced.shapeId}) as shapes,
          (select count(*)::text from ingest_deliveries
             where id in ${fixtureSql(silenced.silencedIds)}
               and status = 'pending' and silenced_on_arrival = false) as queued,
          (select status from ingest_deliveries
             where id = ${silenced.humanRejectedId}) as human`;

      return {
        ok:
          deliveriesRestored === 2 &&
          row.shapes === "0" &&
          row.queued === "2" &&
          row.human === "rejected",
        detail: `restored ${deliveriesRestored} deliveries, ${row.shapes} memories left, ${row.queued} of 2 back in the queue unflagged, the person's own rejection still ${row.human}`,
      };
    },
  );

  // The contract names this `setUserLocale`; the module exports `upsertUserLocale`.
  await checkWrite(
    "upsertUserLocale",
    () => upsertUserLocale("en"),
    async () => ({
      ok: (await readColumn("app_users", "id", userId, "locale")) === "en",
      detail: `locale = ${await readColumn("app_users", "id", userId, "locale")}`,
    }),
  );

  // RF-56 from the side that has to write something: `per_member` names no shared pot, so the
  // switch to `shared` has to land one — and the second call has to find it rather than add a
  // second, which is what `withdrawCash` needs to keep hitting the same account. Last in the
  // suite: it changes where the group's cash sits, and every path above reads that.
  await checkWrite(
    "updateGroupSettings",
    async () => {
      const settings = {
        groupId: scope.groupId,
        name: "Harness fondo compartido",
        cashMode: "shared",
        locale: "es",
      } as const;
      const cashAccounts = async () =>
        fixtureSql<{ id: string }[]>`
          select id from accounts
          where group_id = ${scope.groupId} and subtype = 'efectivo' and archived_at is null`;

      const first = await updateGroupSettings(settings);
      const afterFirst = await cashAccounts();
      const second = await updateGroupSettings(settings);
      const afterSecond = await cashAccounts();
      for (const row of afterSecond) keep("accounts", row.id);

      return { first, second, afterFirst, afterSecond };
    },
    async ({ first, second, afterFirst, afterSecond }) => ({
      ok:
        first &&
        second &&
        afterFirst.length === 1 &&
        afterSecond.length === 1 &&
        afterSecond[0].id === afterFirst[0].id,
      detail: `both calls admitted = ${first && second}, ${afterFirst.length} cash account after the first and ${afterSecond.length} after the second, the same one = ${afterSecond[0]?.id === afterFirst[0]?.id}, cash_mode = ${await readColumn("groups", "id", scope.groupId, "cash_mode")}`,
    }),
  );

  return {
    accountId: account?.accountId ?? null,
    transactionId: movement?.transactionId ?? null,
    withdrawalId: withdrawal?.transactionId ?? null,
  };
}

/**
 * Suite Q-read: every screen-level read, each called with its real argument
 * shape. A wrong shape is a false failure — a `{start, endExclusive}` window
 * passed as a string reports a bogus syntax error — so each call mirrors the
 * signature, not a guess at it.
 */
async function readSuite(
  userId: string,
  scope: HarnessScope,
  writes: WriteResults,
  silenced: SilencedFixtures,
  debt: DebtFixture,
  groupless: HarnessUser,
  fellow: HarnessUser,
): Promise<void> {
  const personal = { ownerUserId: userId } as const;
  const debtAccountId = writes.accountId ?? scope.liabilityAccountId;

  await checkRead("getDashboardData", () => getDashboardData());
  await checkRead("getReportsData", () => getReportsData());
  await checkRead("getMonthlyFlow", () => getMonthlyFlow(currentMonthRange()));
  await checkRead("getSixMonthFlow", () => getSixMonthFlow());
  await checkRead("getExpensesByCategory", () =>
    getExpensesByCategory(currentMonthRange()),
  );
  await checkRead("getMemberContributions", () =>
    getMemberContributions(currentMonthRange()),
  );
  // A pure reducer over two reads, not a round trip of its own.
  await checkRead("netWorthByOwner", async () =>
    netWorthByOwner(await listAccounts({ archived: false }), await getAccountBalances()),
  );
  await checkRead("getAccountBalances", () => getAccountBalances());
  await checkRead("listTransactions", () => listTransactions({}, { limit: 20 }));
  await checkRead("getTransactionById", () =>
    getTransactionById(writes.withdrawalId ?? randomUUID()),
  );
  await checkRead("getTransactionFormOptions", () => getTransactionFormOptions());
  await checkRead("getLastUsedAccountId", () => getLastUsedAccountId());
  await checkRead("listAccounts", () => listAccounts({ archived: false }));
  await checkRead("listCategories", () => listCategories(personal, "expense"));
  await checkRead("listParentCategories", () =>
    listParentCategories(personal, "expense"),
  );
  await checkRead("listUsedCategoryColors", () => listUsedCategoryColors(personal));
  await checkRead("listLabels", () => listLabels(personal));
  await checkRead("listManagedLabels", () => listManagedLabels(personal));
  await checkRead("listUsedLabelColors", () => listUsedLabelColors(personal));
  await checkRead("listMembers", () =>
    listMembers(scope.groupId, { archived: false }),
  );
  await checkRead("listBudgetsWithStatus", () => listBudgetsWithStatus());
  await checkRead("listGoalsWithProgress", () => listGoalsWithProgress());
  await checkRead("listPlannedPayments", () => listPlannedPayments());
  await checkRead("listRecurringRules", () => listRecurringRules());
  await checkRead("countUnreviewedGenerated", () => countUnreviewedGenerated());
  await checkRead("getDebtsScreenData", () => getDebtsScreenData());
  await checkRead("getDebtOverview", () => getDebtOverview());
  // The screen fans four reads out (RNF-09); the count is what says they never
  // chained and never went one read per debt — the writability of every debt
  // rides the roster's own projection, not a statement of its own. The first call
  // is unmeasured on
  // purpose: the driver counts the statements that open a connection too, and the
  // fan-out opens as many as it has reads.
  await checkReadValue(
    "getDebtsScreenData costs one round trip per fanned-out read",
    async () => {
      await getDebtsScreenData();
      const unitBefore = roundTrips();
      await getAccountBalances();
      const unit = roundTrips() - unitBefore;

      const before = roundTrips();
      await getDebtsScreenData();

      return { unit, trips: roundTrips() - before };
    },
    ({ unit, trips }) => ({
      ok: trips === unit * 4,
      detail: `${trips} round trips for the screen, ${unit} for a single read`,
    }),
  );

  // RF-117: the summed limit and the summed available cover exactly the debts that
  // carry a limit. The one without a limit owes, so counting it as a zero would
  // drag the available below the figure asserted here.
  await checkReadValue(
    "getDebtsScreenData sums the credit of the debts that carry a limit",
    async () => {
      const [screen, balances] = await Promise.all([
        getDebtsScreenData(),
        getAccountBalances([debtAccountId]),
      ]);

      return { screen, owedCents: Math.abs(balances[0]?.balanceCents ?? 0) };
    },
    ({ screen, owedCents }) => {
      const limited = screen.withTerms.find((row) => row.accountId === debtAccountId);
      const unlimited = screen.withTerms.find(
        (row) => row.accountId === debt.unlimitedAccountId,
      );

      return {
        ok:
          limited?.creditLimitCents === CREDIT_LIMIT_CENTS &&
          unlimited?.creditLimitCents === null &&
          unlimited.owedCents > 0 &&
          screen.totals.creditLimitCents === CREDIT_LIMIT_CENTS &&
          screen.totals.availableCreditCents === CREDIT_LIMIT_CENTS - owedCents,
        detail: `${screen.withTerms.length} debts with terms, limit summed ${screen.totals.creditLimitCents} of ${CREDIT_LIMIT_CENTS}, available ${screen.totals.availableCreditCents} against ${CREDIT_LIMIT_CENTS - owedCents}; the debt with no limit owes ${unlimited?.owedCents ?? "no row"} and reports a limit of ${unlimited?.creditLimitCents ?? "null"}`,
      };
    },
  );

  // RF-79: the rate the row states is the twelfth root of the annual one, not the
  // linear twelfth, and it is the very rate the interest figure was struck at —
  // the screen reads the percentage off this and divides nothing.
  await checkReadValue(
    "getDebtOverview states the effective monthly rate its interest was struck at",
    async () => {
      const [overview, annualRate] = await Promise.all([
        getDebtOverview(),
        readColumn<string>(
          "debt_terms",
          "account_id",
          debt.unlimitedAccountId,
          "annual_rate",
        ),
      ]);

      return { overview, annual: Number(annualRate) };
    },
    ({ overview, annual }) => {
      const row = overview.find(
        (candidate) => candidate.accountId === debt.unlimitedAccountId,
      );
      if (row === undefined) return { ok: false, detail: "the debt reports no row" };

      const compounded = (1 + row.monthlyRatePct) ** 12 - 1;

      return {
        ok:
          Math.abs(compounded - annual) < 1e-9 &&
          row.monthlyRatePct !== annual / 12 &&
          row.monthlyInterestCents === Math.round(row.owedCents * row.monthlyRatePct),
        detail: `rate ${row.monthlyRatePct} compounds to ${compounded} against the stored ${annual}, the linear twelfth being ${annual / 12}; ${row.monthlyInterestCents} cents of interest against ${Math.round(row.owedCents * row.monthlyRatePct)} on ${row.owedCents} owed`,
      };
    },
  );

  // RF-16: the source picker is filtered out of the roster the screen already
  // read, and a debt is never paid from another debt.
  await checkReadValue(
    "getDebtsScreenData offers every live asset to pay from, and no liability",
    async () => {
      const [screen, accounts] = await Promise.all([
        getDebtsScreenData(),
        listAccounts({ archived: false }),
      ]);

      return { screen, accounts };
    },
    ({ screen, accounts }) => {
      const kindById = new Map(accounts.map((account) => [account.id, account.kind]));
      const assets = accounts.filter((account) => account.kind === "asset");
      const offered = screen.payFrom.filter(
        (source) => kindById.get(source.id) !== "asset",
      );

      return {
        ok: offered.length === 0 && screen.payFrom.length === assets.length,
        detail: `${screen.payFrom.length} sources offered against ${assets.length} live assets, ${offered.length} of them not an asset`,
      };
    },
  );

  // RF-83: the tile names the debt the earliest due date belongs to — by id as
  // well as by name, since the badge on the table's row is placed by the id — and
  // its figure is that debt's minimum plus the installments falling due by then.
  await checkReadValue(
    "getDebtsScreenData names the debt behind the next payment",
    () => getDebtsScreenData(),
    (screen) => {
      const dated = screen.withTerms.filter((row) => row.nextDueDate !== null);
      const earliest = dated.reduce<(typeof dated)[number] | null>(
        (soonest, row) =>
          soonest !== null && (soonest.nextDueDate ?? "") <= (row.nextDueDate ?? "")
            ? soonest
            : row,
        null,
      );
      const expected =
        earliest === null
          ? null
          : (earliest.minimumPaymentCents ?? 0) + earliest.dueInstallmentsCents;
      const tile = screen.totals.nextPayment;

      return {
        ok:
          earliest !== null &&
          tile?.accountId === earliest.accountId &&
          tile.name === earliest.name &&
          tile.date === earliest.nextDueDate &&
          tile.amountCents === expected,
        detail: `${tile?.amountCents ?? "no"} cents due on ${tile?.date ?? "no date"} on "${tile?.name ?? "no debt"}" (${tile?.accountId ?? "no account"}), against ${expected ?? "no"} cents on "${earliest?.name ?? "no debt"}" (${earliest?.accountId ?? "no account"}) of the ${dated.length} dated debts`,
      };
    },
  );

  // RF-83, RF-79: the consolidated rate is struck on the same balance the tile
  // above it states — the no-terms debts included — so applying it to that total
  // gives back the summed interest to the cent. An average of the rows' rates, or
  // a rate struck over the debts that carry terms alone, would not.
  await checkReadValue(
    "getDebtsScreenData states the rate its summed interest was struck at",
    () => getDebtsScreenData(),
    (screen) => {
      const { owedCents, monthlyInterestCents, monthlyRatePct } = screen.totals;
      const struck = Math.round(owedCents * monthlyRatePct);
      const withTermsOwed = screen.withTerms.reduce(
        (sum, row) => sum + row.owedCents,
        0,
      );
      const highest = screen.withTerms.reduce(
        (top, row) => Math.max(top, row.monthlyRatePct),
        0,
      );

      return {
        ok:
          monthlyRatePct > 0 &&
          Math.abs(struck - monthlyInterestCents) <= 1 &&
          // A no-terms debt owes in this fund, so the two denominators differ and
          // the assertion above is the one that tells them apart.
          withTermsOwed < owedCents &&
          monthlyRatePct < highest,
        detail: `rate ${monthlyRatePct} on ${owedCents} owed gives ${struck} cents against the summed ${monthlyInterestCents}; ${withTermsOwed} of that balance carries terms, and the dearest debt is at ${highest}`,
      };
    },
  );

  // RF-58, RF-100: the writability every surface of the screen reads, driven by a
  // fellow member who really cannot write — not by a fabricated boolean. The same
  // caller's INSERT is refused by the policy, so the flag and the database agree.
  await checkReadValue(
    "getDebtsScreenData reports the writability the policies would admit",
    async () => {
      const mine = await getDebtsScreenData();
      const theirs = await asUser(fellow, () => getDebtsScreenData());

      let refused: string | null = null;
      try {
        const { planId } = await asUser(fellow, () =>
          createInstallmentPlan({
            accountId: debtAccountId,
            description: "Harness plan a member may not write",
            principalCents: 300000,
            nInstallments: 3,
            frequency: "monthly",
            interestRate: null,
            downPaymentCents: null,
            avalCents: null,
            startDate: todayInBogota(),
            merchant: null,
            lines: [],
          }),
        );
        // It landed, which is the failure this assertion is here to catch; the
        // row is tracked so the run still drops what it wrote.
        track("installment_plans", planId);
      } catch (error) {
        refused = pgErrorCode(error) ?? "none";
      }

      return { mine, theirs, refused };
    },
    ({ mine, theirs, refused }) => {
      const rows = (screen: DebtsScreenData) => [
        ...screen.withTerms,
        ...screen.withoutTerms,
      ];
      const owned = rows(mine);
      const read = rows(theirs);
      const seenByBoth = read.filter((row) =>
        owned.some((own) => own.accountId === row.accountId),
      );

      return {
        ok:
          owned.length > 0 &&
          owned.every((row) => row.canWrite) &&
          // The member reads every one of them and writes none.
          seenByBoth.length === owned.length &&
          read.every((row) => !row.canWrite) &&
          refused === "42501",
        detail: `the owner writes ${owned.filter((row) => row.canWrite).length} of ${owned.length} debts; the member reads ${seenByBoth.length} of them and writes ${read.filter((row) => row.canWrite).length}, and her plan was refused with ${refused ?? "nothing"}`,
      };
    },
  );

  // RF-82: the position a debt's lines add up to, read across its plans. The
  // write suite closed one of the card's three lines with a movement.
  await checkReadValue(
    "listPlanPositions states the paid-down card's position",
    () => listPlanPositions(),
    (positions) => {
      const card = positions.find((position) => position.accountId === debtAccountId);

      return {
        ok:
          card?.linesTotal === 3 &&
          card.linesPaid === 1 &&
          card.pendingCents === CARD_LINE_CENTS * 2 &&
          card.nextDueDate === todayInBogota() &&
          card.nextAmountCents === CARD_LINE_CENTS,
        detail: `${card?.linesPaid ?? "no"} of ${card?.linesTotal ?? "no"} lines paid, ${card?.pendingCents ?? "no"} cents pending, next ${card?.nextAmountCents ?? "no"} cents on ${card?.nextDueDate ?? "no date"}`,
      };
    },
  );

  // A plan sits on any liability: one whose account carries no `debt_terms` row
  // still has a position to state (RF-81).
  await checkReadValue(
    "listPlanPositions states the position of a debt with no terms",
    async () => {
      const [positions, terms] = await Promise.all([
        listPlanPositions(),
        getDebtTerms(scope.liabilityAccountId),
      ]);

      return { positions, terms };
    },
    ({ positions, terms }) => {
      const plan = positions.find(
        (position) => position.accountId === scope.liabilityAccountId,
      );

      return {
        ok:
          terms === null &&
          plan?.linesTotal === 3 &&
          plan.linesPaid === 2 &&
          plan.pendingCents === PLAN_LINE_CENTS &&
          plan.nextDueDate === debt.dueDates[2] &&
          plan.nextAmountCents === PLAN_LINE_CENTS,
        detail: `terms = ${terms === null ? "none" : "some"}, ${plan?.linesPaid ?? "no"} of ${plan?.linesTotal ?? "no"} lines paid, ${plan?.pendingCents ?? "no"} cents pending, next ${plan?.nextAmountCents ?? "no"} cents on ${plan?.nextDueDate ?? "no date"}`,
      };
    },
  );

  // RF-84: opening the detail cuts the periods that have passed since the account
  // was opened, and opening it again rewrites none of them — same count, same rows.
  await checkReadValue(
    "getDebtDetail cuts every past period once and rewrites none",
    async () => {
      const first = await getDebtDetail(debt.unlimitedAccountId);
      for (const statement of first?.statements ?? []) {
        track("debt_statements", statement.id);
      }

      return { first, second: await getDebtDetail(debt.unlimitedAccountId) };
    },
    ({ first, second }) => {
      const expected = priorCutOffDates(CUT_OFF_DAY, debt.openedOn, todayInBogota());
      const cutOffs = (first?.statements ?? [])
        .map((statement) => statement.cutOffDate)
        .sort();
      const ids = (rows: typeof first) =>
        (rows?.statements ?? [])
          .map((statement) => statement.id)
          .sort()
          .join(",");

      return {
        ok:
          expected.length > 0 &&
          cutOffs.join(",") === expected.join(",") &&
          ids(first) === ids(second),
        detail: `${cutOffs.length} statements cut of the ${expected.length} periods since ${debt.openedOn}, the same ${ids(first) === ids(second) ? "rows" : "rows no longer"} on the second read`,
      };
    },
  );

  // The policies are the whole scope: a debt outside the caller's is absent, not
  // refused, and so is an account that is no liability.
  await checkReadValue(
    "getDebtDetail is null for another identity and for an asset",
    async () => ({
      stranger: await asUser(groupless, () => getDebtDetail(debt.unlimitedAccountId)),
      asset: await getDebtDetail(scope.assetAccountId),
    }),
    ({ stranger, asset }) => ({
      ok: stranger === null && asset === null,
      detail: `the second identity reads ${stranger === null ? "null" : "the debt"}, the asset reads ${asset === null ? "null" : "a debt"}`,
    }),
  );

  // The narrowing argument no caller has ever passed: it rendered as a record
  // cast to an array and was unusable at every arity (RNF-07).
  await checkReadValue(
    "getAccountBalances narrows to the ids it is given",
    async () => {
      const asked = [scope.assetAccountId, debtAccountId];
      const [all, narrowed] = await Promise.all([
        getAccountBalances(),
        getAccountBalances(asked),
      ]);

      return { asked, all, narrowed };
    },
    ({ asked, all, narrowed }) => {
      const byId = new Map(all.map((row) => [row.accountId, row.balanceCents]));
      const same = narrowed.every(
        (row) => byId.get(row.accountId) === row.balanceCents,
      );

      return {
        ok:
          narrowed.length === asked.length &&
          asked.every((id) => narrowed.some((row) => row.accountId === id)) &&
          same,
        detail: `${narrowed.length} of the ${all.length} accounts came back for ${asked.length} ids, every balance the same as unnarrowed = ${same}`,
      };
    },
  );

  await checkRead("getDebtTerms", () => getDebtTerms(debtAccountId));
  await checkRead("listPlansForAccount", () => listPlansForAccount(debtAccountId));
  await checkRead("listStatements", () => listStatements(debtAccountId));
  await checkRead("listAuditLog", () => listAuditLog({ limit: 20, offset: 0 }));
  await checkRead("getAuditFilterOptions", () => getAuditFilterOptions());
  await checkRead("listWebhookCredentials", () => listWebhookCredentials());
  await checkRead("getWebhookCredentialOptions", () => getWebhookCredentialOptions());
  await checkRead("listPendingDeliveries", () => listPendingDeliveries());
  await checkRead("countPendingDeliveries", () => countPendingDeliveries());
  await checkRead("getShellSummary", () => getShellSummary());
  await checkRead("listOwnMerchants", () => listOwnMerchants());
  await checkReadValue(
    "listSilencedShapes",
    () => listSilencedShapes(),
    (shapes) => {
      const listed = shapes.find((shape) => shape.id === silenced.listed.shapeId);
      const restoredStillNamed = shapes.some(
        (shape) => shape.id === silenced.restored.shapeId,
      );

      return {
        ok:
          listed?.silencedCount === 2 &&
          listed.sampleText === silenced.listed.sampleText &&
          !restoredStillNamed,
        detail: `${shapes.length} silenced, the seeded one counts ${listed?.silencedCount ?? "no"} discarded deliveries and samples "${listed?.sampleText ?? "nothing"}"; the restored one is ${restoredStillNamed ? "still named" : "gone"}`,
      };
    },
  );
  await checkRead("readExport", () => readExport({ entityKeys: [...SHEET_ENTITIES] }));
  await checkRead("readImportScope", () => readImportScope());
  await checkRead("getUserLocale", () => getUserLocale());

  // D7: the RF-49 template leaves external_ref blank for a brand-new row, and a
  // blank cell parses to null — not undefined — so `.optional()` refused every
  // new row the template itself offers. No database round trip here: the five
  // row schemas that carry external_ref are pure zod, driven directly rather
  // than through a parsed workbook, to isolate the one column under test.
  await checkReadValue(
    "sheet row schemas accept a blank external_ref cell",
    async () => {
      const today = todayInBogota();
      const rows: { schema: z.ZodType; row: Record<string, unknown> }[] = [
        {
          schema: accountRowSchema,
          row: {
            name: "Harness fila",
            kind: "asset",
            subtype: "bancaria",
            placement: "personal",
            institution: null,
            lastFour: "",
            amount: "1000",
            balanceOn: today,
          },
        },
        {
          schema: memberRowSchema,
          row: { name: "Harness fila", email: undefined },
        },
        {
          schema: categoryRowSchema,
          row: { name: "Harness fila", kind: "expense", parent: null, color: "#E11D48" },
        },
        {
          schema: recurringRuleRowSchema,
          row: {
            fromAccount: "Harness cuenta",
            toAccount: null,
            amount: "1000",
            category: "Harness categoría",
            description: null,
            frequency: "monthly",
            intervalN: 1,
            dayOfMonth: null,
            nextRunOn: today,
            endsOn: null,
          },
        },
        {
          schema: transactionRowSchema,
          row: {
            fromAccount: "Harness cuenta",
            toAccount: null,
            amount: "1000",
            category: "Harness categoría",
            occurredAt: today,
            description: null,
          },
        },
      ];
      const overlong = "x".repeat(201);

      return rows.map(({ schema, row }) => ({
        blank: schema.safeParse({ ...row, externalRef: null }).success,
        absent: schema.safeParse(row).success,
        overlong: schema.safeParse({ ...row, externalRef: overlong }).success,
      }));
    },
    (results) => {
      const blank = results.filter((row) => row.blank).length;
      const absent = results.filter((row) => row.absent).length;
      const overlongRejected = results.filter((row) => !row.overlong).length;

      return {
        ok: blank === results.length && absent === results.length && overlongRejected === results.length,
        detail: `blank external_ref accepted on ${blank} of ${results.length} row schemas, absent cell accepted on ${absent}, a 201-char external_ref rejected on ${overlongRejected}`,
      };
    },
  );
}

// The two modules that name a message key for an installment plan or a debt
// payment: the schema the form and the server share, and the action that maps the
// database's refusals onto keys.
const INSTALLMENT_KEY_SOURCES = [
  "lib/validation/installment-plan.ts",
  "app/actions/installment-plans.ts",
];

// Every `installments.*` literal a module names, trailing sentence punctuation
// dropped so a key inside a comment reads the same as one inside a string.
function namedInstallmentKeys(): string[] {
  const found = INSTALLMENT_KEY_SOURCES.flatMap((file) =>
    [...readFileSync(resolve(file), "utf8").matchAll(/installments\.[A-Za-z0-9_.]+/g)].map(
      (match) => match[0].replace(/\.+$/, ""),
    ),
  );

  return [...new Set(found)].sort();
}

// The leaf key paths under a message subtree, so two locales can be compared as
// sets rather than one string at a time.
function leafKeys(value: unknown, prefix: string): string[] {
  if (typeof value !== "object" || value === null) return [prefix];

  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

function translation(messages: object, key: string): string | undefined {
  const found = key.split(".").reduce<unknown>(
    (node, part) =>
      typeof node === "object" && node !== null && part in node
        ? (node as Record<string, unknown>)[part]
        : undefined,
    messages,
  );

  return typeof found === "string" ? found : undefined;
}

/**
 * Suite Q-invariant: three §2 facts, read back from rows THIS run wrote through
 * the real functions, then RF-55's one-membership rule, proven by the refusal it
 * raises. A refused write leaves nothing to read, so a read-back assertion skips
 * rather than passing on an absent row.
 */
async function invariantSuite(
  writes: WriteResults,
  restored: SilencedFixture,
): Promise<void> {
  const negativeOpening = next("a liability's opening balance is stored negative");
  if (writes.accountId === null) {
    skip(negativeOpening, "createAccount was refused, so no row was written");
  } else {
    const cents = await readColumn<string>(
      "accounts",
      "id",
      writes.accountId,
      "initial_balance_cents",
    );
    assert(
      negativeOpening,
      Number(cents) < 0,
      `initial_balance_cents = ${cents} for a liability opened at 1800 pesos`,
    );
  }

  const derivedKind = next("a movement's kind is the one its accounts imply");
  if (writes.withdrawalId === null) {
    skip(derivedKind, "withdrawCash was refused, so no movement was written");
  } else {
    const [row] = await fixtureSql<
      { kind: string; from_account_id: string | null; to_account_id: string | null }[]
    >`
      select kind, from_account_id, to_account_id
      from transactions where id = ${writes.withdrawalId}`;
    // No caller named `kind`: the column is generated, and the withdrawal names
    // both ends, which is what makes it a transfer.
    assert(
      derivedKind,
      row.kind === "transfer" &&
        row.from_account_id !== null &&
        row.to_account_id !== null,
      `kind = ${row.kind}, from = ${row.from_account_id !== null}, to = ${row.to_account_id !== null}`,
    );
  }

  // RF-101, on the schema side: the database refuses the pair with a check
  // constraint, and the very schema the form binds to refuses it first, with a
  // message. Same schema on both ends of the action (RNF-10), so one parse
  // proves the form and the server together.
  const selfTransfer = next("the shared schema refuses a transfer to the same account");
  const sameAccount = writes.accountId ?? randomUUID();
  const parsed = createTransactionSchema.safeParse({
    fromAccountId: sameAccount,
    toAccountId: sameAccount,
    amount: "10000",
    occurredAt: todayInBogota(),
    description: null,
    splits: [],
    labelIds: [],
  });
  const issues = parsed.success ? [] : parsed.error.issues;
  const sameIssue = issues.find(
    (issue) => issue.message === "transactions.errors.accountSame",
  );
  assert(
    selfTransfer,
    sameIssue !== undefined &&
      sameIssue.path.join(".") === "toAccountId" &&
      es.transactions.errors.accountSame.length > 0 &&
      en.transactions.errors.accountSame.length > 0,
    parsed.success
      ? "the payload parsed, which it must not"
      : `${issues.length} issue(s), accountSame at path ${sameIssue?.path.join(".") ?? "none"}, es "${es.transactions.errors.accountSame}", en "${en.transactions.errors.accountSame}"`,
  );

  // Every key the debt schema and the debt action can hand a form is a string a
  // person reads, in both locales — a key that resolves in one and not the other
  // is a screen that shows the key itself.
  const installmentKeys = next("every installments key the schema and the action name reads");
  const named = namedInstallmentKeys();
  const untranslated = named.filter(
    (key) => translation(es, key) === undefined || translation(en, key) === undefined,
  );
  const esKeys = leafKeys(es.installments, "installments");
  const enKeys = leafKeys(en.installments, "installments");
  assert(
    installmentKeys,
    named.length > 0 &&
      untranslated.length === 0 &&
      esKeys.sort().join(",") === enKeys.sort().join(","),
    `${named.length} keys named, ${untranslated.length} untranslated${
      untranslated.length > 0 ? ` (${untranslated.join(", ")})` : ""
    }; es holds ${esKeys.length} installments strings and en ${enKeys.length}`,
  );

  const audited = next("every write left an audit_log row naming its record");
  if (written.length === 0) {
    skip(audited, "no write path got through, so there is nothing to trace");
  } else {
    const recordIds = written.map((entry) => entry.recordId);
    const rows = await fixtureSql<{ entity: string; record_id: string }[]>`
      select distinct entity, record_id from audit_log
      where record_id in ${fixtureSql(recordIds)}`;
    const seen = new Set(rows.map((row) => `${row.entity}:${row.record_id}`));
    const missing = written.filter(
      (entry) => !seen.has(`${entry.entity}:${entry.recordId}`),
    );
    assert(
      audited,
      missing.length === 0,
      `${written.length} written, ${written.length - missing.length} traced${
        missing.length > 0 ? `, missing ${missing.map((e) => e.entity).join(", ")}` : ""
      }`,
    );
  }

  // RF-55: a user belongs to at most one live optional group. The run's own user
  // leads the seeded one, so the leader row `createGroup` writes second collides
  // on `group_members_user_unique` — a partial unique index over the unarchived
  // rows — and takes the whole transaction back with it.
  const oneMembership = next("a leader's second createGroup is refused");
  try {
    const { groupId } = await createGroup({
      name: "Harness fondo duplicado",
      leaderName: "Harness leader",
      cashMode: "shared",
      locale: "es",
    });
    // Tracked, not left behind: an accepted call is the failure this asserts on.
    track("groups", groupId);
    assert(oneMembership, false, `it was accepted as group ${groupId}`);
  } catch (error) {
    assert(
      oneMembership,
      pgErrorCode(error) === "23505" &&
        rootMessage(error).includes("group_members_user_unique"),
      refusal(error),
    );
  }

  // RF-99, read through the two screens that show it: the shape is off the silenced
  // list, the deliveries it discarded are waiting for review again, and the delivery
  // this person rejected by hand stayed rejected.
  const undone = next("an undone silence returns only what the machine discarded");
  const [shapes, pending] = await Promise.all([
    listSilencedShapes(),
    listPendingDeliveries(),
  ]);
  const queued = restored.silencedIds.filter((id) =>
    pending.some((delivery) => delivery.id === id),
  );
  const humanQueued = pending.some(
    (delivery) => delivery.id === restored.humanRejectedId,
  );

  assert(
    undone,
    !shapes.some((shape) => shape.id === restored.shapeId) &&
      queued.length === 2 &&
      !humanQueued,
    `the shape is ${shapes.some((shape) => shape.id === restored.shapeId) ? "still silenced" : "no longer silenced"}, ${queued.length} of 2 discarded deliveries are pending again, the person's rejection is ${humanQueued ? "back in the queue" : "still out of it"}`,
  );
}

/**
 * Suite Q-timing: what each screen-level read costs, in wall time and in round
 * trips counted at the driver. It PRINTS and asserts nothing — RNF-09 is a budget
 * on an HTTP response, and this is the attribution that has to explain the number
 * `check:http` reports, not a second verdict on it.
 *
 * Read as the user `scripts/seed-year.ts` loaded the year of movements onto, so
 * the numbers are the ones the requirement is stated against; against the run's
 * own throwaway user they would only say what an empty ledger costs. Nothing here
 * writes, so reading as another identity leaves that user's rows exactly as found.
 */
async function timingSuite(): Promise<void> {
  const seeded = await findUserByEmail(HARNESS_EMAIL);
  if (!seeded) {
    console.log(
      `REPORT  no ${HARNESS_EMAIL} identity, so there is no seeded ledger to time; run check:http once, then seed:year.`,
    );
    return;
  }

  const movements = await countOwnedMovements(seeded.id);
  console.log(
    `REPORT  timing as ${HARNESS_EMAIL}, who owns ${movements} movements${
      movements >= YEAR_OF_MOVEMENTS
        ? ""
        : ` — short of the ${YEAR_OF_MOVEMENTS} a year holds, so these numbers understate the requirement`
    }.`,
  );

  const timed = async (name: string, run: () => Promise<unknown>): Promise<void> => {
    const trips = roundTrips();
    const started = performance.now();
    const value = await run();

    console.log(
      `REPORT  ${name} — ${Math.round(performance.now() - started)} ms over ${roundTrips() - trips} round trips, ${summarise(value)}.`,
    );
  };

  await asUser(seeded, async () => {
    // Cold: the pool has no connection to this database yet, and the first read
    // would charge the whole suite for opening one.
    await getUserGroup();

    console.log("");
    await timed("getDashboardData (the whole dashboard read-model)", () =>
      getDashboardData(),
    );
    // The same six reads again, one at a time: what the fan-out above is made of.
    await timed("  listAccounts", () => listAccounts({ archived: false }));
    await timed("  getAccountBalances", () => getAccountBalances());
    await timed("  getMonthlyFlow", () => getMonthlyFlow(currentMonthRange()));
    await timed("  getUserGroup", () => getUserGroup());
    await timed("  countUnreviewedGenerated", () => countUnreviewedGenerated());
    await timed("  countPendingDeliveries", () => countPendingDeliveries());
    // The shell's own read, on every route: the sidebar's name, role and count.
    await timed("getShellSummary (the layout's sidebar)", () => getShellSummary());

    // The rest of what a request for `/es` costs: the layout and the page each
    // call `getTransactionFormOptions`, and it awaits `getUserGroup()` before its
    // own fan-out rather than inside it.
    await timed("getTransactionFormOptions (layout, then page again)", () =>
      getTransactionFormOptions(),
    );
    await timed("listTransactions limit 3 (the dashboard's recent lines)", () =>
      listTransactions({}, { limit: 3 }),
    );
    await timed("resolveWithdrawalTarget", () => resolveWithdrawalTarget());

    console.log("");
    await timed("listTransactions unbounded (what /movements loads)", () =>
      listTransactions({}),
    );
    await timed("getReportsData (what /reports loads)", () => getReportsData());
  });
}

async function main(): Promise<void> {
  const userId = await createHarnessUser();
  console.log(`REPORT  harness user ${userId}, created for this run and dropped after it.`);

  const scope = await seedHarnessScope(userId);
  // The create-a-fund path needs a caller who is in no group; the seeding above
  // made the run's own user a leader.
  const groupless = await createMembershipFreeUser();
  console.log(
    `REPORT  membership-free user ${groupless.id}, who drives the create-a-fund path.`,
  );

  // Read-only sanity, never an assertion: the seeded user's own rows are proof
  // that the connection points at the database the app uses.
  const [seeded] = await fixtureSql<{ accounts: string; categories: string }[]>`
    select
      (select count(*)::text from accounts where owner_user_id = ${SEEDED_USER_ID}) as accounts,
      (select count(*)::text from categories where owner_user_id = ${SEEDED_USER_ID}) as categories`;
  console.log(
    `REPORT  seeded user holds ${seeded.accounts} accounts and ${seeded.categories} categories; nothing below depends on them.`,
  );
  console.log("");

  // Two of the same fixture, because the suites run in order: the write suite restores
  // one, so the read suite would have nothing left to assert on if they shared it.
  const silenced: SilencedFixtures = {
    restored: await seedSilencedShape(userId, "restaurada"),
    listed: await seedSilencedShape(userId, "listada"),
  };

  const debt = await seedDebtFixture(userId, scope);

  // The other side of every write policy on a debt: someone who sees the fund's
  // debts and may write none of them.
  const fellow = await seedFellowMember(userId, scope.groupId);
  console.log(
    `REPORT  fellow member ${fellow.id}, who reads the leader's debts and writes none.`,
  );

  const writes = await writeSuite(userId, scope, groupless, silenced.restored, debt);
  console.log("");
  await readSuite(userId, scope, writes, silenced, debt, groupless, fellow);
  console.log("");
  await invariantSuite(writes, silenced.restored);
  console.log("");
  await timingSuite();
}

// Wrapped in an async IIFE (not top-level await) so the runner can transpile
// this to CJS and run it on any Node version, not only Node 22's native strip.
void (async () => {
  try {
    await main();
  } catch (error) {
    assert(next("the run completed"), false, `it aborted — ${rootMessage(error)}`);
  } finally {
    // A cleanup that throws is a leak, not a crash: it gets an assertion of its
    // own so the run says which rows it left behind.
    try {
      await cleanup();
    } catch (error) {
      assert(next("the fixtures were dropped"), false, refusal(error));
    }
  }

  report();
})();
