import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { debtStatements } from "@/db/schema";
import type { DebtStatement } from "@/db/schema";
import { withUserDb } from "@/db/session";
import { nextDayOfMonthOnOrAfter, priorCutOffDates, todayInBogota } from "@/lib/dates";

/**
 * Fills the past cut-offs the account has not yet snapshotted and returns how many
 * it inserted (RF-84). ONE `withUserDb`: read the terms and the account's last
 * closed statement, enumerate the cut-off dates from there to today, then insert
 * one snapshot per missing cut-off in a single statement. Each snapshot freezes
 * the balance to `initial_balance_cents +` the signed movement sum windowed to
 * `occurred_at <= cut_off_date` — the same signed sum `account_balances` derives,
 * never a stored running column. The unique key makes a re-run or a concurrent
 * run a no-op, so nothing is ever rewritten (the snapshot is immutable).
 */
export async function materialiseDueStatements(accountId: string): Promise<number> {
  const today = todayInBogota();

  return withUserDb(async (tx) => {
    const [terms] = await tx.execute<{
      statement_cut_off_day: number | null;
      payment_due_day: number | null;
      initial_balance_on: string;
      last_cut_off: string | null;
    }>(sql`
      select
        dt.statement_cut_off_day,
        dt.payment_due_day,
        a.initial_balance_on,
        (select max(s.cut_off_date) from debt_statements s where s.account_id = ${accountId}) as last_cut_off
      from debt_terms dt
      join accounts a on a.id = dt.account_id
      where dt.account_id = ${accountId}
    `);

    // No terms, or no cut-off/due schedule: there is nothing to materialise.
    if (!terms || terms.statement_cut_off_day === null || terms.payment_due_day === null) {
      return 0;
    }

    // The last stored cut-off anchors the walk; before any statement the opening date does.
    const fromExclusive = terms.last_cut_off ?? terms.initial_balance_on;
    const cutOffs = priorCutOffDates(terms.statement_cut_off_day, fromExclusive, today);
    if (cutOffs.length === 0) return 0;

    // A period starts the day after the previous cut-off; the first has none, so
    // it opens on the opening date. The due date follows each cut-off's own day.
    const prevs = cutOffs.map((_, index) =>
      index === 0 ? terms.last_cut_off : cutOffs[index - 1],
    );
    const dues = cutOffs.map((cutOff) =>
      nextDayOfMonthOnOrAfter(terms.payment_due_day as number, cutOff),
    );

    const inserted = await tx.execute<{ id: string }>(sql`
      insert into debt_statements
        (account_id, period_start, cut_off_date, payment_due_date,
         statement_balance_cents, minimum_payment_cents, interest_estimate_cents)
      select
        ${accountId},
        coalesce(g.prev + 1, a.initial_balance_on),
        g.cut_off,
        g.payment_due,
        bal.statement_balance,
        case
          when dt.minimum_payment_cents is not null then dt.minimum_payment_cents
          when dt.minimum_payment_pct is not null
            then round(abs(bal.statement_balance) * dt.minimum_payment_pct)::bigint
          else 0
        end,
        round(abs(bal.statement_balance) * (power(1 + dt.annual_rate, 1.0/12) - 1))::bigint
      from unnest(${cutOffs}::date[], ${prevs}::date[], ${dues}::date[])
        as g(cut_off, prev, payment_due)
      cross join debt_terms dt
      join accounts a on a.id = dt.account_id
      cross join lateral (
        select a.initial_balance_cents
          + coalesce((select sum(t.amount_cents) from transactions t
              where t.to_account_id = ${accountId} and t.occurred_at <= g.cut_off), 0)
          - coalesce((select sum(t.amount_cents) from transactions t
              where t.from_account_id = ${accountId} and t.occurred_at <= g.cut_off), 0)
          as statement_balance
      ) bal
      where dt.account_id = ${accountId}
      on conflict (account_id, cut_off_date) do nothing
      returning id
    `);

    return inserted.length;
  });
}

// The statement history, newest first, read through the generator so a due but
// unmaterialised period is present before the read (RF-84).
export async function listStatements(accountId: string): Promise<DebtStatement[]> {
  await materialiseDueStatements(accountId);

  return withUserDb(async (tx) =>
    tx
      .select()
      .from(debtStatements)
      .where(eq(debtStatements.accountId, accountId))
      .orderBy(desc(debtStatements.cutOffDate)),
  );
}

export type CurrentStatement = {
  accountId: string;
  periodStart: string;
  balanceCents: number;
  minimumPaymentCents: number;
  nextCutOffDate: string | null;
  nextDueDate: string | null;
};

/**
 * The open period's live figures, computed on the fly and never persisted (RF-84):
 * the period opens the day after the last closed cut-off (the opening date before
 * any statement), the balance is the current derived one from `account_balances`,
 * and the minimum is derived on it. The next cut-off and due dates come from the
 * stored days. Null when the account carries no terms.
 */
export async function getCurrentStatement(
  accountId: string,
): Promise<CurrentStatement | null> {
  const today = todayInBogota();

  return withUserDb(async (tx) => {
    const [row] = await tx.execute<{
      period_start: string;
      balance_cents: string;
      minimum_payment_cents: string;
      statement_cut_off_day: number | null;
      payment_due_day: number | null;
    }>(sql`
      select
        coalesce(
          (select max(s.cut_off_date) + 1 from debt_statements s where s.account_id = ${accountId}),
          a.initial_balance_on
        ) as period_start,
        b.balance_cents,
        case
          when dt.minimum_payment_cents is not null then dt.minimum_payment_cents
          when dt.minimum_payment_pct is not null
            then round(abs(b.balance_cents) * dt.minimum_payment_pct)::bigint
          else 0
        end as minimum_payment_cents,
        dt.statement_cut_off_day,
        dt.payment_due_day
      from debt_terms dt
      join accounts a on a.id = dt.account_id
      join account_balances b on b.id = dt.account_id
      where dt.account_id = ${accountId}
    `);

    if (!row) return null;

    return {
      accountId,
      periodStart: row.period_start,
      // A bigint arrives from the driver as a string; the ledger keeps cents a number.
      balanceCents: Number(row.balance_cents),
      minimumPaymentCents: Number(row.minimum_payment_cents),
      nextCutOffDate:
        row.statement_cut_off_day === null
          ? null
          : nextDayOfMonthOnOrAfter(row.statement_cut_off_day, today),
      nextDueDate:
        row.payment_due_day === null
          ? null
          : nextDayOfMonthOnOrAfter(row.payment_due_day, today),
    };
  });
}
