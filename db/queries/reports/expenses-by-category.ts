import "server-only";

import { sql } from "drizzle-orm";

import { withUserDb } from "@/db/session";

export type CategoryExpense = {
  categoryId: string;
  name: string;
  color: string | null;
  totalCents: number;
};

/**
 * This window's expenses by category, largest first, in ONE round trip (RF-34).
 * It sums the SPLIT amounts, not the transaction amount, so a multi-category
 * expense lands whole in each of its categories. Only expenses count (RF-19): a
 * transfer carries no split rows and `t.kind = 'expense'` filters income out.
 * `occurred_at` is compared as a `YYYY-MM-DD` string against string bounds.
 */
export async function getExpensesByCategory(range: {
  start: string;
  endExclusive: string;
}): Promise<CategoryExpense[]> {
  return withUserDb(async (tx) => {
    const rows = await tx.execute<{
      category_id: string;
      name: string;
      color: string | null;
      total_cents: string;
    }>(sql`
      select
        s.category_id,
        c.name,
        c.color,
        sum(s.amount_cents) as total_cents
      from transaction_splits s
      join transactions t on t.id = s.transaction_id
      join categories c on c.id = s.category_id
      where t.kind = 'expense'
        and t.occurred_at >= ${range.start} and t.occurred_at < ${range.endExclusive}
      group by s.category_id, c.name, c.color
      order by sum(s.amount_cents) desc
    `);

    // A bigint sum arrives from the driver as a string; the ledger keeps cents a number.
    return rows.map((row) => ({
      categoryId: row.category_id,
      name: row.name,
      color: row.color,
      totalCents: Number(row.total_cents),
    }));
  });
}
