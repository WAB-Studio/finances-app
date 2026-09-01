import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { cache } from "react";

import { groupMembers, groups } from "@/db/schema";
import type { Group } from "@/db/schema";
import { getSessionUser, withUserDb } from "@/db/session";

export type GroupSummary = Pick<Group, "id" | "name" | "currency" | "cashMode">;

/**
 * The caller's group id as a subselect, for a read that only needs to name the
 * group scope. It resolves inside the statement that uses it, so the read costs
 * one transaction instead of waiting behind `getUserGroup`'s. A personal-only
 * caller resolves to null, which makes the predicate it feeds false — the same
 * empty result the conditional branch used to produce.
 *
 * The policies still scope every row: this narrows, it never widens.
 */
export function callerGroupId(userId: string): SQL<string> {
  return sql`(select gm.group_id from group_members gm
    where gm.user_id = ${userId} and gm.archived_at is null limit 1)`;
}

// The caller's group cash mode (RF-56), resolved the same way, for the statement
// that has to know where cash sits before it can look for it.
export function callerCashMode(userId: string): SQL<Group["cashMode"]> {
  return sql`(select g.cash_mode from groups g
    join group_members gm on gm.group_id = g.id
    where gm.user_id = ${userId} and gm.archived_at is null limit 1)`;
}

// A user belongs to at most one group (RF-55): this returns it, or null when
// they run personal-only. `null` also covers a policy-filtered read, not just an
// absent membership.
export const getUserGroup = cache(async function getUserGroup(): Promise<GroupSummary | null> {
  const user = await getSessionUser();
  if (!user) return null;

  return withUserDb(async (tx) => {
    const [row] = await tx
      .select({
        id: groups.id,
        name: groups.name,
        currency: groups.currency,
        cashMode: groups.cashMode,
      })
      .from(groups)
      .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
      .where(and(eq(groupMembers.userId, user.id), isNull(groupMembers.archivedAt)))
      .limit(1);

    return row ?? null;
  });
});

// `null` here means the policy filtered the row, not that the query excluded it.
// Deduplicated per request: the layout, the metadata and the page all ask for the same group.
export const getGroupForUser = cache(async function getGroupForUser(
  groupId: string,
): Promise<GroupSummary | null> {
  const user = await getSessionUser();
  if (!user) return null;

  return withUserDb(async (tx) => {
    const [row] = await tx
      .select({
        id: groups.id,
        name: groups.name,
        currency: groups.currency,
        cashMode: groups.cashMode,
      })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);

    return row ?? null;
  });
});

// The caller's role in their group (RF-70): `leader` governs the group's shared
// records, `member` only reads them. `null` covers no session, no live
// membership and a policy-filtered row alike.
export const getUserGroupRole = cache(async function getUserGroupRole(): Promise<
  "leader" | "member" | null
> {
  const user = await getSessionUser();
  if (!user) return null;

  return withUserDb(async (tx) => {
    const [row] = await tx
      .select({ role: groupMembers.role })
      .from(groupMembers)
      .where(and(eq(groupMembers.userId, user.id), isNull(groupMembers.archivedAt)))
      .limit(1);

    return row?.role ?? null;
  });
});
