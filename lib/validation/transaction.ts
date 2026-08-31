import { z } from "zod";

import { isCivilDate, todayInBogota } from "@/lib/dates";
import { MAX_AMOUNT_PESOS, parsePesos, pesosToCents } from "@/lib/money";

// A peso string travels through validation unparsed: the amount stays a
// string the form owns until the action turns it into integer cents. Exported
// so every money field across the ledger, budgets and goals shares one parse.
export function pesoAmountSchema(keys: {
  required: string;
  invalid: string;
  tooLarge: string;
}) {
  return z.string().superRefine((value, ctx) => {
    if (value.trim().length === 0) {
      ctx.addIssue(keys.required);
      return;
    }

    const pesos = parsePesos(value);
    if (pesos === null) {
      ctx.addIssue(keys.invalid);
      return;
    }

    if (pesos > MAX_AMOUNT_PESOS) {
      ctx.addIssue(keys.tooLarge);
    }
  });
}

const transactionAmountSchema = pesoAmountSchema({
  required: "transactions.errors.amountRequired",
  invalid: "transactions.errors.amountInvalid",
  tooLarge: "transactions.errors.amountTooLarge",
});

const splitAmountSchema = pesoAmountSchema({
  required: "transactions.errors.splitAmountRequired",
  invalid: "transactions.errors.splitAmountInvalid",
  tooLarge: "transactions.errors.splitAmountTooLarge",
});

// The source and destination stay nullable: income names only a destination,
// expense only a source, a transfer both (RF-20). The kind is derived from
// which is null, never sent.
export const accountRefSchema = z
  .uuid({ error: "transactions.errors.accountInvalid" })
  .nullable();

// The date the movement occurred; it can be past or today, never future,
// compared as a YYYY-MM-DD string end to end (RNF-06). Exported so a planned
// payment's settlement date shares the same not-future rule.
export const occurredAtSchema = z.string().superRefine((value, ctx) => {
  if (value.trim().length === 0) {
    ctx.addIssue("transactions.errors.dateRequired");
    return;
  }

  if (!isCivilDate(value)) {
    ctx.addIssue("transactions.errors.dateInvalid");
    return;
  }

  if (value > todayInBogota()) {
    ctx.addIssue("transactions.errors.dateInFuture");
  }
});

const splitSchema = z.object({
  categoryId: z.uuid({ error: "transactions.errors.splitCategoryInvalid" }),
  amount: splitAmountSchema,
});

export const transactionFields = {
  fromAccountId: accountRefSchema,
  toAccountId: accountRefSchema,
  amount: transactionAmountSchema,
  occurredAt: occurredAtSchema,
  description: z
    .string()
    .trim()
    .max(200, { error: "transactions.errors.descriptionTooLong" })
    .nullable(),
  externalRef: z
    .string()
    .trim()
    .max(200, { error: "transactions.errors.externalRefTooLong" })
    .optional(),
  splits: z.array(splitSchema),
  labelIds: z.array(z.uuid({ error: "transactions.errors.labelInvalid" })),
};

type TransactionFields = {
  fromAccountId: string | null;
  toAccountId: string | null;
  amount: string;
  splits: { categoryId: string; amount: string }[];
};

// At least one account, so income and expense stay one-sided and a transfer
// keeps both (RF-20). Typed on the account pair alone so a planned payment,
// which carries no splits, reuses the very same refinement.
export function requireAnAccount(
  data: { fromAccountId: string | null; toAccountId: string | null },
  ctx: z.RefinementCtx,
) {
  if (data.fromAccountId === null && data.toAccountId === null) {
    ctx.addIssue({
      code: "custom",
      message: "transactions.errors.accountRequired",
      path: ["fromAccountId"],
    });
  }
}

// The kind the split rule keys off is the same one the DB generates: income
// when `from` is null, expense when `to` is null, else transfer (RF-69). An
// income or expense splits into rows summing to its amount in cents; a
// transfer carries none.
export function refineSplits(data: TransactionFields, ctx: z.RefinementCtx) {
  const isTransfer = data.fromAccountId !== null && data.toAccountId !== null;

  if (isTransfer) {
    if (data.splits.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "transactions.errors.splitsForbidden",
        path: ["splits"],
      });
    }
    return;
  }

  if (data.splits.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "transactions.errors.splitsRequired",
      path: ["splits"],
    });
    return;
  }

  const amountPesos = parsePesos(data.amount);
  if (amountPesos === null) return;

  let sumCents = 0;
  for (const split of data.splits) {
    const pesos = parsePesos(split.amount);
    if (pesos === null) return;
    sumCents += pesosToCents(pesos);
  }

  if (sumCents !== pesosToCents(amountPesos)) {
    ctx.addIssue({
      code: "custom",
      message: "transactions.errors.splitsSumMismatch",
      path: ["splits"],
    });
  }
}

// The scope (personal or group) is resolved from the accounts by the DB
// trigger, so it never travels in the payload.
export const createTransactionSchema = z
  .object(transactionFields)
  .superRefine(requireAnAccount)
  .superRefine(refineSplits);

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const updateTransactionSchema = z
  .object({ transactionId: z.uuid(), ...transactionFields })
  .superRefine(requireAnAccount)
  .superRefine(refineSplits);

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

export const deleteTransactionSchema = z.object({
  transactionId: z.uuid(),
});

export type DeleteTransactionInput = z.infer<typeof deleteTransactionSchema>;
