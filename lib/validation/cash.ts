import { z } from "zod";

import { pesoAmountSchema } from "@/lib/validation/transaction";

// A withdrawal names only its source: the destination is the caller's cash,
// resolved server-side from `cash_mode`, never chosen (RF-68). The amount rides
// the same peso parse the movement form runs, so the server rejects exactly what
// the dialog rejects (RNF-10).
export const withdrawCashSchema = z.object({
  sourceAccountId: z.uuid({ error: "cash.errors.sourceInvalid" }),
  amount: pesoAmountSchema({
    required: "cash.errors.amountRequired",
    invalid: "cash.errors.amountInvalid",
    tooLarge: "cash.errors.amountTooLarge",
  }),
});

export type WithdrawCashInput = z.infer<typeof withdrawCashSchema>;
