import "server-only";

import { sql } from "drizzle-orm";

import { withUserDb } from "@/db/session";
import { lastSixMonthStarts, monthRange } from "@/lib/dates";

export type MonthlyFlow = {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
};

export type MonthFlow = {
  monthStart: string;
  incomeCents: number;
  expenseCents: number;
};

/**
 * Income, expense and net for one half-open window in ONE aggregate read
 * (RF-88, RNF-09). A transfer is never summed (RF-19): only the `income` and
 * `expense` generated kinds feed the two totals. `occurred_at` is compared as a
 * `YYYY-MM-DD` string against string bounds, never a JS Date. A window with no
 * rows leaves each sum null, which `coalesce` and `Number` carry to 0.
 */
export async function getMonthlyFlow(range: {
  start: string;
  endExclusive: string;
}): Promise<MonthlyFlow> {
  return withUserDb(async (tx) => {
    const [row] = await tx.execute<{
      income_cents: string;
      expense_cents: string;
    }>(sql`
      select
        coalesce(sum(amount_cents) filter (where kind = 'income'), 0) as income_cents,
        coalesce(sum(amount_cents) filter (where kind = 'expense'), 0) as expense_cents
      from transactions
      where occurred_at >= ${range.start} and occurred_at < ${range.endExclusive}
    `);

    // A bigint sum arrives from the driver as a string; the ledger keeps cents a number.
    const incomeCents = Number(row.income_cents);
    const expenseCents = Number(row.expense_cents);

    return { incomeCents, expenseCents, netCents: incomeCents - expenseCents };
  });
}

/**
 * Six months of income and expense for the trend, oldest first, in ONE grouped
 * read — never one round trip per month (RNF-09). The span runs from the first
 * of `lastSixMonthStarts()` to the month after its last; the query groups by the
 * `YYYY-MM` month key, and TypeScript projects those groups onto the six known
 * buckets so a month with no movement still renders as zeros.
 */
export async function getSixMonthFlow(): Promise<MonthFlow[]> {
  const monthStarts = lastSixMonthStarts();
  const sixMonthStart = monthStarts[0];
  const endExclusive = monthRange(monthStarts[monthStarts.length - 1]).endExclusive;

  return withUserDb(async (tx) => {
    const rows = await tx.execute<{
      month_key: string;
      income_cents: string;
      expense_cents: string;
    }>(sql`
      select
        substr(occurred_at, 1, 7) as month_key,
        coalesce(sum(amount_cents) filter (where kind = 'income'), 0) as income_cents,
        coalesce(sum(amount_cents) filter (where kind = 'expense'), 0) as expense_cents
      from transactions
      where occurred_at >= ${sixMonthStart} and occurred_at < ${endExclusive}
      group by substr(occurred_at, 1, 7)
    `);

    const byMonthKey = new Map(rows.map((row) => [row.month_key, row]));

    // A `YYYY-MM-01` start shares its `YYYY-MM` prefix with the grouped key.
    return monthStarts.map((monthStart) => {
      const row = byMonthKey.get(monthStart.slice(0, 7));
      return {
        monthStart,
        incomeCents: Number(row?.income_cents ?? 0),
        expenseCents: Number(row?.expense_cents ?? 0),
      };
    });
  });
}
