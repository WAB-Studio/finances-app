"use server";

import { refresh } from "next/cache";

import {
  archiveAccount,
  createAccount,
  deleteAccount,
  restoreAccount,
  updateAccount,
} from "@/db/queries/accounts";
import { pgErrorCode } from "@/lib/db-error";
import { ActionError } from "@/lib/errors";
import { parsePesos } from "@/lib/money";
import { authActionClient } from "@/lib/safe-action";
import {
  archiveAccountSchema,
  createAccountSchema,
  deleteAccountSchema,
  restoreAccountSchema,
  updateAccountSchema,
} from "@/lib/validation/account";

/**
 * Creates an account (RF-08, RF-09, RF-10). The amount arrives as a
 * Zod-validated peso string; parsing it here can only fail if the schema
 * let something through it should not have.
 */
export const createAccountAction = authActionClient
  .inputSchema(createAccountSchema)
  .action(async ({ parsedInput: { fundId, name, kind, memberId, institution, amount, balanceOn } }) => {
    const pesos = parsePesos(amount);
    if (pesos === null) throw new ActionError("errors.unexpected");

    await createAccount({ fundId, name, kind, memberId, institution, pesos, balanceOn });
    refresh();
  });

/**
 * Updates an account's editable fields. `kind` is immutable, so it is never
 * part of this input (RF-09).
 */
export const updateAccountAction = authActionClient
  .inputSchema(updateAccountSchema)
  .action(async ({ parsedInput: { fundId, accountId, name, memberId, institution, amount, balanceOn } }) => {
    const pesos = parsePesos(amount);
    if (pesos === null) throw new ActionError("errors.unexpected");

    const updated = await updateAccount({
      fundId,
      accountId,
      name,
      memberId,
      institution,
      pesos,
      balanceOn,
    });
    if (!updated) throw new ActionError("errors.notFound");

    refresh();
  });

export const archiveAccountAction = authActionClient
  .inputSchema(archiveAccountSchema)
  .action(async ({ parsedInput: { fundId, accountId } }) => {
    const archived = await archiveAccount({ fundId, accountId });
    if (!archived) throw new ActionError("errors.notFound");

    refresh();
  });

export const restoreAccountAction = authActionClient
  .inputSchema(restoreAccountSchema)
  .action(async ({ parsedInput: { fundId, accountId } }) => {
    const restored = await restoreAccount({ fundId, accountId });
    if (!restored) throw new ActionError("errors.notFound");

    refresh();
  });

/**
 * Deletes an account outright. Once movements reference accounts, deleting
 * one that has them will trip the foreign key (23503) before it trips a
 * row count.
 */
export const deleteAccountAction = authActionClient
  .inputSchema(deleteAccountSchema)
  .action(async ({ parsedInput: { fundId, accountId } }) => {
    let deleted: boolean;
    try {
      deleted = await deleteAccount({ fundId, accountId });
    } catch (error) {
      if (pgErrorCode(error) === "23503") throw new ActionError("errors.accountInUse");
      throw error;
    }
    if (!deleted) throw new ActionError("errors.notFound");

    refresh();
  });
