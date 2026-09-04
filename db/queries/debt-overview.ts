import "server-only";

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { DebtTerms } from "@/db/schema";
import { withUserDb } from "@/db/session";
import { todayInBogota } from "@/lib/dates";

export type DebtOverviewRow = {
  accountId: string;
  debtKind: DebtTerms["debtKind"];
  owedCents: number;
  creditLimitCents: number | null;
  availableCreditCents: number | null;
  monthlyInterestCents: number;
  // The fraction 0..1 the interest above is charged at, like `minimum_payment_pct`
  // reads: the screen formats it as a percentage and derives nothing.
  monthlyRatePct: number;
  minimumPaymentCents: number | null;
  nextCutOffDate: string | null;
  nextDueDate: string | null;
  dueInstallmentsCents: number;
};

// The next date on or after `today` whose day-of-month is `dayCol`, clamped to the
// month length — the SQL twin of `nextDayOfMonthOnOrAfter`. A null day yields null:
// both month candidates come out null and the min over nulls is null.
function nextDayOfMonthOnOrAfterSql(dayCol: SQL, today: string): SQL {
  return sql`(
    select min(cand.d)
    from generate_series(
      date_trunc('month', ${today}::date),
      date_trunc('month', ${today}::date) + interval '1 month',
      interval '1 month'
    ) as mstart
    cross join lateral (
      select case when ${dayCol} is null then null else make_date(
        extract(year from mstart)::int,
        extract(month from mstart)::int,
        least(${dayCol}, extract(day from (mstart + interval '1 month - 1 day'))::int)
      ) end as d
    ) cand
    where cand.d >= ${today}::date
  )`;
}

/**
 * Every liability that carries debt terms with its derived figures in ONE round
 * trip (RF-78, RF-79, RNF-09): owed is the magnitude of the balance derived by
 * `account_balances`; the limit rides along for the consolidated sums and
 * available credit nets it against the balance (both null with no limit); the
 * monthly interest is the effective twelfth-root step of the annual rate, NOT
 * the linear `rate/12`, and that step rides along as a rate of its own so the
 * screen states the percentage without dividing anything; the minimum is the
 * fixed amount, or a percentage
 * of the owed, or null; and due installments sum the unpaid lines falling on or
 * before the next due date. No figure is re-summed from a stored balance, and the
 * CALLER folds these rows into the totals — this adds no round trip for them.
 */
export async function getDebtOverview(): Promise<DebtOverviewRow[]> {
  const today = todayInBogota();
  const nextCutOff = nextDayOfMonthOnOrAfterSql(sql`dt.statement_cut_off_day`, today);
  const nextDue = nextDayOfMonthOnOrAfterSql(sql`dt.payment_due_day`, today);

  return withUserDb(async (tx) => {
    const rows = await tx.execute<{
      account_id: string;
      debt_kind: DebtTerms["debtKind"];
      owed_cents: string;
      credit_limit_cents: string | null;
      available_credit_cents: string | null;
      monthly_interest_cents: string;
      monthly_rate_pct: string;
      minimum_payment_cents: string | null;
      next_cut_off_date: string | null;
      next_due_date: string | null;
      due_installments_cents: string;
    }>(sql`
      select
        dt.account_id,
        dt.debt_kind,
        abs(b.balance_cents) as owed_cents,
        dt.credit_limit_cents,
        case when dt.credit_limit_cents is null then null
          else dt.credit_limit_cents - abs(b.balance_cents) end as available_credit_cents,
        round(abs(b.balance_cents) * mr.monthly_rate)::bigint as monthly_interest_cents,
        mr.monthly_rate as monthly_rate_pct,
        case
          when dt.minimum_payment_cents is not null then dt.minimum_payment_cents
          when dt.minimum_payment_pct is not null
            then round(abs(b.balance_cents) * dt.minimum_payment_pct)::bigint
          else null
        end as minimum_payment_cents,
        nc.next_cut_off as next_cut_off_date,
        nd.next_due as next_due_date,
        coalesce((
          select sum(l.amount_cents)
          from installment_lines l
          join installment_plans p on p.id = l.plan_id
          where p.account_id = dt.account_id
            and l.paid_transaction_id is null
            and nd.next_due is not null
            and l.due_date <= nd.next_due
        ), 0) as due_installments_cents
      from debt_terms dt
      join accounts a on a.id = dt.account_id and a.kind = 'liability'
      join account_balances b on b.id = dt.account_id
      cross join lateral (select ${nextCutOff} as next_cut_off) nc
      cross join lateral (select ${nextDue} as next_due) nd
      -- One expression for both readings, so the figure and its rate can never
      -- state different months.
      cross join lateral (select power(1 + dt.annual_rate, 1.0/12) - 1 as monthly_rate) mr
      order by a.name
    `);

    return rows.map((row) => ({
      accountId: row.account_id,
      debtKind: row.debt_kind,
      // A bigint arrives from the driver as a string; the ledger keeps cents a number.
      owedCents: Number(row.owed_cents),
      creditLimitCents:
        row.credit_limit_cents === null ? null : Number(row.credit_limit_cents),
      availableCreditCents:
        row.available_credit_cents === null ? null : Number(row.available_credit_cents),
      monthlyInterestCents: Number(row.monthly_interest_cents),
      monthlyRatePct: Number(row.monthly_rate_pct),
      minimumPaymentCents:
        row.minimum_payment_cents === null ? null : Number(row.minimum_payment_cents),
      nextCutOffDate: row.next_cut_off_date,
      nextDueDate: row.next_due_date,
      dueInstallmentsCents: Number(row.due_installments_cents),
    }));
  });
}

export type DebtCreditTotals = {
  availableCreditCents: number;
  creditLimitCents: number;
};

/**
 * The consolidated credit figures across exactly the liabilities that carry a
 * limit (RF-83, RF-117): each one's limit, and each one's limit less its derived
 * balance. A liability with no limit is skipped, so it neither lifts the summed
 * limit nor drags the summed available down. Folded over the rows `getDebtOverview`
 * already returned, in the pass the caller spends on the other totals — no second
 * round trip, no stored figure, integer cents throughout.
 */
export function sumDebtCreditTotals(rows: DebtOverviewRow[]): DebtCreditTotals {
  return rows.reduce<DebtCreditTotals>(
    (totals, row) => {
      if (row.creditLimitCents === null) return totals;

      return {
        // The statement pairs the two nulls; the fallback only satisfies the type.
        availableCreditCents:
          totals.availableCreditCents + (row.availableCreditCents ?? 0),
        creditLimitCents: totals.creditLimitCents + row.creditLimitCents,
      };
    },
    { availableCreditCents: 0, creditLimitCents: 0 },
  );
}
