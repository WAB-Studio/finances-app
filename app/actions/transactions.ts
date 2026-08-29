"use server";

import { refresh } from "next/cache";

import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from "@/db/queries/transactions";
import type { TransactionSplitInput } from "@/db/queries/transactions";
import { pgErrorCode } from "@/lib/db-error";
import { ActionError } from "@/lib/errors";
import { parsePesos, pesosToCents } from "@/lib/money";
import { authActionClient } from "@/lib/safe-action";
import {
  createTransactionSchema,
  deleteTransactionSchema,
  updateTransactionSchema,
} from "@/lib/validation/transaction";

type SplitInput = { categoryId: string; amount: string };

// The amount and each split arrive as Zod-validated peso strings; turning them
// into integer cents here can only fail if the schema let something through it
// should not have, so a null parse is `errors.unexpected`, not a field message.
function toCents(amount: string): number {
  const pesos = parsePesos(amount);
  if (pesos === null) throw new ActionError("errors.unexpected");
  return pesosToCents(pesos);
}

function toSplitCents(splits: SplitInput[]): TransactionSplitInput[] {
  return splits.map((split) => ({
    categoryId: split.categoryId,
    amountCents: toCents(split.amount),
  }));
}

// The scope, `kind` and `created_by` are the DB's to set, so none travels in the
// payload. The check trigger raises one code, 23514, for every split/scope
// refusal; the foreign key raises 23503 when a named account is gone; a denied
// write raises 42501, which reads the same as a movement that was never there.
function mapTransactionError(error: unknown): never {
  const code = pgErrorCode(error);
  if (code === "42501") throw new ActionError("errors.notFound");
  if (code === "23514") throw new ActionError("transactions.errors.splitsScopeViolation");
  if (code === "23503") throw new ActionError("errors.accountInUse");
  throw error;
}

/**
 * Records a movement (RF-17, RF-25). Which of the two accounts is null decides
 * the kind, which the DB generates; an income or expense carries splits summing
 * to its amount, a transfer none. The scope follows from the accounts, resolved
 * by the trigger and never sent.
 */
export const createTransactionAction = authActionClient
  .inputSchema(createTransactionSchema)
  .action(async ({ parsedInput: { amount, splits, externalRef, ...movement } }) => {
    const amountCents = toCents(amount);
    const splitCents = toSplitCents(splits);

    let transactionId: string;
    try {
      ({ transactionId } = await createTransaction({
        ...movement,
        amountCents,
        externalRef: externalRef ?? null,
        splits: splitCents,
      }));
    } catch (error) {
      mapTransactionError(error);
    }

    refresh();
    return { transactionId };
  });

/**
 * Rewrites a movement's editable fields and replaces its splits and labels
 * (RF-24). `external_ref` is immutable, so it is absent from the input; a denied
 * edit reports as no row, the same as a movement that was never there.
 */
export const updateTransactionAction = authActionClient
  .inputSchema(updateTransactionSchema)
  .action(async ({ parsedInput: { amount, splits, ...movement } }) => {
    const amountCents = toCents(amount);
    const splitCents = toSplitCents(splits);

    let updated: boolean;
    try {
      updated = await updateTransaction({ ...movement, amountCents, splits: splitCents });
    } catch (error) {
      mapTransactionError(error);
    }

    if (!updated) throw new ActionError("errors.notFound");

    refresh();
  });

// The cascade removes the splits and label joins; a false row count is a denied
// or absent movement (RF-24).
export const deleteTransactionAction = authActionClient
  .inputSchema(deleteTransactionSchema)
  .action(async ({ parsedInput: { transactionId } }) => {
    const deleted = await deleteTransaction({ transactionId });
    if (!deleted) throw new ActionError("errors.notFound");

    refresh();
  });
