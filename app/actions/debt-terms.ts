"use server";

import { refresh } from "next/cache";

import { deleteDebtTerms, upsertDebtTerms } from "@/db/queries/debt-terms";
import { pgErrorCode } from "@/lib/db-error";
import { ActionError } from "@/lib/errors";
import { parsePesos, pesosToCents } from "@/lib/money";
import { authActionClient } from "@/lib/safe-action";
import {
  debtTermsSchema,
  deleteDebtTermsSchema,
  percentToFraction,
} from "@/lib/validation/debt-terms";

// A peso amount arrives as a Zod-validated string; turning it into integer cents
// here can only fail if the schema let something through it should not have, so a
// null parse is `errors.unexpected`, not a field message.
function toCents(amount: string): number {
  const pesos = parsePesos(amount);
  if (pesos === null) throw new ActionError("errors.unexpected");
  return pesosToCents(pesos);
}

// The `assert_debt_terms_liability` trigger raises 23514 when the account is not
// a liability; a missing account trips its foreign key; a denied write reads the
// same as terms that were never there. No scope is resolved — the account gates it.
function mapDebtTermsError(error: unknown): never {
  const code = pgErrorCode(error);
  if (code === "42501") throw new ActionError("errors.notFound");
  if (code === "23514") throw new ActionError("debts.errors.notLiability");
  if (code === "23503") throw new ActionError("errors.accountInUse");
  throw error;
}

/**
 * Writes or rewrites the debt profile of a liability account (RF-78, RF-80). The
 * scope comes from the account through RLS, so no owner or group travels here;
 * the rate and the minimum percentage convert to their DB fractions.
 */
export const saveDebtTermsAction = authActionClient
  .inputSchema(debtTermsSchema)
  .action(
    async ({
      parsedInput: {
        accountId,
        debtKind,
        annualRate,
        minimumPayment,
        minimumPaymentPct,
        creditLimit,
        statementCutOffDay,
        paymentDueDay,
        aval,
      },
    }) => {
      let savedAccountId: string;
      try {
        ({ accountId: savedAccountId } = await upsertDebtTerms({
          accountId,
          debtKind,
          annualRate: percentToFraction(annualRate),
          minimumPaymentCents: minimumPayment != null ? toCents(minimumPayment) : null,
          minimumPaymentPct: minimumPaymentPct != null ? percentToFraction(minimumPaymentPct) : null,
          creditLimitCents: creditLimit != null ? toCents(creditLimit) : null,
          statementCutOffDay: statementCutOffDay ?? null,
          paymentDueDay: paymentDueDay ?? null,
          avalCents: aval != null ? toCents(aval) : null,
        }));
      } catch (error) {
        mapDebtTermsError(error);
      }

      refresh();
      return { accountId: savedAccountId };
    },
  );

// A denied or absent profile reports as no row (RF-78).
export const deleteDebtTermsAction = authActionClient
  .inputSchema(deleteDebtTermsSchema)
  .action(async ({ parsedInput: { accountId } }) => {
    const deleted = await deleteDebtTerms({ accountId });
    if (!deleted) throw new ActionError("errors.notFound");

    refresh();
  });
