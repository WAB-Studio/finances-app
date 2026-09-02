import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { insertRow } from "@/db/insert-row";
import { goalContributions, savingsGoals, transactions } from "@/db/schema";
import { withUserDb } from "@/db/session";
import { todayInBogota } from "@/lib/dates";
import { TIME_ZONE } from "@/lib/locales";

export type GoalProgress = {
  id: string;
  name: string;
  targetAmountCents: number;
  targetDate: string | null;
  accountId: string | null;
  savedCents: number;
  remainingCents: number;
  reachedTarget: boolean;
  // Whole percent of the meta already set aside, capped at 100.
  progressPct: number;
  // What is left to set aside each month to land on the target date; null when
  // the goal names no date or has already reached its meta.
  requiredMonthlyCents: number | null;
  // Behind the straight line from the day the goal opened to its target date.
  behindPace: boolean;
};

/**
 * Every non-archived goal with its progress in ONE round trip (RF-87, RNF-09):
 * `saved_cents` is read from the `goal_progress` view, which sums the goal's
 * contributions — this never re-sums them itself. Remaining floors at
 * zero so an overshot goal reads as reached, not negative. `archived` swaps the
 * listing onto the archived side (RF-120); the view knows nothing of the flag,
 * so an archived goal's progress keeps deriving from its aportes. Scope is the
 * policy's job: `withUserDb` shows only the caller's readable goals.
 *
 * The pace rides along from the same read, in exact numeric arithmetic and back
 * as integer cents: the monthly figure spreads what remains over the whole months
 * still ahead — at least one, so a goal due this month asks for all of it — and a
 * goal counts as behind when what it has set aside sits under the straight line
 * from the day it opened to the day it is due. Neither is stored (RNF-07).
 */
export async function listGoalsWithProgress(options?: {
  archived?: boolean;
}): Promise<GoalProgress[]> {
  const archivedFilter = options?.archived
    ? sql`g.archived_at is not null`
    : sql`g.archived_at is null`;

  const today = todayInBogota();
  // The goal's own opening day, read in the zone every civil date here is in.
  const openedOn = sql`(g.created_at at time zone ${TIME_ZONE})::date`;

  return withUserDb(async (tx) => {
    const rows = await tx.execute<{
      id: string;
      name: string;
      target_amount_cents: string;
      target_date: string | null;
      account_id: string | null;
      saved_cents: string;
      progress_pct: number;
      required_monthly_cents: string | null;
      behind_pace: boolean;
    }>(sql`
      select
        g.id,
        g.name,
        g.target_amount_cents,
        g.target_date,
        g.account_id,
        gp.saved_cents,
        least(round(gp.saved_cents * 100.0 / g.target_amount_cents), 100)::int
          as progress_pct,
        case
          when g.target_date is null or gp.saved_cents >= g.target_amount_cents
            then null
          else ceil(
            (g.target_amount_cents - gp.saved_cents)::numeric
            / greatest(ceil((g.target_date - ${today}::date) / 30.0), 1)
          )::bigint
        end as required_monthly_cents,
        case
          when g.target_date is null or gp.saved_cents >= g.target_amount_cents
            then false
          -- Cross-multiplied so the comparison stays in exact integers: saved
          -- over the whole span against the meta over the days already spent.
          else gp.saved_cents * greatest(g.target_date - ${openedOn}, 0)
            < g.target_amount_cents * greatest(${today}::date - ${openedOn}, 0)
        end as behind_pace
      from savings_goals g
      join goal_progress gp on gp.goal_id = g.id
      where ${archivedFilter}
      order by g.name
    `);

    return rows.map((row) => {
      // A bigint sum arrives from the driver as a string; the ledger keeps cents a number.
      const targetAmountCents = Number(row.target_amount_cents);
      const savedCents = Number(row.saved_cents);

      return {
        id: row.id,
        name: row.name,
        targetAmountCents,
        targetDate: row.target_date,
        accountId: row.account_id,
        savedCents,
        remainingCents: Math.max(targetAmountCents - savedCents, 0),
        reachedTarget: savedCents >= targetAmountCents,
        progressPct: row.progress_pct,
        requiredMonthlyCents:
          row.required_monthly_cents === null
            ? null
            : Number(row.required_monthly_cents),
        behindPace: row.behind_pace,
      };
    });
  });
}

// The scope is resolved by the caller (owner XOR group).
export type CreateGoalArgs = {
  ownerUserId: string | null;
  groupId: string | null;
  name: string;
  targetAmountCents: number;
  targetDate: string | null;
  accountId: string | null;
  // An opening virtual aporte, seeded in the same transaction as the goal.
  initialContributionCents?: number | null;
};

export async function createGoal({
  ownerUserId,
  groupId,
  name,
  targetAmountCents,
  targetDate,
  accountId,
  initialContributionCents = null,
}: CreateGoalArgs): Promise<{ goalId: string }> {
  return withUserDb(async (tx) => {
    const [row] = await insertRow(
      tx,
      savingsGoals,
      { ownerUserId, groupId, name, targetAmountCents, targetDate, accountId },
      { returning: { id: savingsGoals.id } },
    );

    // The opening aporte rides the goal's own transaction (RNF-09): one round
    // trip to the pooler, and a virtual entry so no movement is earmarked.
    if (initialContributionCents != null) {
      await insertRow(tx, goalContributions, {
        goalId: row.id,
        transactionId: null,
        amountCents: initialContributionCents,
      });
    }

    return { goalId: row.id };
  });
}

// The scope is immutable and absent from the UPDATE grant, so an edit only
// touches these fields; the boolean reports whether the policy admitted it.
export type UpdateGoalArgs = {
  goalId: string;
  name: string;
  targetAmountCents: number;
  targetDate: string | null;
  accountId: string | null;
};

export async function updateGoal({
  goalId,
  name,
  targetAmountCents,
  targetDate,
  accountId,
}: UpdateGoalArgs): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(savingsGoals)
      .set({ name, targetAmountCents, targetDate, accountId })
      .where(eq(savingsGoals.id, goalId))
      .returning({ id: savingsGoals.id });

    return rows.length > 0;
  });
}

// RF-120: archiving keeps the goal and its aportes, so `goal_progress` still
// sums the same rows and no derivation already recorded moves.
export async function archiveGoal({
  goalId,
}: {
  goalId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(savingsGoals)
      .set({ archivedAt: sql`now()` })
      .where(eq(savingsGoals.id, goalId))
      .returning({ id: savingsGoals.id });

    return rows.length > 0;
  });
}

// The update policy scopes by owner-or-group and carries no archived predicate,
// so an archived goal stays inside the same USING that archived it (RF-120).
export async function restoreGoal({
  goalId,
}: {
  goalId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(savingsGoals)
      .set({ archivedAt: null })
      .where(eq(savingsGoals.id, goalId))
      .returning({ id: savingsGoals.id });

    return rows.length > 0;
  });
}

export async function deleteGoal({
  goalId,
}: {
  goalId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .delete(savingsGoals)
      .where(eq(savingsGoals.id, goalId))
      .returning({ id: savingsGoals.id });

    return rows.length > 0;
  });
}

// Adds an aporte toward a goal (RF-87). A null `transactionId` is a virtual
// envelope entry; a movement id earmarks it, and the `assert_goal_contribution_scope`
// trigger checks that movement shares the goal's scope.
export async function addGoalContribution({
  goalId,
  transactionId = null,
  amountCents,
}: {
  goalId: string;
  transactionId?: string | null;
  amountCents: number;
}): Promise<{ contributionId: string }> {
  return withUserDb(async (tx) => {
    const [row] = await insertRow(
      tx,
      goalContributions,
      { goalId, transactionId, amountCents },
      { returning: { id: goalContributions.id } },
    );

    return { contributionId: row.id };
  });
}

// One aporte as the undo list shows it (RF-119). `occurredAt` is the day the
// money was set aside: the movement's own date when the entry earmarks one, and
// the day the entry was written when it earmarks none — every aporte carries one.
// `description` names that movement, and stays null for a virtual entry.
export type GoalContributionRow = {
  id: string;
  amountCents: number;
  transactionId: string | null;
  occurredAt: string;
  description: string | null;
};

/**
 * One goal's aportes, newest first, in ONE round trip (RF-119, RNF-09). The sum
 * of what comes back is the goal's saved amount: `goal_progress` sums these very
 * rows under the same policy, so progress keeps deriving and nothing is stored
 * (RF-87, RNF-07). Scope is the policy's job — `goal_contributions_select_member`
 * admits a row only when its goal is readable, so the goal id narrows the set and
 * never widens it. A movement outside the caller's scope joins as null rather
 * than dropping its aporte, which would break that sum.
 */
export async function listGoalContributions(
  goalId: string,
): Promise<GoalContributionRow[]> {
  // Written out rather than built from the column references: a fragment in a
  // projection renders them unqualified, and both tables carry a `created_at`.
  const occurredAt = sql<string>`coalesce(
    transactions.occurred_at,
    (goal_contributions.created_at at time zone ${TIME_ZONE})::date
  )`;

  return withUserDb(async (tx) => {
    return tx
      .select({
        id: goalContributions.id,
        amountCents: goalContributions.amountCents,
        transactionId: goalContributions.transactionId,
        occurredAt,
        description: transactions.description,
      })
      .from(goalContributions)
      .leftJoin(transactions, eq(transactions.id, goalContributions.transactionId))
      .where(eq(goalContributions.goalId, goalId))
      // Newest first by the day the money was set aside; two aportes of the same
      // day fall back on the instant the row was written, which keeps them stable.
      .orderBy(desc(occurredAt), desc(goalContributions.createdAt));
  });
}

export async function removeGoalContribution({
  contributionId,
}: {
  contributionId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .delete(goalContributions)
      .where(eq(goalContributions.id, contributionId))
      .returning({ id: goalContributions.id });

    return rows.length > 0;
  });
}
