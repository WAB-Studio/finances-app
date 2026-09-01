/**
 * Layer 1 of the harness: the app's OWN query functions, driven against the
 * remote database with RLS on. `scripts/check-rls.ts` builds every fixture with
 * raw SQL and proves the policies without ever executing the code a screen runs;
 * this executes exactly that code and asserts on what comes back.
 *
 * No transaction wraps a suite. `withUserDb` opens and commits its own, and
 * running the production control flow rather than a replica of it is the point.
 */
import { randomUUID } from "node:crypto";

import { getAccountBalances } from "@/db/queries/account-balances";
import {
  archiveAccount,
  createAccount,
  listAccounts,
  restoreAccount,
  updateAccount,
} from "@/db/queries/accounts";
import { getAuditFilterOptions, listAuditLog } from "@/db/queries/audit-log";
import {
  createBudget,
  listBudgetsWithStatus,
  updateBudget,
} from "@/db/queries/budgets";
import { withdrawCash } from "@/db/queries/cash";
import {
  createCategory,
  listCategories,
  listParentCategories,
  listUsedCategoryColors,
  updateCategory,
} from "@/db/queries/categories";
import { createGroup } from "@/db/queries/create-group";
import { getDebtOverview } from "@/db/queries/debt-overview";
import { listStatements } from "@/db/queries/debt-statements";
import { getDebtTerms, upsertDebtTerms } from "@/db/queries/debt-terms";
import { getDebtsScreenData } from "@/db/queries/debts-screen";
import { readExport } from "@/db/queries/export";
import { createMember, listMembers } from "@/db/queries/group-members";
import { readImportScope } from "@/db/queries/import-preview";
import {
  countPendingDeliveries,
  listOwnMerchants,
  listPendingDeliveries,
} from "@/db/queries/ingest-review";
import {
  createInstallmentPlan,
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
import { currentMonthRange, todayInBogota } from "@/lib/dates";
import { pgErrorCode } from "@/lib/db-error";
import { SEED_CATEGORIES } from "@/lib/fund/seed";
import { SHEET_ENTITIES } from "@/lib/spreadsheet/schema";

import { assert, report, skip } from "./harness/assert";
import type { FixtureTable, HarnessScope, HarnessUser } from "./harness/fixtures";
import {
  asUser,
  cleanup,
  createHarnessUser,
  createMembershipFreeUser,
  fixtureSql,
  seedHarnessScope,
  track,
} from "./harness/fixtures";

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
        pesos: 1500,
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
        pesos: 1800,
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
        creditLimitCents: 500000000,
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
        principalCents: 120000000,
        nInstallments: 3,
        frequency: "monthly",
        interestRate: "0.0200",
        downPaymentCents: null,
        avalCents: null,
        startDate: today,
        merchant: "Harness store",
        lines: [
          { seq: 1, dueDate: today, amountCents: 40000000 },
          { seq: 2, dueDate: today, amountCents: 40000000 },
          { seq: 3, dueDate: today, amountCents: 40000000 },
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
        amountCents: 40000000,
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

  // The contract names this `setUserLocale`; the module exports `upsertUserLocale`.
  await checkWrite(
    "upsertUserLocale",
    () => upsertUserLocale("en"),
    async () => ({
      ok: (await readColumn("app_users", "id", userId, "locale")) === "en",
      detail: `locale = ${await readColumn("app_users", "id", userId, "locale")}`,
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
  await checkRead("getDebtTerms", () => getDebtTerms(debtAccountId));
  await checkRead("listPlansForAccount", () => listPlansForAccount(debtAccountId));
  await checkRead("listStatements", () => listStatements(debtAccountId));
  await checkRead("listAuditLog", () => listAuditLog({ limit: 20, offset: 0 }));
  await checkRead("getAuditFilterOptions", () => getAuditFilterOptions());
  await checkRead("listWebhookCredentials", () => listWebhookCredentials());
  await checkRead("getWebhookCredentialOptions", () => getWebhookCredentialOptions());
  await checkRead("listPendingDeliveries", () => listPendingDeliveries());
  await checkRead("countPendingDeliveries", () => countPendingDeliveries());
  await checkRead("listOwnMerchants", () => listOwnMerchants());
  await checkRead("readExport", () => readExport({ entityKeys: [...SHEET_ENTITIES] }));
  await checkRead("readImportScope", () => readImportScope());
  await checkRead("getUserLocale", () => getUserLocale());
}

/**
 * Suite Q-invariant: three §2 facts, read back from rows THIS run wrote through
 * the real functions, then RF-55's one-membership rule, proven by the refusal it
 * raises. A refused write leaves nothing to read, so a read-back assertion skips
 * rather than passing on an absent row.
 */
async function invariantSuite(writes: WriteResults): Promise<void> {
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

  const writes = await writeSuite(userId, scope, groupless);
  console.log("");
  await readSuite(userId, scope, writes);
  console.log("");
  await invariantSuite(writes);
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
