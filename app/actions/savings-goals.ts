"use server";

import { refresh } from "next/cache";

import { getUserGroup } from "@/db/queries/groups";
import {
  addGoalContribution,
  archiveGoal,
  createGoal,
  deleteGoal,
  removeGoalContribution,
  restoreGoal,
  updateGoal,
} from "@/db/queries/savings-goals";
import { pgErrorCode } from "@/lib/db-error";
import { ActionError } from "@/lib/errors";
import { parsePesos, pesosToCents } from "@/lib/money";
import { authActionClient } from "@/lib/safe-action";
import {
  archiveGoalSchema,
  contributeGoalSchema,
  createGoalSchema,
  deleteGoalSchema,
  removeGoalContributionSchema,
  restoreGoalSchema,
  updateGoalSchema,
} from "@/lib/validation/savings-goal";

// The amount arrives as a Zod-validated peso string; parsing it into cents here
// can only fail if the schema let something through it should not have.
function toCents(amount: string): number {
  const pesos = parsePesos(amount);
  if (pesos === null) throw new ActionError("errors.unexpected");
  return pesosToCents(pesos);
}

// A scope mismatch on the goal's account, or on a contributed movement, raises
// 23514; a missing account or movement trips a foreign key; a denied write
// reads the same as a goal that was never there.
function mapGoalError(error: unknown): never {
  const code = pgErrorCode(error);
  if (code === "42501") throw new ActionError("errors.notFound");
  if (code === "23514") throw new ActionError("goals.errors.scopeViolation");
  if (code === "23503") throw new ActionError("errors.notFound");
  throw error;
}

/**
 * Creates a savings goal (RF-76). The scope follows the named account when the
 * caller belongs to a group, otherwise their personal set; the account, when
 * given, must share it.
 */
export const createGoalAction = authActionClient
  .inputSchema(createGoalSchema)
  .action(
    async ({
      parsedInput: { targetAmount, targetDate, accountId, initialContribution, ...goal },
      ctx,
    }) => {
      const targetAmountCents = toCents(targetAmount);
      const initialContributionCents =
        initialContribution != null ? toCents(initialContribution) : null;

      const group = await getUserGroup();
      const scope = group
        ? { ownerUserId: null, groupId: group.id }
        : { ownerUserId: ctx.user.id, groupId: null };

      let goalId: string;
      try {
        ({ goalId } = await createGoal({
          ...goal,
          ...scope,
          targetAmountCents,
          targetDate: targetDate ?? null,
          accountId: accountId ?? null,
          initialContributionCents,
        }));
      } catch (error) {
        mapGoalError(error);
      }

      refresh();
      return { goalId };
    },
  );

/**
 * Rewrites a goal's editable fields (RF-76). The scope is immutable and never
 * travels in the payload, so a denied edit reports as no row.
 */
export const updateGoalAction = authActionClient
  .inputSchema(updateGoalSchema)
  .action(async ({ parsedInput: { targetAmount, targetDate, accountId, ...goal } }) => {
    const targetAmountCents = toCents(targetAmount);

    let updated: boolean;
    try {
      updated = await updateGoal({
        ...goal,
        targetAmountCents,
        targetDate: targetDate ?? null,
        accountId: accountId ?? null,
      });
    } catch (error) {
      mapGoalError(error);
    }

    if (!updated) throw new ActionError("errors.notFound");

    refresh();
  });

/**
 * Archives a savings goal (RF-120). The scope is not re-derived: the goal already
 * carries its own, so the update policy decides, and a row it filters reports as
 * no row — the same as a goal that was never there.
 */
export const archiveGoalAction = authActionClient
  .inputSchema(archiveGoalSchema)
  .action(async ({ parsedInput: { goalId } }) => {
    const archived = await archiveGoal({ goalId });
    if (!archived) throw new ActionError("errors.notFound");

    refresh();
  });

// Restoring passes the same USING that archived it, so it refuses on the same terms.
export const restoreGoalAction = authActionClient
  .inputSchema(restoreGoalSchema)
  .action(async ({ parsedInput: { goalId } }) => {
    const restored = await restoreGoal({ goalId });
    if (!restored) throw new ActionError("errors.notFound");

    refresh();
  });

export const deleteGoalAction = authActionClient
  .inputSchema(deleteGoalSchema)
  .action(async ({ parsedInput: { goalId } }) => {
    const deleted = await deleteGoal({ goalId });
    if (!deleted) throw new ActionError("errors.notFound");

    refresh();
  });

/**
 * Adds a typed virtual aporte toward a goal (RF-87). The entry earmarks no
 * movement, so only the amount crosses, as a peso string.
 */
export const contributeGoalAction = authActionClient
  .inputSchema(contributeGoalSchema)
  .action(async ({ parsedInput: { goalId, amount } }) => {
    const amountCents = toCents(amount);

    let contributionId: string;
    try {
      ({ contributionId } = await addGoalContribution({ goalId, amountCents }));
    } catch (error) {
      mapGoalError(error);
    }

    refresh();
    return { contributionId };
  });

// A false row count is a contribution that was denied or already gone (RF-87).
export const removeGoalContributionAction = authActionClient
  .inputSchema(removeGoalContributionSchema)
  .action(async ({ parsedInput: { contributionId } }) => {
    const removed = await removeGoalContribution({ contributionId });
    if (!removed) throw new ActionError("errors.notFound");

    refresh();
  });
