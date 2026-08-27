"use server";

import { refresh } from "next/cache";

import {
  archiveMember,
  createMember,
  deleteMember,
  restoreMember,
  updateMember,
} from "@/db/queries/members";
import { pgErrorCode } from "@/lib/db-error";
import { ActionError } from "@/lib/errors";
import { authActionClient } from "@/lib/safe-action";
import {
  archiveMemberSchema,
  createMemberSchema,
  deleteMemberSchema,
  restoreMemberSchema,
  updateMemberSchema,
} from "@/lib/validation/member";

export const createMemberAction = authActionClient
  .inputSchema(createMemberSchema)
  .action(async ({ parsedInput: { fundId, name } }) => {
    const { memberId } = await createMember({ fundId, name });

    refresh();
    return { memberId };
  });

export const updateMemberAction = authActionClient
  .inputSchema(updateMemberSchema)
  .action(async ({ parsedInput: { fundId, memberId, name } }) => {
    const updated = await updateMember({ fundId, memberId, name });
    if (!updated) throw new ActionError("errors.notFound");

    refresh();
  });

// RF-12: the caller has already decided, per account, whether it follows the
// member into archive or moves to the fund — this action only forwards that.
export const archiveMemberAction = authActionClient
  .inputSchema(archiveMemberSchema)
  .action(async ({ parsedInput: { fundId, memberId, accounts } }) => {
    try {
      const archived = await archiveMember({
        fundId,
        memberId,
        decisions: accounts,
      });
      if (!archived) throw new ActionError("errors.notFound");
    } catch (error) {
      if (error instanceof ActionError) throw error;

      const code = pgErrorCode(error);
      if (code === "42501") throw new ActionError("errors.selfArchive");
      if (code === "23514") throw new ActionError("errors.lastOwner");
      throw error;
    }

    refresh();
  });

export const restoreMemberAction = authActionClient
  .inputSchema(restoreMemberSchema)
  .action(async ({ parsedInput: { fundId, memberId } }) => {
    const restored = await restoreMember({ fundId, memberId });
    if (!restored) throw new ActionError("errors.notFound");

    refresh();
  });

export const deleteMemberAction = authActionClient
  .inputSchema(deleteMemberSchema)
  .action(async ({ parsedInput: { fundId, memberId } }) => {
    try {
      const deleted = await deleteMember({ fundId, memberId });
      if (!deleted) throw new ActionError("errors.notFound");
    } catch (error) {
      if (error instanceof ActionError) throw error;

      const code = pgErrorCode(error);
      if (code === "23503") throw new ActionError("errors.memberHasAccounts");
      throw error;
    }

    refresh();
  });
