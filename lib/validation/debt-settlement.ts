import { z } from "zod";

import { isCurrencyCode, minorUnitExponent, type CurrencyCode } from "@/lib/currency";
import { maxAmountMinor, parseAmount } from "@/lib/money";

// Every amount is still stored as a hundredth of its major unit, which is the
// minor unit only where the currency carries two decimals: the peso reads a
// hundred times its own until RF-121 back-fills. The two conversions live beside
// the schema, the way `percentToFraction` sits beside the debt terms, so the row's
// form and the action cross the same bridge.
const STORED_EXPONENT = 2;

// A stored figure as an integer in the currency's own minor unit, which is what
// `Money` draws and what `deriveRate` divides.
export function storedToMinor(stored: number, currency: CurrencyCode): number {
  return stored / 10 ** (STORED_EXPONENT - minorUnitExponent(currency));
}

// The way back, for the one column this module writes.
export function minorToStored(minor: number, currency: CurrencyCode): number {
  return minor * 10 ** (STORED_EXPONENT - minorUnitExponent(currency));
}

// The currency the typed amount is read in. It travels with the payload because
// it decides the minor unit, and the write refuses a code the account does not
// settle in — so a client that names another one moves no decimal point.
const settlementCurrencySchema = z
  .string()
  .refine(isCurrencyCode, { error: "accounts.errors.currencyInvalid" });

/**
 * What the issuer billed for one foreign-currency purchase (RF-123): an amount in
 * the minor unit of the account's settlement currency, which replaces the estimate
 * the movement carries. One schema for the row's form and for the action (RNF-10).
 */
export const recordBilledAmountSchema = z
  .object({
    transactionId: z.uuid({ error: "errors.notFound" }),
    accountId: z.uuid({ error: "debts.errors.accountInvalid" }),
    currency: settlementCurrencySchema,
    billedAmount: z.string(),
  })
  .superRefine((data, ctx) => {
    // The currency is what the parse below reads the string in, so a code the
    // runtime does not know has already said everything there is to say.
    if (!isCurrencyCode(data.currency)) return;

    const value = data.billedAmount.trim();
    if (value.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "transactions.errors.counterAmountRequired",
        path: ["billedAmount"],
      });
      return;
    }

    // Zero is not a bill, and `transactions_counter_amount_positive` refuses it.
    const minor = parseAmount(value, data.currency);
    if (minor === null || minor === 0) {
      ctx.addIssue({
        code: "custom",
        message: "transactions.errors.counterAmountInvalid",
        path: ["billedAmount"],
      });
      return;
    }

    if (minor > maxAmountMinor(data.currency)) {
      ctx.addIssue({
        code: "custom",
        message: "transactions.errors.amountTooLarge",
        path: ["billedAmount"],
      });
    }
  });

export type RecordBilledAmountInput = z.infer<typeof recordBilledAmountSchema>;
