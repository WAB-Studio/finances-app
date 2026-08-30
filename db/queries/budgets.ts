import "server-only";

import { eq, sql } from "drizzle-orm";

import { budgets } from "@/db/schema";
import type { Budget } from "@/db/schema";
import { withUserDb } from "@/db/session";
import { periodRange, todayInBogota } from "@/lib/dates";

type BudgetPeriod = Budget["period"];

export type BudgetStatus = {
  id: string;
  name: string | null;
  categoryId: string;
  accountId: string | null;
  labelId: string | null;
  period: BudgetPeriod;
  thresholdPct: number;
  limitCents: number;
  spentCents: number;
  remainingCents: number;
  overThreshold: boolean;
  overspent: boolean;
};

/**
 * Every non-archived budget with its spent and remaining derived in ONE grouped
 * read — never one round trip per budget (RF-72, RNF-09). Spent sums the budget
 * category's expense splits over the budget's own period window, optionally
 * narrowed to the movements touching its account and/or carrying its label; a
 * correlated subselect picks each row's window by its period. The window bounds
 * come from `periodRange` for today, so a stored spent column never exists.
 * Scope is the policy's job: `withUserDb` shows only the caller's readable rows.
 */
export async function listBudgetsWithStatus(): Promise<BudgetStatus[]> {
  const today = todayInBogota();
  const monthly = periodRange("monthly", today);
  const weekly = periodRange("weekly", today);
  const yearly = periodRange("yearly", today);

  return withUserDb(async (tx) => {
    const rows = await tx.execute<{
      id: string;
      name: string | null;
      category_id: string;
      account_id: string | null;
      label_id: string | null;
      period: BudgetPeriod;
      threshold_pct: number;
      limit_cents: string;
      spent_cents: string;
    }>(sql`
      select
        b.id,
        b.name,
        b.category_id,
        b.account_id,
        b.label_id,
        b.period,
        b.threshold_pct,
        b.limit_cents,
        coalesce((
          select sum(s.amount_cents)
          from transaction_splits s
          join transactions t on t.id = s.transaction_id
          where s.category_id = b.category_id
            and t.kind = 'expense'
            and t.occurred_at >= (case b.period
              when 'weekly' then ${weekly.start}
              when 'yearly' then ${yearly.start}
              else ${monthly.start} end)
            and t.occurred_at < (case b.period
              when 'weekly' then ${weekly.endExclusive}
              when 'yearly' then ${yearly.endExclusive}
              else ${monthly.endExclusive} end)
            and (b.account_id is null
              or t.from_account_id = b.account_id or t.to_account_id = b.account_id)
            and (b.label_id is null or exists (
              select 1 from transaction_labels tl
              where tl.transaction_id = t.id and tl.label_id = b.label_id))
        ), 0) as spent_cents
      from budgets b
      where b.archived_at is null
      order by b.name
    `);

    return rows.map((row) => {
      // A bigint sum arrives from the driver as a string; the ledger keeps cents a number.
      const limitCents = Number(row.limit_cents);
      const spentCents = Number(row.spent_cents);

      return {
        id: row.id,
        name: row.name,
        categoryId: row.category_id,
        accountId: row.account_id,
        labelId: row.label_id,
        period: row.period,
        thresholdPct: row.threshold_pct,
        limitCents,
        spentCents,
        remainingCents: limitCents - spentCents,
        // Cross-multiplied so the threshold check stays integer, never a float.
        overThreshold: spentCents * 100 >= limitCents * row.threshold_pct,
        overspent: spentCents > limitCents,
      };
    });
  });
}

// The scope is resolved by the caller (owner XOR group); the category, account
// and label narrowing must share it, which the `assert_budget_scope` trigger checks.
export type CreateBudgetArgs = {
  ownerUserId: string | null;
  groupId: string | null;
  categoryId: string;
  accountId: string | null;
  labelId: string | null;
  period: BudgetPeriod;
  limitCents: number;
  thresholdPct: number;
  name: string | null;
};

export async function createBudget({
  ownerUserId,
  groupId,
  categoryId,
  accountId,
  labelId,
  period,
  limitCents,
  thresholdPct,
  name,
}: CreateBudgetArgs): Promise<{ budgetId: string }> {
  return withUserDb(async (tx) => {
    const [row] = await tx
      .insert(budgets)
      .values({
        ownerUserId,
        groupId,
        categoryId,
        accountId,
        labelId,
        period,
        limitCents,
        thresholdPct,
        name,
      })
      .returning({ id: budgets.id });

    return { budgetId: row.id };
  });
}

// The scope and the category are immutable and absent from the UPDATE grant, so
// an edit only touches these fields; the boolean reports whether the policy admitted it.
export type UpdateBudgetArgs = {
  budgetId: string;
  accountId: string | null;
  labelId: string | null;
  period: BudgetPeriod;
  limitCents: number;
  thresholdPct: number;
  name: string | null;
};

export async function updateBudget({
  budgetId,
  accountId,
  labelId,
  period,
  limitCents,
  thresholdPct,
  name,
}: UpdateBudgetArgs): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(budgets)
      .set({ accountId, labelId, period, limitCents, thresholdPct, name })
      .where(eq(budgets.id, budgetId))
      .returning({ id: budgets.id });

    return rows.length > 0;
  });
}

export async function archiveBudget({
  budgetId,
}: {
  budgetId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(budgets)
      .set({ archivedAt: sql`now()` })
      .where(eq(budgets.id, budgetId))
      .returning({ id: budgets.id });

    return rows.length > 0;
  });
}

export async function deleteBudget({
  budgetId,
}: {
  budgetId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .delete(budgets)
      .where(eq(budgets.id, budgetId))
      .returning({ id: budgets.id });

    return rows.length > 0;
  });
}
