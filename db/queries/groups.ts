import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { cache } from "react";

import { groupMembers, groups } from "@/db/schema";
import type { Group } from "@/db/schema";
import { getSessionUser, withUserDb } from "@/db/session";

export type GroupSummary = Pick<Group, "id" | "name" | "currency" | "cashMode">;

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
