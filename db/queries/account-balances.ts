import "server-only";

import { sql } from "drizzle-orm";

import { withUserDb } from "@/db/session";

export type AccountBalance = { accountId: string; balanceCents: number };

/**
 * Every account's balance for the screen in one aggregate read of the
 * `account_balances` view (RNF-07, RNF-09): the view derives each balance from
 * movements, never a stored column. `accountIds` narrows the same query — never
 * one round trip per account.
 */
export async function getAccountBalances(
  accountIds?: string[],
): Promise<AccountBalance[]> {
  return withUserDb(async (tx) => {
    const filter = accountIds ? sql`where id = any(${accountIds}::uuid[])` : sql``;

    const rows = await tx.execute<{ id: string; balance_cents: string }>(
      sql`select id, balance_cents from account_balances ${filter}`,
    );

    // A bigint sum arrives from the driver as a string; the ledger keeps cents a number.
    return rows.map((row) => ({
      accountId: row.id,
      balanceCents: Number(row.balance_cents),
    }));
  });
}
