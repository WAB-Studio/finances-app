"use server";

import { refresh } from "next/cache";

import { z } from "zod";

import {
  createTransaction,
  deleteTransaction,
  getSettlementCurrencies,
  updateTransaction,
} from "@/db/queries/transactions";
import type { TransactionSplitInput } from "@/db/queries/transactions";
import { BASE_CURRENCY, type CurrencyCode } from "@/lib/currency";
import { pgErrorCode } from "@/lib/db-error";
import { ActionError } from "@/lib/errors";
import { parseAmount } from "@/lib/money";
import { authActionClient } from "@/lib/safe-action";
import {
  createTransactionSchema,
  deleteTransactionSchema,
  foreignSettlementCurrency,
  refineSettlement,
  updateTransactionSchema,
} from "@/lib/validation/transaction";

type SplitInput = { categoryId: string; amount: string };

// The amount and each split arrive as Zod-validated strings in the movement's
// own currency; turning them into integers of its minor unit here can only fail
// if the schema let something through it should not have, so a null parse is
// `errors.unexpected`, not a field message.
function toMinor(amount: string, currency: CurrencyCode): number {
  const minor = parseAmount(amount, currency);
  if (minor === null) throw new ActionError("errors.unexpected");
  return minor;
}

function toSplitMinor(
  splits: SplitInput[],
  currency: CurrencyCode,
): TransactionSplitInput[] {
  return splits.map((split) => ({
    categoryId: split.categoryId,
    amountCents: toMinor(split.amount, currency),
  }));
}

// What a movement carries beside its own amount: the second figure, in the
// minor unit of the account that settles elsewhere, and the mark that says a
// statement has not confirmed it yet (RF-122, RF-123).
type CounterAmount = { counterAmountCents: number | null; counterIsEstimate: boolean };

/**
 * Reads the second amount in the currency the accounts declare, never the one
 * the payload claims. The read only happens when there is a second amount to
 * place: a movement in its account's own currency is the common case and pays
 * nothing for this. The rule that decides required-or-forbidden is the very
 * refinement the form runs, against the currencies read back here (RNF-10);
 * what it does not see — a foreign account whose second amount never arrived —
 * the `transactions_verify_currency` trigger refuses on its own.
 */
async function resolveCounterAmount(movement: {
  fromAccountId: string | null;
  toAccountId: string | null;
  currency?: CurrencyCode;
  counterAmount?: string | null;
  counterIsEstimate?: boolean;
}): Promise<CounterAmount> {
  const counter = movement.counterAmount?.trim() ? movement.counterAmount : null;
  if (counter === null) {
    return { counterAmountCents: null, counterIsEstimate: false };
  }

  const settlement = await getSettlementCurrencies(movement);
  const verdict = z
    .custom<typeof movement>()
    .superRefine(refineSettlement(settlement))
    .safeParse(movement);

  if (!verdict.success) throw new ActionError(verdict.error.issues[0].message);

  const foreign = foreignSettlementCurrency(
    movement.currency ?? BASE_CURRENCY,
    settlement,
  );
  if (foreign === null) throw new ActionError("errors.unexpected");

  return {
    counterAmountCents: toMinor(counter, foreign),
    counterIsEstimate: movement.counterIsEstimate ?? false,
  };
}

// `transactions_verify_currency` raises this and nothing else does: a movement
// whose currency does not agree with the accounts it names (migration `0032`).
const CURRENCY_REFUSAL = "23901";

// The scope, `kind` and `created_by` are the DB's to set, so none travels in the
// payload. 23514 is left to what it has always meant here — the split, scope and
// placement triggers, and the column checks; a denied write raises 42501, which
// reads the same as a movement that was never there — an account deleted under
// the open form lands there, since the INSERT policy runs before any foreign key.
// What is left for 23503 is a reference the row names that vanished after it was
// picked.
function mapTransactionError(error: unknown): never {
  const code = pgErrorCode(error);
  if (code === "42501") throw new ActionError("errors.notFound");
  if (code === CURRENCY_REFUSAL) {
    throw new ActionError("transactions.errors.currencyMismatch");
  }
  if (code === "23514") throw new ActionError("transactions.errors.splitsScopeViolation");
  if (code === "23503") throw new ActionError("errors.referenceGone");
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
  .action(async ({ parsedInput }) => {
    // Absent is how a writer hands the choice to the accounts, as the column
    // does; the strings it sent are then the base currency's, which is what
    // every such path has always meant.
    const currency = parsedInput.currency ?? BASE_CURRENCY;
    const counter = await resolveCounterAmount(parsedInput);

    let transactionId: string;
    try {
      ({ transactionId } = await createTransaction({
        fromAccountId: parsedInput.fromAccountId,
        toAccountId: parsedInput.toAccountId,
        amountCents: toMinor(parsedInput.amount, currency),
        currency: parsedInput.currency ?? null,
        ...counter,
        occurredAt: parsedInput.occurredAt,
        description: parsedInput.description,
        externalRef: parsedInput.externalRef ?? null,
        splits: toSplitMinor(parsedInput.splits, currency),
        labelIds: parsedInput.labelIds,
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
  .action(async ({ parsedInput }) => {
    const currency = parsedInput.currency ?? BASE_CURRENCY;
    const counter = await resolveCounterAmount(parsedInput);

    let updated: boolean;
    try {
      updated = await updateTransaction({
        transactionId: parsedInput.transactionId,
        fromAccountId: parsedInput.fromAccountId,
        toAccountId: parsedInput.toAccountId,
        amountCents: toMinor(parsedInput.amount, currency),
        currency: parsedInput.currency ?? null,
        ...counter,
        occurredAt: parsedInput.occurredAt,
        description: parsedInput.description,
        splits: toSplitMinor(parsedInput.splits, currency),
        labelIds: parsedInput.labelIds,
      });
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
