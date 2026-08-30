import { z } from "zod";

import { isCivilDate } from "@/lib/dates";
import { pesoAmountSchema } from "@/lib/validation/transaction";

const nameSchema = z
  .string()
  .trim()
  .min(1, { error: "goals.errors.nameRequired" })
  .max(80, { error: "goals.errors.nameTooLong" });

const targetAmountSchema = pesoAmountSchema({
  required: "goals.errors.targetRequired",
  invalid: "goals.errors.targetInvalid",
  tooLarge: "goals.errors.targetTooLarge",
});

// The day the goal aims to be met; it sits in the future by nature, so no
// not-future bound applies (RF-76).
const targetDateSchema = z
  .string()
  .superRefine((value, ctx) => {
    if (!isCivilDate(value)) {
      ctx.addIssue("goals.errors.targetDateInvalid");
    }
  })
  .nullish();

// The scope follows the account when one is named, else the caller's, resolved
// by the action; it never travels in the payload.
const goalFields = {
  name: nameSchema,
  targetAmount: targetAmountSchema,
  targetDate: targetDateSchema,
  accountId: z.uuid({ error: "goals.errors.accountInvalid" }).nullish(),
};

// An opening virtual aporte seeded at creation (RF-77); optional, same peso rules.
const initialContributionSchema = pesoAmountSchema({
  required: "goals.errors.amountRequired",
  invalid: "goals.errors.amountInvalid",
  tooLarge: "goals.errors.amountTooLarge",
}).nullish();

export const createGoalSchema = z.object({
  ...goalFields,
  initialContribution: initialContributionSchema,
});

export type CreateGoalInput = z.infer<typeof createGoalSchema>;

export const updateGoalSchema = z.object({
  goalId: z.uuid({ error: "goals.errors.goalInvalid" }),
  ...goalFields,
});

export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;

export const deleteGoalSchema = z.object({
  goalId: z.uuid({ error: "goals.errors.goalInvalid" }),
});

export type DeleteGoalInput = z.infer<typeof deleteGoalSchema>;

// A typed virtual aporte toward the goal (RF-77); the entry earmarks no
// movement, so the amount alone crosses as a peso string.
export const contributeGoalSchema = z.object({
  goalId: z.uuid({ error: "goals.errors.goalInvalid" }),
  amount: pesoAmountSchema({
    required: "goals.errors.amountRequired",
    invalid: "goals.errors.amountInvalid",
    tooLarge: "goals.errors.amountTooLarge",
  }),
});

export type ContributeGoalInput = z.infer<typeof contributeGoalSchema>;

export const removeGoalContributionSchema = z.object({
  contributionId: z.uuid({ error: "goals.errors.contributionInvalid" }),
});

export type RemoveGoalContributionInput = z.infer<typeof removeGoalContributionSchema>;
