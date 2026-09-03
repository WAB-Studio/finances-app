"use server";

import { refresh } from "next/cache";

import {
  archiveAccount,
  createAccount,
  deleteAccount,
  handAccountToGroup,
  restoreAccount,
  updateAccount,
} from "@/db/queries/accounts";
import { getUserGroup } from "@/db/queries/groups";
import { pgErrorCode } from "@/lib/db-error";
import { ActionError } from "@/lib/errors";
import { parsePesos } from "@/lib/money";
import { authActionClient } from "@/lib/safe-action";
import {
  archiveAccountSchema,
  createAccountSchema,
  deleteAccountSchema,
  handAccountToGroupSchema,
  restoreAccountSchema,
  updateAccountSchema,
} from "@/lib/validation/account";

/**
 * Creates an account (RF-60, RF-09, RF-10). A personal account is owned by the
 * caller; a group account is held by their group and shared so any member may
 * write it. The amount arrives as a Zod-validated peso string; parsing it here
 * can only fail if the schema let something through it should not have.
 */
export const createAccountAction = authActionClient
  .inputSchema(createAccountSchema)
  .action(async ({ parsedInput: { amount, placement, ...account }, ctx }) => {
    const pesos = parsePesos(amount);
    if (pesos === null) throw new ActionError("errors.unexpected");

    // The owner/group XOR is resolved from the session, never trusted from the
    // form; a group placement without a group has nowhere to land.
    let placementFields: { ownerUserId: string | null; groupId: string | null; isShared: boolean };
    if (placement === "group") {
      const group = await getUserGroup();
      if (!group) throw new ActionError("errors.notFound");
      placementFields = { ownerUserId: null, groupId: group.id, isShared: true };
    } else {
      placementFields = { ownerUserId: ctx.user.id, groupId: null, isShared: false };
    }

    const { accountId } = await createAccount({ ...account, ...placementFields, pesos });
    refresh();
    return { accountId };
  });

/**
 * Updates an account's editable fields. `kind` and the placement are immutable,
 * so neither is part of this input (RF-09, RF-60).
 */
export const updateAccountAction = authActionClient
  .inputSchema(updateAccountSchema)
  .action(async ({ parsedInput: { amount, ...account } }) => {
    const pesos = parsePesos(amount);
    if (pesos === null) throw new ActionError("errors.unexpected");

    const updated = await updateAccount({ ...account, pesos });
    if (!updated) throw new ActionError("errors.notFound");

    refresh();
  });

export const archiveAccountAction = authActionClient
  .inputSchema(archiveAccountSchema)
  .action(async ({ parsedInput: { accountId } }) => {
    const archived = await archiveAccount({ accountId });
    if (!archived) throw new ActionError("errors.notFound");

    refresh();
  });

export const restoreAccountAction = authActionClient
  .inputSchema(restoreAccountSchema)
  .action(async ({ parsedInput: { accountId } }) => {
    const restored = await restoreAccount({ accountId });
    if (!restored) throw new ActionError("errors.notFound");

    refresh();
  });

/**
 * Hands a personal account to the group (RF-61), after which any member may
 * write it. The engine refuses an account carrying anything at all — that one is
 * archived instead — and every refusal it raises is a 23514.
 *
 * 23505 is a different refusal and reaches a different person: `external_ref` is
 * unique per scope, so an account whose reference a group import already used
 * lands on the group's twin the moment the placement changes. The row keeps its
 * owner either way.
 */
export const handAccountToGroupAction = authActionClient
  .inputSchema(handAccountToGroupSchema)
  .action(async ({ parsedInput: { accountId } }) => {
    try {
      await handAccountToGroup({ accountId });
    } catch (error) {
      const code = pgErrorCode(error);
      if (code === "23514") throw new ActionError("errors.accountHasHistory");
      if (code === "23505") throw new ActionError("errors.accountRefTaken");
      throw error;
    }

    refresh();
  });

/**
 * Deletes an account outright. Once movements reference accounts, deleting
 * one that has them will trip the foreign key (23503) before it trips a
 * row count.
 */
export const deleteAccountAction = authActionClient
  .inputSchema(deleteAccountSchema)
  .action(async ({ parsedInput: { accountId } }) => {
    let deleted: boolean;
    try {
      deleted = await deleteAccount({ accountId });
    } catch (error) {
      if (pgErrorCode(error) === "23503") throw new ActionError("errors.accountInUse");
      throw error;
    }
    if (!deleted) throw new ActionError("errors.notFound");

    refresh();
  });
