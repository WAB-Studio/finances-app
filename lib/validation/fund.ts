import { z } from "zod";

// Messages are catalogue keys, not sentences: the form translates them, and
// the server re-runs these exact schemas on the same input (RNF-10).
export const createFundSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "fund.errors.nameRequired" })
    .max(80, { error: "fund.errors.nameTooLong" }),
  memberName: z
    .string()
    .trim()
    .min(1, { error: "fund.errors.memberNameRequired" })
    .max(80, { error: "fund.errors.memberNameTooLong" }),
});

export type CreateFundInput = z.infer<typeof createFundSchema>;

export const switchFundSchema = z.object({
  fundId: z.uuid({ error: "fund.errors.fundIdInvalid" }),
});

export type SwitchFundInput = z.infer<typeof switchFundSchema>;
