import { z } from "zod";

import { isCivilDate } from "@/lib/dates";
import { rateSchema } from "@/lib/validation/debt-terms";
import {
  occurredAtSchema,
  pesoAmountSchema,
} from "@/lib/validation/transaction";

// The two schedules a plan can follow the same list the DB enum reads (RF-81).
export const INSTALLMENT_FREQUENCIES = ["monthly", "fortnightly"] as const;

const principalSchema = pesoAmountSchema({
  required: "installments.errors.principalRequired",
  invalid: "installments.errors.principalInvalid",
  tooLarge: "installments.errors.principalTooLarge",
});

const downPaymentSchema = pesoAmountSchema({
  required: "installments.errors.downPaymentRequired",
  invalid: "installments.errors.downPaymentInvalid",
  tooLarge: "installments.errors.downPaymentTooLarge",
});

const avalSchema = pesoAmountSchema({
  required: "installments.errors.avalRequired",
  invalid: "installments.errors.avalInvalid",
  tooLarge: "installments.errors.avalTooLarge",
});

// The day the first installment falls; a plan schedules a future balance, so its
// start may sit ahead of today — no not-future bound applies (RF-81).
const startDateSchema = z.string().superRefine((value, ctx) => {
  if (value.trim().length === 0) {
    ctx.addIssue("installments.errors.startDateRequired");
    return;
  }

  if (!isCivilDate(value)) {
    ctx.addIssue("installments.errors.startDateInvalid");
  }
});

// The plan hangs off its account, so `accountId` is the only scope it names; the
// dated line schedule is derived server-side and never travels here.
export const createInstallmentPlanSchema = z.object({
  accountId: z.uuid({ error: "installments.errors.accountInvalid" }),
  description: z
    .string()
    .trim()
    .max(200, { error: "installments.errors.descriptionTooLong" })
    .nullish(),
  principal: principalSchema,
  nInstallments: z
    .number({ error: "installments.errors.installmentsInvalid" })
    .int({ error: "installments.errors.installmentsInvalid" })
    .min(1, { error: "installments.errors.installmentsInvalid" })
    .max(120, { error: "installments.errors.installmentsInvalid" }),
  frequency: z.enum(INSTALLMENT_FREQUENCIES, {
    error: "installments.errors.frequencyInvalid",
  }),
  interestRate: rateSchema({
    required: "installments.errors.rateRequired",
    invalid: "installments.errors.rateInvalid",
  }).nullish(),
  downPayment: downPaymentSchema.nullish(),
  aval: avalSchema.nullish(),
  startDate: startDateSchema,
  merchant: z
    .string()
    .trim()
    .max(120, { error: "installments.errors.merchantTooLong" })
    .nullish(),
});

export type CreateInstallmentPlanInput = z.infer<
  typeof createInstallmentPlanSchema
>;

// A payment credits a liability from an asset (RF-16, RF-82): both accounts are
// required and the date obeys the ledger's own not-future rule. The FIFO
// allocation onto lines is the query's, so no line ids travel here.
export const recordDebtPaymentSchema = z.object({
  fromAccountId: z.uuid({ error: "installments.errors.fromAccountInvalid" }),
  toAccountId: z.uuid({ error: "installments.errors.toAccountInvalid" }),
  amount: pesoAmountSchema({
    required: "installments.errors.amountRequired",
    invalid: "installments.errors.amountInvalid",
    tooLarge: "installments.errors.amountTooLarge",
  }),
  occurredAt: occurredAtSchema,
});

export type RecordDebtPaymentInput = z.infer<typeof recordDebtPaymentSchema>;

export const deleteInstallmentPlanSchema = z.object({
  planId: z.uuid({ error: "installments.errors.planInvalid" }),
});

export type DeleteInstallmentPlanInput = z.infer<
  typeof deleteInstallmentPlanSchema
>;
