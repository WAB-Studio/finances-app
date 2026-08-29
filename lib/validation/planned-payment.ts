import { z } from "zod";

import { isCivilDate } from "@/lib/dates";
import {
  accountRefSchema,
  occurredAtSchema,
  pesoAmountSchema,
  requireAnAccount,
} from "@/lib/validation/transaction";

const amountSchema = pesoAmountSchema({
  required: "plannedPayments.errors.amountRequired",
  invalid: "plannedPayments.errors.amountInvalid",
  tooLarge: "plannedPayments.errors.amountTooLarge",
});

// The day the payment falls due; unlike a movement it may sit in the future,
// so no not-future bound applies (RF-74).
const dueDateSchema = z.string().superRefine((value, ctx) => {
  if (value.trim().length === 0) {
    ctx.addIssue("plannedPayments.errors.dueDateRequired");
    return;
  }

  if (!isCivilDate(value)) {
    ctx.addIssue("plannedPayments.errors.dueDateInvalid");
  }
});

// When to be reminded; optional, and never after the due date it precedes.
const remindOnSchema = z
  .string()
  .superRefine((value, ctx) => {
    if (!isCivilDate(value)) {
      ctx.addIssue("plannedPayments.errors.remindOnInvalid");
    }
  })
  .nullish();

const descriptionSchema = z
  .string()
  .trim()
  .max(200, { error: "plannedPayments.errors.descriptionTooLong" })
  .nullish();

// A reminder that lands after the due date it belongs to would fire too late.
function requireRemindOnBeforeDue(
  data: { dueDate: string; remindOn?: string | null },
  ctx: z.RefinementCtx,
) {
  if (data.remindOn != null && data.remindOn > data.dueDate) {
    ctx.addIssue({
      code: "custom",
      message: "plannedPayments.errors.remindOnAfterDue",
      path: ["remindOn"],
    });
  }
}

// The scope and `created_by` follow the accounts, set by the
// `set_planned_payment_scope` trigger and never sent; `status` and the settled
// movement are the settle/cancel paths' to write, so neither travels here.
const plannedPaymentFields = {
  fromAccountId: accountRefSchema,
  toAccountId: accountRefSchema,
  amount: amountSchema,
  categoryId: z.uuid({ error: "plannedPayments.errors.categoryInvalid" }).nullish(),
  dueDate: dueDateSchema,
  remindOn: remindOnSchema,
  description: descriptionSchema,
};

export const createPlannedPaymentSchema = z
  .object(plannedPaymentFields)
  .superRefine(requireAnAccount)
  .superRefine(requireRemindOnBeforeDue);

export type CreatePlannedPaymentInput = z.infer<typeof createPlannedPaymentSchema>;

export const updatePlannedPaymentSchema = z
  .object({
    plannedPaymentId: z.uuid({ error: "plannedPayments.errors.plannedPaymentInvalid" }),
    ...plannedPaymentFields,
  })
  .superRefine(requireAnAccount)
  .superRefine(requireRemindOnBeforeDue);

export type UpdatePlannedPaymentInput = z.infer<typeof updatePlannedPaymentSchema>;

// Settling records the real movement, so its date obeys the ledger's own
// not-future rule (RF-75).
export const settlePlannedPaymentSchema = z.object({
  plannedPaymentId: z.uuid({ error: "plannedPayments.errors.plannedPaymentInvalid" }),
  occurredAt: occurredAtSchema,
});

export type SettlePlannedPaymentInput = z.infer<typeof settlePlannedPaymentSchema>;

export const cancelPlannedPaymentSchema = z.object({
  plannedPaymentId: z.uuid({ error: "plannedPayments.errors.plannedPaymentInvalid" }),
});

export type CancelPlannedPaymentInput = z.infer<typeof cancelPlannedPaymentSchema>;

export const deletePlannedPaymentSchema = z.object({
  plannedPaymentId: z.uuid({ error: "plannedPayments.errors.plannedPaymentInvalid" }),
});

export type DeletePlannedPaymentInput = z.infer<typeof deletePlannedPaymentSchema>;
