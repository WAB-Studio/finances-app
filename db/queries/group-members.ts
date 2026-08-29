import "server-only";

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { groupMembers } from "@/db/schema";
import type { GroupMember } from "@/db/schema";
import { withUserDb } from "@/db/session";

type GroupMemberRole = GroupMember["role"];

export type MemberRow = {
  id: string;
  name: string;
  role: GroupMemberRole;
  userId: string | null;
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
export async function createMember({
  groupId,
  name,
}: {
  groupId: string;
  name: string;
}): Promise<{ memberId: string }> {
  return withUserDb(async (tx) => {
    const [row] = await tx
      .insert(groupMembers)
      .values({ groupId, name })
      .returning({ id: groupMembers.id });

    return { memberId: row.id };
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

// Accounts no longer hang off a member — they name a user or the group — so
// archiving one only sets its own flag; `group_members_update_member` still
// refuses a caller archiving their own row.
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
