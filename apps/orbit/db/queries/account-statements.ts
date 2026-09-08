import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { accounts, accountStatements } from "@/db/schema";
import type { AccountStatement } from "@/db/schema";
import { withUserDb } from "@/db/session";

export type AccountStatementRow = AccountStatement & {
  // The account's own balance at the cut-off, in its settlement currency.
  derivedBalanceCents: number;
  // What the close claims over what the movements say. Zero when they agree.
  reconciliationGapCents: number;
};

/**
 * Any account's closes, newest first, each with its reconciliation gap (RF-129).
 * ONE round trip: the derived balance rides the same projection as the stored
 * snapshot, correlated per row, never a read per statement.
 *
 * Nothing is generated here. A period nobody recorded is absent, and the gap is
 * computed on read from the movements — neither figure is ever stored (RNF-07).
 * Every column inside the fragment is written with its own name: an embedded
 * Drizzle column renders bare in a projection and binds to the inner table.
 */
export async function listAccountStatements(
  accountId: string,
): Promise<AccountStatementRow[]> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .select({
        statement: accountStatements,
        // The opening balance is one row in the settlement currency, so the walk
        // to the cut-off starts there and stays in that one pocket. Each leg lands
        // the way `account_balances` lands it (RF-121, RF-124): its own amount
        // while it was spent in that currency, what the issuer billed once a
        // confirmed second amount says so, and nothing while that figure is still
        // an estimate.
        derivedBalanceCents: sql<string>`
          accounts.initial_balance_cents
            + coalesce((select sum(case
                when t.currency = accounts.settlement_currency then t.amount_cents
                when t.counter_amount_cents is not null and not t.counter_is_estimate
                  then t.counter_amount_cents
                else 0
              end) from transactions t
              where t.to_account_id = account_statements.account_id
                and t.occurred_at <= account_statements.cut_off_date), 0)
            - coalesce((select sum(case
                when t.currency = accounts.settlement_currency then t.amount_cents
                when t.counter_amount_cents is not null and not t.counter_is_estimate
                  then t.counter_amount_cents
                else 0
              end) from transactions t
              where t.from_account_id = account_statements.account_id
                and t.occurred_at <= account_statements.cut_off_date), 0)
        `,
      })
      .from(accountStatements)
      .innerJoin(accounts, eq(accounts.id, accountStatements.accountId))
      .where(eq(accountStatements.accountId, accountId))
      .orderBy(desc(accountStatements.cutOffDate));

    return rows.map(({ statement, derivedBalanceCents }) => {
      // A bigint sum arrives from the driver as a string; the ledger keeps cents a number.
      const derived = Number(derivedBalanceCents);

      return {
        ...statement,
        derivedBalanceCents: derived,
        reconciliationGapCents: statement.closingBalanceCents - derived,
      };
    });
  });
}
