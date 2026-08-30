import "server-only";

import { getAccountBalances } from "@/db/queries/account-balances";
import { listAccounts } from "@/db/queries/accounts";
import { getDebtOverview } from "@/db/queries/debt-overview";
import type { DebtOverviewRow } from "@/db/queries/debt-overview";

export type DebtsScreenData = {
  totals: {
    owedCents: number;
    monthlyInterestCents: number;
    nextPayment: { amountCents: number; date: string } | null;
  };
  withTerms: (DebtOverviewRow & { name: string })[];
  withoutTerms: { accountId: string; name: string; owedCents: number }[];
};

/**
 * Everything the debts screen renders, in ONE fan-out of three existing reads
 * (RF-83, RNF-09): the terms-carrying overview, the account roster for names and
 * the kind partition, and the derived balances for the no-terms owed magnitudes.
 * The awaits never chain — three round trips, no more. Every figure arrives
 * already derived from the backend and stays integer cents.
 */
export async function getDebtsScreenData(): Promise<DebtsScreenData> {
  const [overview, accounts, balances] = await Promise.all([
    getDebtOverview(),
    listAccounts({ archived: false }),
    getAccountBalances(),
  ]);

  const nameById = new Map(accounts.map((account) => [account.id, account.name]));
  const balanceById = new Map(
    balances.map((balance) => [balance.accountId, balance.balanceCents]),
  );

  // The overview holds the liabilities that carry terms (RF-78), archived ones
  // included — its join filters only by kind. An archived account is off the
  // active roster, so it drops here and stays out of the totals below.
  const withTerms = overview.flatMap((row) => {
    const name = nameById.get(row.accountId);
    return name === undefined ? [] : [{ ...row, name }];
  });

  // A liability absent from the overview owes without a rate (RF-78, RF-79); its
  // owed is the magnitude of the derived balance, never a stored figure.
  const withTermsIds = new Set(withTerms.map((row) => row.accountId));
  const withoutTerms = accounts
    .filter((account) => account.kind === "liability" && !withTermsIds.has(account.id))
    .map((account) => ({
      accountId: account.id,
      name: account.name,
      owedCents: Math.abs(balanceById.get(account.id) ?? 0),
    }));

  const owedCents =
    withTerms.reduce((sum, row) => sum + row.owedCents, 0) +
    withoutTerms.reduce((sum, debt) => sum + debt.owedCents, 0);

  // A no-terms debt has no rate, so only the overview rows contribute (RF-79).
  const monthlyInterestCents = withTerms.reduce(
    (sum, row) => sum + row.monthlyInterestCents,
    0,
  );

  // The earliest named due date carries the consolidated next payment (RF-83):
  // that row's minimum plus the installments falling due by then.
  const nextPayment = withTerms
    .filter((row): row is typeof row & { nextDueDate: string } => row.nextDueDate !== null)
    .reduce<DebtsScreenData["totals"]["nextPayment"]>((earliest, row) => {
      if (earliest !== null && earliest.date <= row.nextDueDate) return earliest;
      return {
        amountCents: (row.minimumPaymentCents ?? 0) + row.dueInstallmentsCents,
        date: row.nextDueDate,
      };
    }, null);

  return {
    totals: { owedCents, monthlyInterestCents, nextPayment },
    withTerms,
    withoutTerms,
  };
}
