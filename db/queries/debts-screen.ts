import "server-only";

import { sql } from "drizzle-orm";

import { getAccountBalances } from "@/db/queries/account-balances";
import { listAccounts } from "@/db/queries/accounts";
import { getDebtOverview, sumDebtCreditTotals } from "@/db/queries/debt-overview";
import type { DebtOverviewRow } from "@/db/queries/debt-overview";
import { listPlanPositions } from "@/db/queries/installment-plans";
import type { PlanPosition } from "@/db/queries/installment-plans";
import { withUserDb } from "@/db/session";

export type DebtsScreenData = {
  totals: {
    owedCents: number;
    monthlyInterestCents: number;
    // The share of the owed magnitude the summed interest is charged at, the one
    // definition of the consolidated rate: no screen divides the two totals.
    monthlyRatePct: number;
    availableCreditCents: number;
    creditLimitCents: number;
    nextPayment: {
      accountId: string;
      amountCents: number;
      date: string;
      name: string;
    } | null;
  };
  withTerms: (DebtOverviewRow & {
    name: string;
    planPosition: PlanPosition | null;
    canWrite: boolean;
  })[];
  withoutTerms: {
    accountId: string;
    name: string;
    owedCents: number;
    planPosition: PlanPosition | null;
    canWrite: boolean;
  }[];
  payFrom: { id: string; name: string; balanceCents: number }[];
};

/**
 * What the policies would admit on each live liability, in ONE round trip: the
 * very predicate every write policy on a debt is written against (RF-58, RF-100).
 * A screen asks this rather than inferring a role, so it offers no action the
 * database would refuse. The read costs its own trip because the roster's own
 * query does not carry the privilege.
 */
async function readWritableDebts(): Promise<Map<string, boolean>> {
  return withUserDb(async (tx) => {
    const rows = await tx.execute<{ id: string; can_write: boolean }>(sql`
      select a.id, private.can_write_account(a.id) as can_write
      from accounts a
      where a.kind = 'liability' and a.archived_at is null
    `);

    return new Map(rows.map((row) => [row.id, row.can_write]));
  });
}

/**
 * Everything the debts screen renders, in ONE fan-out of five existing reads
 * (RF-83, RF-117, RNF-09): the terms-carrying overview, the account roster for
 * names and the kind partition, the derived balances for the no-terms owed
 * magnitudes, each account's installment position, and what the caller may write.
 * The awaits never chain — five round trips, no more. Every figure arrives
 * already derived from the backend and stays integer cents.
 */
export async function getDebtsScreenData(): Promise<DebtsScreenData> {
  const [overview, accounts, balances, positions, writable] = await Promise.all([
    getDebtOverview(),
    listAccounts({ archived: false }),
    getAccountBalances(),
    listPlanPositions(),
    readWritableDebts(),
  ]);

  const nameById = new Map(accounts.map((account) => [account.id, account.name]));
  const balanceById = new Map(
    balances.map((balance) => [balance.accountId, balance.balanceCents]),
  );
  const positionById = new Map(
    positions.map((position) => [position.accountId, position]),
  );

  // The overview holds the liabilities that carry terms (RF-78), archived ones
  // included — its join filters only by kind. An archived account is off the
  // active roster, so it drops here and stays out of the totals below.
  const withTerms = overview.flatMap((row) => {
    const name = nameById.get(row.accountId);
    if (name === undefined) return [];

    return [
      {
        ...row,
        name,
        planPosition: positionById.get(row.accountId) ?? null,
        // Absent from the map is a debt the write predicate did not admit.
        canWrite: writable.get(row.accountId) ?? false,
      },
    ];
  });

  // A liability absent from the overview owes without a rate (RF-78, RF-79); its
  // owed is the magnitude of the derived balance, never a stored figure. It may
  // still carry a plan, so its position is looked up the same way.
  const withTermsIds = new Set(withTerms.map((row) => row.accountId));
  const withoutTerms = accounts
    .filter((account) => account.kind === "liability" && !withTermsIds.has(account.id))
    .map((account) => ({
      accountId: account.id,
      name: account.name,
      owedCents: Math.abs(balanceById.get(account.id) ?? 0),
      planPosition: positionById.get(account.id) ?? null,
      canWrite: writable.get(account.id) ?? false,
    }));

  const owedCents =
    withTerms.reduce((sum, row) => sum + row.owedCents, 0) +
    withoutTerms.reduce((sum, debt) => sum + debt.owedCents, 0);

  // A no-terms debt has no rate, so only the overview rows contribute (RF-79).
  const monthlyInterestCents = withTerms.reduce(
    (sum, row) => sum + row.monthlyInterestCents,
    0,
  );

  // Exactly the debts that carry a limit (RF-117): one without a limit is skipped
  // rather than counted as a zero, so it neither lifts the summed limit nor drags
  // the summed available down.
  const { availableCreditCents, creditLimitCents } = sumDebtCreditTotals(withTerms);

  // The share of the owed magnitude the interest above is charged at, struck over
  // the whole debt — the no-terms debts included, since they are in the total the
  // tile sits under. Derived once here so no screen divides two totals of its own.
  const monthlyRatePct = owedCents > 0 ? monthlyInterestCents / owedCents : 0;

  // The earliest named due date carries the consolidated next payment (RF-83):
  // that row's minimum plus the installments falling due by then, and the debt it
  // belongs to — its id as well as its name, so the row that carries the badge is
  // named rather than matched back by hand.
  const nextPayment = withTerms
    .filter((row): row is typeof row & { nextDueDate: string } => row.nextDueDate !== null)
    .reduce<DebtsScreenData["totals"]["nextPayment"]>((earliest, row) => {
      if (earliest !== null && earliest.date <= row.nextDueDate) return earliest;
      return {
        accountId: row.accountId,
        amountCents: (row.minimumPaymentCents ?? 0) + row.dueInstallmentsCents,
        date: row.nextDueDate,
        name: row.name,
      };
    }, null);

  // A debt is paid from an asset (RF-16), so the source picker is filtered out of
  // the roster already read — never a fifth round trip, and never a liability.
  const payFrom = accounts
    .filter((account) => account.kind === "asset")
    .map((account) => ({
      id: account.id,
      name: account.name,
      balanceCents: account.balanceCents,
    }));

  return {
    totals: {
      owedCents,
      monthlyInterestCents,
      monthlyRatePct,
      availableCreditCents,
      creditLimitCents,
      nextPayment,
    },
    withTerms,
    withoutTerms,
    payFrom,
  };
}
