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
    // ONE json parameter carries the ids: drizzle expands a JS array in a
    // template into a comma-separated list, which is a record and not an array,
    // and `any(...)` over one is unusable at every arity — a single id reads as a
    // malformed array literal, two as a record that cannot cast, none as a
    // syntax error.
    const filter = accountIds
      ? sql`where id in (
          select value::uuid from jsonb_array_elements_text(${JSON.stringify(accountIds)}::jsonb)
        )`
      : sql``;

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
