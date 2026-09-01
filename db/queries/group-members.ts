import "server-only";

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { insertRow } from "@/db/insert-row";
import { groupMembers } from "@/db/schema";
import type { GroupMember } from "@/db/schema";
import { withUserDb } from "@/db/session";
import { pgErrorCode } from "@/lib/db-error";

type GroupMemberRole = GroupMember["role"];

export type MemberRow = {
  id: string;
  name: string;
  role: GroupMemberRole;
  userId: string | null;
  inviteEmail: string | null;
  archivedAt: Date | null;
};

// Ordered for a roster, not a ledger: `name` is the only order a user compares by.
export async function listMembers(
  groupId: string,
  options: { archived: boolean },
): Promise<MemberRow[]> {
  return withUserDb(async (tx) =>
    tx
      .select({
        id: groupMembers.id,
        name: groupMembers.name,
        role: groupMembers.role,
        userId: groupMembers.userId,
        inviteEmail: groupMembers.inviteEmail,
        archivedAt: groupMembers.archivedAt,
      })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          options.archived
            ? isNotNull(groupMembers.archivedAt)
            : isNull(groupMembers.archivedAt),
        ),
      )
      .orderBy(asc(groupMembers.name)),
  );
}

// `user_id` stays null and `role` stays at its default — the only shape
// `group_members_insert_member` accepts (RF-07: a member need not have a login).
// An `inviteEmail` pends on the row until the invited person signs in (RF-06).
export async function createMember({
  groupId,
  name,
  inviteEmail,
}: {
  groupId: string;
  name: string;
  inviteEmail?: string;
}): Promise<{ memberId: string }> {
  return withUserDb(async (tx) => {
    const [row] = await insertRow(
      tx,
      groupMembers,
      { groupId, name, inviteEmail: inviteEmail ?? null },
      { returning: { id: groupMembers.id } },
    );

    return { memberId: row.id };
  });
}

// RF-06: the invited person claims their pending row on first sign-in. The
// UPDATE carries no WHERE — `group_members_update_claim` scopes it to the one
// unclaimed row whose invite_email matches the caller's auth.email(), and the
// SELECT policy hides that row, so a targeted WHERE would match nothing. Runs
// under the caller's verified session so auth.email() reads their own address.
export async function claimInviteForUser({
  userId,
  email,
}: {
  userId: string;
  email: string;
}): Promise<"claimed" | "none" | "already-in-group"> {
  if (!email) return "none";

  return withUserDb(async (tx) => {
    try {
      const rows = await tx
        .update(groupMembers)
        .set({ userId, inviteEmail: null })
        .returning({ id: groupMembers.id });

      return rows.length > 0 ? "claimed" : "none";
    } catch (error) {
      // `group_members_user_unique` rejects a caller who already holds a live
      // membership: they cannot be claimed into a second group (RF-55).
      if (pgErrorCode(error) === "23505") return "already-in-group";
      throw error;
    }
  });
}

export async function updateMember({
  groupId,
  memberId,
  name,
}: {
  groupId: string;
  memberId: string;
  name: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(groupMembers)
      .set({ name })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.id, memberId)))
      .returning({ id: groupMembers.id });

    return rows.length > 0;
  });
}

// Accounts name a user or the group, never a member, so archiving one only sets
// its own flag; `group_members_update_member` still refuses a caller archiving
// their own row.
export async function archiveMember({
  groupId,
  memberId,
}: {
  groupId: string;
  memberId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(groupMembers)
      .set({ archivedAt: sql`now()` })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.id, memberId)))
      .returning({ id: groupMembers.id });

    return rows.length > 0;
  });
}

export async function restoreMember({
  groupId,
  memberId,
}: {
  groupId: string;
  memberId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(groupMembers)
      .set({ archivedAt: null })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.id, memberId)))
      .returning({ id: groupMembers.id });

    return rows.length > 0;
  });
}

// The delete policy already refuses the caller's own row (RF-11).
export async function deleteMember({
  groupId,
  memberId,
}: {
  groupId: string;
  memberId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.id, memberId)))
      .returning({ id: groupMembers.id });

    return rows.length > 0;
  });
}
