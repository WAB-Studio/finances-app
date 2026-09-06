import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { debtStatements } from "@/db/schema";
import type { DebtStatement } from "@/db/schema";
import { withUserDb } from "@/db/session";
import { nextDayOfMonthOnOrAfter, priorCutOffDates, todayInBogota } from "@/lib/dates";

/**
 * Fills the past cut-offs the account has not yet snapshotted and returns how many
 * it inserted (RF-84). ONE `withUserDb`: read the terms, the account's last closed
 * statement and whether the caller may write the account, enumerate the cut-off
 * dates from there to today, then insert one snapshot per missing cut-off in a
 * single statement. Each snapshot freezes the balance to `initial_balance_cents +`
 * the signed movement sum windowed to `occurred_at <= cut_off_date` — the same
 * signed sum `account_balances` derives, never a stored running column. The unique
 * key makes a re-run or a concurrent run a no-op, so nothing is ever rewritten
 * (the snapshot is immutable).
 *
 * It writes under the caller's own session, so a member who may read the account
 * but not write it would take a 42501 for merely opening its history. The write
 * privilege rides the statement that already reads the terms — no round trip is
 * added — and the INSERT is never attempted when it is false.
 */
export async function materialiseDueStatements(accountId: string): Promise<number> {
  const today = todayInBogota();

  return withUserDb(async (tx) => {
    const [terms] = await tx.execute<{
      statement_cut_off_day: number | null;
      payment_due_day: number | null;
      initial_balance_on: string;
      last_cut_off: string | null;
      may_write: boolean;
    }>(sql`
      select
        dt.statement_cut_off_day,
        dt.payment_due_day,
        a.initial_balance_on,
        (select max(s.cut_off_date) from debt_statements s where s.account_id = ${accountId}) as last_cut_off,
        private.can_write_account(${accountId}::uuid) as may_write
      from debt_terms dt
      join accounts a on a.id = dt.account_id
      where dt.account_id = ${accountId}
    `);

    // No terms, or no cut-off/due schedule: there is nothing to materialise.
    if (!terms || terms.statement_cut_off_day === null || terms.payment_due_day === null) {
      return 0;
    }

    // A reader who may not write the account gets the snapshots already stored,
    // not a refusal for opening the history (RF-58).
    if (!terms.may_write) return 0;

    // The last stored cut-off anchors the walk; before any statement the opening date does.
    const fromExclusive = terms.last_cut_off ?? terms.initial_balance_on;
    const cutOffs = priorCutOffDates(terms.statement_cut_off_day, fromExclusive, today);
    if (cutOffs.length === 0) return 0;

    // A period starts the day after the previous cut-off; the first has none, so
    // it opens on the opening date. The due date follows each cut-off's own day.
    // One JSON parameter carries the three dates per period: drizzle expands a JS
    // array in a template into a comma-separated list, which is a record and not
    // an array, and the driver has no element type to bind one by itself.
    const periods = JSON.stringify(
      cutOffs.map((cutOff, index) => ({
        cut_off: cutOff,
        prev: index === 0 ? terms.last_cut_off : cutOffs[index - 1],
        payment_due: nextDayOfMonthOnOrAfter(terms.payment_due_day as number, cutOff),
      })),
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
      from jsonb_to_recordset(${periods}::jsonb)
        as g(cut_off date, prev date, payment_due date)
      cross join debt_terms dt
      join accounts a on a.id = dt.account_id
      -- The cut is in the currency the card bills in, so each leg lands the way the
      -- balances view lands it (RF-121, RF-124): its own amount while it was spent
      -- in that currency, what the issuer billed once a confirmed second amount
      -- says so, and nothing while that figure is still an estimate.
      cross join lateral (
        select a.initial_balance_cents
          + coalesce((select sum(case
                when t.currency = a.settlement_currency then t.amount_cents
                when t.counter_amount_cents is not null and not t.counter_is_estimate
                  then t.counter_amount_cents
                else 0
              end) from transactions t
              where t.to_account_id = ${accountId} and t.occurred_at <= g.cut_off), 0)
          - coalesce((select sum(case
                when t.currency = a.settlement_currency then t.amount_cents
                when t.counter_amount_cents is not null and not t.counter_is_estimate
                  then t.counter_amount_cents
                else 0
              end) from transactions t
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
      -- One balance row per account AND currency: the open period is cut in the
      -- currency the card bills in, and no figure here ever sums two (RF-124).
      join account_balances b
        on b.id = dt.account_id and b.currency = a.settlement_currency
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

export type PendingSettlement = {
  id: string;
  occurredAt: string;
  description: string | null;
  // The currency the purchase happened in, never the account's (RF-121).
  currency: string;
  amountCents: number;
  // What the movement expects to be billed, still marked an estimate (RF-123).
  counterAmountCents: number;
};

/**
 * The card's purchases in another currency the issuer has not billed yet (RF-123):
 * a movement whose `currency` is not the account's settlement currency and whose
 * second amount is still an estimate. ONE round trip.
 *
 * Each row is bounded to the statement period it falls in — the cut-off on or
 * after the purchase, none while the period is still open — and the list leads
 * with the periods already cut, which are the ones a statement can answer for.
 * Nothing is grouped in SQL: the section reads as one list.
 */
export async function listPendingSettlements(
  accountId: string,
): Promise<PendingSettlement[]> {
  return withUserDb(async (tx) => {
    const rows = await tx.execute<{
      id: string;
      occurred_at: string;
      description: string | null;
      currency: string;
      amount_cents: string;
      counter_amount_cents: string;
    }>(sql`
      select
        t.id,
        t.occurred_at,
        t.description,
        t.currency,
        t.amount_cents,
        t.counter_amount_cents
      from accounts a
      join transactions t
        on t.from_account_id = a.id or t.to_account_id = a.id
      left join lateral (
        select min(s.cut_off_date) as cut_off_date
        from debt_statements s
        where s.account_id = a.id and s.cut_off_date >= t.occurred_at
      ) p on true
      where a.id = ${accountId}
        and a.kind = 'liability'
        and t.currency <> a.settlement_currency
        and t.counter_is_estimate
      order by p.cut_off_date asc nulls last, t.occurred_at desc, t.id
    `);

    return rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      description: row.description,
      currency: row.currency,
      // A bigint arrives from the driver as a string; the ledger keeps cents a number.
      amountCents: Number(row.amount_cents),
      counterAmountCents: Number(row.counter_amount_cents),
    }));
  });
}

export type RecordBilledAmountArgs = {
  transactionId: string;
  accountId: string;
  // The currency the caller read the amount in; the guard below refuses any other.
  currency: string;
  billedCents: number;
};

/**
 * Replaces the estimate on one foreign-currency purchase with what the issuer
 * billed (RF-123), in ONE round trip and in place: there is no history of
 * estimates. Clearing the mark is the whole mechanic — `account_balances` reads
 * the flag, so the amount leaves the currency pocket for the settlement one
 * without a single balance being written (RNF-07).
 *
 * The guard rides the same statement: the movement must touch this liability, the
 * account must settle in the currency the amount was read in, and the row must
 * still carry an estimate. False when no row answered — refused by
 * `transactions_update_writable`, already billed, or gone.
 */
export async function recordBilledAmount({
  transactionId,
  accountId,
  currency,
  billedCents,
}: RecordBilledAmountArgs): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      update transactions t
      set counter_amount_cents = ${billedCents}, counter_is_estimate = false
      from accounts a
      where t.id = ${transactionId}
        and a.id = ${accountId}
        and a.kind = 'liability'
        and (t.from_account_id = a.id or t.to_account_id = a.id)
        and a.settlement_currency = ${currency}
        and t.currency <> a.settlement_currency
        and t.counter_is_estimate
      returning t.id
    `);

    return rows.length > 0;
  });
}
