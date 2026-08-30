import "server-only";

import { asc, eq } from "drizzle-orm";

import { labels } from "@/db/schema";
import { withUserDb } from "@/db/session";

// A label set is read and written for one scope at a time: a user's personal set
// or a group's (RF-70). The scope decides which of the XOR columns is set.
export type LabelScope = { ownerUserId: string } | { groupId: string };

export type LabelRow = {
  id: string;
  name: string;
  color: string | null;
};

export type CreateLabelArgs = {
  scope: LabelScope;
  name: string;
  color: string | null;
};

function scopeWhere(scope: LabelScope) {
  return "ownerUserId" in scope
    ? eq(labels.ownerUserId, scope.ownerUserId)
    : eq(labels.groupId, scope.groupId);
}

// The scope's labels, one scope at a time; the policy scopes the rows.
export async function listLabels(scope: LabelScope): Promise<LabelRow[]> {
  return withUserDb(async (tx) =>
    tx
      .select({ id: labels.id, name: labels.name, color: labels.color })
      .from(labels)
      .where(scopeWhere(scope))
      .orderBy(asc(labels.name)),
  );
}

export async function createLabel({
  scope,
  name,
  color,
}: CreateLabelArgs): Promise<{ labelId: string }> {
  const ownerUserId = "ownerUserId" in scope ? scope.ownerUserId : null;
  const groupId = "groupId" in scope ? scope.groupId : null;

  return withUserDb(async (tx) => {
    const [row] = await tx
      .insert(labels)
      .values({ ownerUserId, groupId, name, color })
      .returning({ id: labels.id });

    return { labelId: row.id };
  });
}

// The join's ON DELETE cascade detaches the label from its movements; no second statement.
export async function deleteLabel({
  labelId,
}: {
  labelId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .delete(labels)
      .where(eq(labels.id, labelId))
      .returning({ id: labels.id });

    return rows.length > 0;
  });
}
