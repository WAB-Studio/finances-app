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
import { env } from "@/lib/env";
import { ActionError } from "@/lib/errors";
import { authActionClient } from "@/lib/safe-action";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

// RF-06: the same passwordless path as sign-in, so the invited person accepts by
// clicking the link. `shouldCreateUser` provisions the address if it has none.
// Returns false on failure so the create stays non-fatal — the member still lands.
async function sendInviteEmail(email: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/confirm`,
    },
  });
  if (error) {
    console.error("invite email request failed", error);
    return false;
  }
  return true;
}

export const createMemberAction = authActionClient
  .inputSchema(createMemberSchema)
  .action(async ({ parsedInput: { name, email } }) => {
    const groupId = await requireGroupId();
    const { memberId } = await createMember({ groupId, name, inviteEmail: email });

    // A failed send leaves the member pending rather than aborting the create;
    // the caller surfaces it as a notice, not an error.
    const inviteEmailFailed = email ? !(await sendInviteEmail(email)) : false;

    refresh();
    return { memberId, inviteEmailFailed };
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
