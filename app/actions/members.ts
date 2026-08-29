"use server";

import { refresh } from "next/cache";

import {
  archiveMember,
  createMember,
  deleteMember,
  restoreMember,
  updateMember,
} from "@/db/queries/group-members";
import { getUserGroup } from "@/db/queries/groups";
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

// Members live inside a group; a caller who runs personal-only has none (RF-55).
async function requireGroupId(): Promise<string> {
  const group = await getUserGroup();
  if (!group) throw new ActionError("errors.notFound");
  return group.id;
}

export const createMemberAction = authActionClient
  .inputSchema(createMemberSchema)
  .action(async ({ parsedInput: { name } }) => {
    const groupId = await requireGroupId();
    const { memberId } = await createMember({ groupId, name });

    refresh();
    return { memberId };
  });

export const updateMemberAction = authActionClient
  .inputSchema(updateMemberSchema)
  .action(async ({ parsedInput: { memberId, name } }) => {
    const groupId = await requireGroupId();
    const updated = await updateMember({ groupId, memberId, name });
    if (!updated) throw new ActionError("errors.notFound");

    refresh();
  });

// RF-61: archiving a member leaves their accounts untouched — the flag is the
// only write. `group_members_update_member` still refuses the caller's own row.
export const archiveMemberAction = authActionClient
  .inputSchema(archiveMemberSchema)
  .action(async ({ parsedInput: { memberId } }) => {
    const groupId = await requireGroupId();
    let archived: boolean;
    try {
      archived = await archiveMember({ groupId, memberId });
    } catch (error) {
      if (pgErrorCode(error) === "42501") throw new ActionError("errors.selfArchive");
      throw error;
    }
    if (!archived) throw new ActionError("errors.notFound");

    refresh();
  });

export const restoreMemberAction = authActionClient
  .inputSchema(restoreMemberSchema)
  .action(async ({ parsedInput: { memberId } }) => {
    const groupId = await requireGroupId();
    const restored = await restoreMember({ groupId, memberId });
    if (!restored) throw new ActionError("errors.notFound");

    refresh();
  });

export const deleteMemberAction = authActionClient
  .inputSchema(deleteMemberSchema)
  .action(async ({ parsedInput: { memberId } }) => {
    const groupId = await requireGroupId();
    const deleted = await deleteMember({ groupId, memberId });
    if (!deleted) throw new ActionError("errors.notFound");

    refresh();
  });
