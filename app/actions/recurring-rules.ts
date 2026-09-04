"use server";

import { refresh } from "next/cache";

import {
  createRecurringRule,
  deleteRecurringRule,
  markTransactionReviewed,
  setRecurringRuleActive,
  setRecurringRuleEndDate,
  updateRecurringRule,
} from "@/db/queries/recurring-rules";
import { pgErrorCode } from "@/lib/db-error";
import { ActionError } from "@/lib/errors";
import { parsePesos, pesosToCents } from "@/lib/money";
import { authActionClient } from "@/lib/safe-action";
import {
  createRecurringRuleSchema,
  deleteRecurringRuleSchema,
  markMovementReviewedSchema,
  pauseRecurringRuleSchema,
  resumeRecurringRuleSchema,
  setRecurringRuleEndDateSchema,
  updateRecurringRuleSchema,
} from "@/lib/validation/recurring-rule";

// The amount arrives as a Zod-validated peso string; parsing it into cents here
// can only fail if the schema let something through it should not have.
function toCents(amount: string): number {
  const pesos = parsePesos(amount);
  if (pesos === null) throw new ActionError("errors.unexpected");
  return pesosToCents(pesos);
}

// Weekly advances from `next_run_on` and carries no day anchor; the DB check
// rejects a stray day, so it is dropped before the write.
function dayForFrequency(frequency: string, dayOfMonth?: number | null): number | null {
  return frequency === "weekly" ? null : (dayOfMonth ?? null);
}

// The scope trigger raises 23514 when the account disagrees on scope; a denied
// write reads as an absent rule, and a deleted account lands there too — the
// policy names the accounts, so it refuses before any foreign key. Nothing guards
// the category, so 23503 is the one it left: a category picked from the list and
// deleted before the rule was saved.
function mapRecurringRuleError(error: unknown): never {
  const code = pgErrorCode(error);
  if (code === "42501") throw new ActionError("errors.notFound");
  if (code === "23514") throw new ActionError("recurringRules.errors.scopeViolation");
  if (code === "23503") throw new ActionError("errors.referenceGone");
  throw error;
}

/**
 * Creates a repeating income or expense (RF-29). The scope and `created_by` follow
 * the one account, set by the trigger and never sent; `is_active` starts true and
 * the generator advances `next_run_on` from here.
 */
export const createRecurringRuleAction = authActionClient
  .inputSchema(createRecurringRuleSchema)
  .action(async ({ parsedInput: { amount, frequency, dayOfMonth, description, endsOn, ...rule } }) => {
    const amountCents = toCents(amount);

    let recurringRuleId: string;
    try {
      ({ recurringRuleId } = await createRecurringRule({
        ...rule,
        amountCents,
        frequency,
        dayOfMonth: dayForFrequency(frequency, dayOfMonth),
        description: description ?? null,
        endsOn: endsOn ?? null,
      }));
    } catch (error) {
      mapRecurringRuleError(error);
    }

    refresh();
    return { recurringRuleId };
  });

/**
 * Rewrites a rule's definition (RF-29). `is_active`, `next_run_on` and the end date
 * are the pause/resume and generation paths' to write, so none travels here; a
 * denied edit reports as no row.
 */
export const updateRecurringRuleAction = authActionClient
  .inputSchema(updateRecurringRuleSchema)
  .action(async ({ parsedInput: { amount, frequency, dayOfMonth, description, endsOn, ...rule } }) => {
    const amountCents = toCents(amount);

    let updated: boolean;
    try {
      updated = await updateRecurringRule({
        ...rule,
        amountCents,
        frequency,
        dayOfMonth: dayForFrequency(frequency, dayOfMonth),
        description: description ?? null,
        endsOn: endsOn ?? null,
      });
    } catch (error) {
      mapRecurringRuleError(error);
    }

    if (!updated) throw new ActionError("errors.notFound");

    refresh();
  });

export const deleteRecurringRuleAction = authActionClient
  .inputSchema(deleteRecurringRuleSchema)
  .action(async ({ parsedInput: { id } }) => {
    const deleted = await deleteRecurringRule({ id });
    if (!deleted) throw new ActionError("errors.notFound");

    refresh();
  });

// Pausing keeps the rule and its history; the generator skips it while `is_active`
// is false (RF-32). A false row count is a denied or absent rule.
export const pauseRecurringRuleAction = authActionClient
  .inputSchema(pauseRecurringRuleSchema)
  .action(async ({ parsedInput: { id } }) => {
    const paused = await setRecurringRuleActive({ id, isActive: false });
    if (!paused) throw new ActionError("errors.notFound");

    refresh();
  });

export const resumeRecurringRuleAction = authActionClient
  .inputSchema(resumeRecurringRuleSchema)
  .action(async ({ parsedInput: { id } }) => {
    const resumed = await setRecurringRuleActive({ id, isActive: true });
    if (!resumed) throw new ActionError("errors.notFound");

    refresh();
  });

// Setting or clearing the end date bounds when the rule stops generating (RF-32).
// An end date before the next run trips the check, mapped like any scope refusal.
export const setRecurringRuleEndDateAction = authActionClient
  .inputSchema(setRecurringRuleEndDateSchema)
  .action(async ({ parsedInput: { id, endsOn } }) => {
    let updated: boolean;
    try {
      updated = await setRecurringRuleEndDate({ id, endsOn: endsOn ?? null });
    } catch (error) {
      mapRecurringRuleError(error);
    }

    if (!updated) throw new ActionError("errors.notFound");

    refresh();
  });

/**
 * Confirms a generated movement without touching its amount (RF-31). Correcting a
 * generated amount instead goes through the transaction edit action, which stamps
 * the review as part of that same write. The guard only claims a generated,
 * unreviewed row, so a manual movement is never stamped.
 */
export const markMovementReviewedAction = authActionClient
  .inputSchema(markMovementReviewedSchema)
  .action(async ({ parsedInput: { transactionId } }) => {
    const reviewed = await markTransactionReviewed({ transactionId });
    if (!reviewed) throw new ActionError("errors.notFound");

    refresh();
  });
