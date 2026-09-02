import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { insertRow } from "@/db/insert-row";
import { goalContributions, savingsGoals, transactions } from "@/db/schema";
import { withUserDb } from "@/db/session";

export type GoalProgress = {
  id: string;
  name: string;
  targetAmountCents: number;
  targetDate: string | null;
  accountId: string | null;
  savedCents: number;
  remainingCents: number;
  reachedTarget: boolean;
};

/**
 * Every non-archived goal with its progress in ONE round trip (RF-87, RNF-09):
 * `saved_cents` is read from the `goal_progress` view, which sums the goal's
 * contributions — this never re-sums them itself. Remaining floors at
 * zero so an overshot goal reads as reached, not negative. `archived` swaps the
 * listing onto the archived side (RF-120); the view knows nothing of the flag,
 * so an archived goal's progress keeps deriving from its aportes. Scope is the
 * policy's job: `withUserDb` shows only the caller's readable goals.
 */
export async function listGoalsWithProgress(options?: {
  archived?: boolean;
}): Promise<GoalProgress[]> {
  const archivedFilter = options?.archived
    ? sql`g.archived_at is not null`
    : sql`g.archived_at is null`;

  return withUserDb(async (tx) => {
    const rows = await tx.execute<{
      id: string;
      name: string;
      target_amount_cents: string;
      target_date: string | null;
      account_id: string | null;
      saved_cents: string;
    }>(sql`
      select
        g.id,
        g.name,
        g.target_amount_cents,
        g.target_date,
        g.account_id,
        gp.saved_cents
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

// One aporte as the undo list shows it (RF-119). `occurredAt` and `description`
// come from the movement the entry earmarks; a virtual entry earmarks none and
// leaves both null, since `goal_contributions` carries no date of its own.
export type GoalContributionRow = {
  id: string;
  amountCents: number;
  transactionId: string | null;
  occurredAt: string | null;
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
  return withUserDb(async (tx) => {
    return tx
      .select({
        id: goalContributions.id,
        amountCents: goalContributions.amountCents,
        transactionId: goalContributions.transactionId,
        occurredAt: transactions.occurredAt,
        description: transactions.description,
      })
      .from(goalContributions)
      .leftJoin(transactions, eq(transactions.id, goalContributions.transactionId))
      .where(eq(goalContributions.goalId, goalId))
      // A dated aporte leads in date order; an undated one has nothing to sort
      // by, so `desc` leaves it first and the id keeps the order stable.
      .orderBy(desc(transactions.occurredAt), goalContributions.id);
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
