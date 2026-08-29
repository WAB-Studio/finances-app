import { z } from "zod";

import { isCivilDate, todayInBogota } from "@/lib/dates";
import { MAX_AMOUNT_PESOS, parsePesos } from "@/lib/money";

// The list the screens and both sides of validation read for an account's kind (RF-09).
export const ACCOUNT_KINDS = ["asset", "liability"] as const;

// Where a new account lands: owned by the caller, or held by their group (RF-60).
// The action turns this into the owner/group XOR the schema keeps off the wire.
export const ACCOUNT_PLACEMENTS = ["personal", "group"] as const;

const accountNameSchema = z
  .string()
  .trim()
  .min(1, { error: "accounts.errors.nameRequired" })
  .max(80, { error: "accounts.errors.nameTooLong" });

const accountInstitutionSchema = z
  .string()
  .trim()
  .max(80, { error: "accounts.errors.institutionTooLong" })
  .nullable();

// The opening amount stays a peso string through validation: no sign is
// applied here, since the sign is a property of the account's kind (RF-10).
const accountAmountSchema = z.string().superRefine((value, ctx) => {
  if (value.trim().length === 0) {
    ctx.addIssue("accounts.errors.amountRequired");
    return;
  }

  const pesos = parsePesos(value);
  if (pesos === null) {
    ctx.addIssue("accounts.errors.amountInvalid");
    return;
  }

  if (pesos > MAX_AMOUNT_PESOS) {
    ctx.addIssue("accounts.errors.amountTooLarge");
  }
});

// The date the opening balance is true as of; it can be past or today, never future.
const accountBalanceOnSchema = z.string().superRefine((value, ctx) => {
  if (value.trim().length === 0) {
    ctx.addIssue("accounts.errors.dateRequired");
    return;
  }

  if (!isCivilDate(value)) {
    ctx.addIssue("accounts.errors.dateInvalid");
    return;
  }

  if (value > todayInBogota()) {
    ctx.addIssue("accounts.errors.dateInFuture");
  }
});

export const createAccountSchema = z.object({
  name: accountNameSchema,
  kind: z.enum(ACCOUNT_KINDS, { error: "accounts.errors.kindInvalid" }),
  // The owner or group is resolved from the session, so only the placement travels.
  placement: z.enum(ACCOUNT_PLACEMENTS, { error: "accounts.errors.placementInvalid" }),
  institution: accountInstitutionSchema,
  amount: accountAmountSchema,
  balanceOn: accountBalanceOnSchema,
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

// `kind` and the placement are immutable after creation; only `is_shared` toggles
// whether the group may write a group account.
export const updateAccountSchema = z.object({
  accountId: z.uuid(),
  name: accountNameSchema,
  isShared: z.boolean(),
  institution: accountInstitutionSchema,
  amount: accountAmountSchema,
  balanceOn: accountBalanceOnSchema,
});

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const archiveAccountSchema = z.object({
  accountId: z.uuid(),
});

export type ArchiveAccountInput = z.infer<typeof archiveAccountSchema>;

export const restoreAccountSchema = z.object({
  accountId: z.uuid(),
});

export type RestoreAccountInput = z.infer<typeof restoreAccountSchema>;

export const deleteAccountSchema = z.object({
  accountId: z.uuid(),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
