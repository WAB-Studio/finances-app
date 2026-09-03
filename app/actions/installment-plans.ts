"use server";

import { refresh } from "next/cache";

import {
  createInstallmentPlan,
  deleteInstallmentPlan,
  recordDebtPayment,
} from "@/db/queries/installment-plans";
import { addCivilDays, addCivilMonths } from "@/lib/dates";
import { pgErrorCode } from "@/lib/db-error";
import { ActionError } from "@/lib/errors";
import { parsePesos, pesosToCents } from "@/lib/money";
import { authActionClient } from "@/lib/safe-action";
import { percentToFraction } from "@/lib/validation/debt-terms";
import {
  createInstallmentPlanSchema,
  deleteInstallmentPlanSchema,
  recordDebtPaymentSchema,
} from "@/lib/validation/installment-plan";

// A peso amount arrives as a Zod-validated string; turning it into integer cents
// here can only fail if the schema let something through it should not have.
function toCents(amount: string): number {
  const pesos = parsePesos(amount);
  if (pesos === null) throw new ActionError("errors.unexpected");
  return pesosToCents(pesos);
}

// Line `i` (1..n) falls `(i - 1)` steps after the start, a step being a whole
// month (monthly, clamped to month-end so a 31 never rolls past a short month)
// or 14 days (fortnightly) (RF-81).
function scheduleDates(
  startDate: string,
  frequency: "monthly" | "fortnightly",
  count: number,
): string[] {
  return Array.from({ length: count }, (_, index) =>
    frequency === "monthly"
      ? addCivilMonths(startDate, index)
      : addCivilDays(startDate, index * 14),
  );
}

// Splits a cent total evenly into `count` lines, the remainder cents landing one
// each on the earliest lines so the lines sum EXACTLY to the total — no float.
function splitCents(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, index) =>
    index < remainder ? base + 1 : base,
  );
}

// The `assert_installment_plan_account` trigger raises 23514 when the account is
// not a liability; a denied write reads as an absent plan, and a deleted account
// with it — the policy is the account's and runs ahead of any foreign key. 23503
// is the net under that: a reference gone after it was picked. Scope comes from
// the account through RLS, never a payload.
function mapPlanError(error: unknown): never {
  const code = pgErrorCode(error);
  if (code === "42501") throw new ActionError("errors.notFound");
  if (code === "23514") throw new ActionError("installments.errors.notLiability");
  if (code === "23503") throw new ActionError("errors.referenceGone");
  throw error;
}

// The `assert_installment_line_payment` trigger raises 23514 when the settling
// movement does not touch the plan account; a movement into another member's
// account — or into one just deleted — is denied by RLS (42501) and reads as
// absent. 23503 is the net under that: a reference gone after it was picked.
function mapPaymentError(error: unknown): never {
  const code = pgErrorCode(error);
  if (code === "42501") throw new ActionError("errors.notFound");
  if (code === "23514") throw new ActionError("installments.errors.paymentInvalid");
  if (code === "23503") throw new ActionError("errors.referenceGone");
  throw error;
}

/**
 * Schedules an existing liability balance into dated lines (RF-81). The aval is
 * folded into the principal and the sum split evenly across the installments, the
 * remainder cents on the earliest lines, so the lines total `principal + aval`
 * exactly; the down payment is stored as given and never subtracted. The scope
 * comes from the account through RLS, so no owner or group travels here.
 */
export const createInstallmentPlanAction = authActionClient
  .inputSchema(createInstallmentPlanSchema)
  .action(
    async ({
      parsedInput: {
        accountId,
        description,
        principal,
        nInstallments,
        frequency,
        interestRate,
        downPayment,
        aval,
        startDate,
        merchant,
      },
    }) => {
      const principalCents = toCents(principal);
      const avalCents = aval != null ? toCents(aval) : null;
      const scheduledTotal = principalCents + (avalCents ?? 0);

      const dueDates = scheduleDates(startDate, frequency, nInstallments);
      const amounts = splitCents(scheduledTotal, nInstallments);
      const lines = dueDates.map((dueDate, index) => ({
        seq: index + 1,
        dueDate,
        amountCents: amounts[index],
      }));

      let planId: string;
      try {
        ({ planId } = await createInstallmentPlan({
          accountId,
          description: description ?? null,
          principalCents,
          nInstallments,
          frequency,
          interestRate: interestRate != null ? percentToFraction(interestRate) : null,
          downPaymentCents: downPayment != null ? toCents(downPayment) : null,
          avalCents,
          startDate,
          merchant: merchant ?? null,
          lines,
        }));
      } catch (error) {
        mapPlanError(error);
      }

      refresh();
      return { planId };
    },
  );

/**
 * Records a payment that credits a liability from an asset and allocates it
 * oldest-first onto the debt's unpaid lines (RF-16, RF-82). The transfer's scope
 * and kind fall to triggers; deleting the movement later unwinds the allocation
 * on its own, so there is no explicit unlink path.
 */
export const recordDebtPaymentAction = authActionClient
  .inputSchema(recordDebtPaymentSchema)
  .action(async ({ parsedInput: { fromAccountId, toAccountId, amount, occurredAt } }) => {
    const amountCents = toCents(amount);

    let result: { transactionId: string; paidLineIds: string[] };
    try {
      result = await recordDebtPayment({
        fromAccountId,
        toAccountId,
        amountCents,
        occurredAt,
      });
    } catch (error) {
      mapPaymentError(error);
    }

    refresh();
    return { transactionId: result.transactionId, paidLineIds: result.paidLineIds };
  });

// A denied or absent plan reports as no row (RF-81).
export const deleteInstallmentPlanAction = authActionClient
  .inputSchema(deleteInstallmentPlanSchema)
  .action(async ({ parsedInput: { planId } }) => {
    const deleted = await deleteInstallmentPlan({ planId });
    if (!deleted) throw new ActionError("errors.notFound");

    refresh();
  });
