import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { listAccounts } from "@/db/queries/accounts";
import type { AccountRow } from "@/db/queries/accounts";
import { listCategories } from "@/db/queries/categories";
import type { CategoryNode } from "@/db/queries/categories";
import { getUserGroup } from "@/db/queries/groups";
import { listMembers } from "@/db/queries/group-members";
import { listLabels } from "@/db/queries/labels";
import type { LabelRow } from "@/db/queries/labels";
import { transactions } from "@/db/schema";
import { getSessionUser, requireUser, withUserDb } from "@/db/session";

// A category carries the scope it was read for (RF-62), so the form can tell a
// personal category apart from the group's without a second lookup.
export type ScopedCategory = CategoryNode & { scope: "personal" | "group" };

export type TransactionFormOptions = {
  accounts: AccountRow[];
  categories: ScopedCategory[];
  labels: LabelRow[];
  members: { userId: string; name: string }[];
  lastUsedAccountId: string | null;
};

// Everything the write screen needs to open, in one fan-out. The caller's group
// is resolved first because it names the group scope the reads then key off; the
// group-only reads collapse to empty sets when the caller runs personal-only.
export async function getTransactionFormOptions(): Promise<TransactionFormOptions> {
  const user = await requireUser();
  const group = await getUserGroup();

  const personalScope = { ownerUserId: user.id } as const;
  const empty = Promise.resolve([]);

  const [
    accounts,
    personalExpense,
    personalIncome,
    personalLabels,
    groupExpense,
    groupIncome,
    groupLabels,
    groupMembers,
    lastUsedAccountId,
  ] = await Promise.all([
    listAccounts({ archived: false }),
    listCategories(personalScope, "expense"),
    listCategories(personalScope, "income"),
    listLabels(personalScope),
    group ? listCategories({ groupId: group.id }, "expense") : empty,
    group ? listCategories({ groupId: group.id }, "income") : empty,
    group ? listLabels({ groupId: group.id }) : empty,
    group ? listMembers(group.id, { archived: false }) : empty,
    getLastUsedAccountId(),
  ]);

  const categories: ScopedCategory[] = [
    ...[...personalExpense, ...personalIncome].map((category) => ({
      ...category,
      scope: "personal" as const,
    })),
    ...[...groupExpense, ...groupIncome].map((category) => ({
      ...category,
      scope: "group" as const,
    })),
  ];

  return {
    accounts,
    categories,
    labels: [...personalLabels, ...groupLabels],
    // Only members who have claimed a login can be a movement's creator (RF-25).
    members: groupMembers.flatMap((member) =>
      member.userId ? [{ userId: member.userId, name: member.name }] : [],
    ),
    lastUsedAccountId,
  };
}

// The account the quick-entry field defaults to (RF-22): the source of the
// caller's most recent movement, or its destination for an income, or null when
// they have recorded nothing yet.
export async function getLastUsedAccountId(): Promise<string | null> {
  const user = await getSessionUser();
  if (!user) return null;

  return withUserDb(async (tx) => {
    const [row] = await tx
      .select({
        accountId: sql<
          string | null
        >`coalesce(${transactions.fromAccountId}, ${transactions.toAccountId})`,
      })
      .from(transactions)
      .where(eq(transactions.createdBy, user.id))
      .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt))
      .limit(1);

    return row?.accountId ?? null;
  });
}

/**
 * A display name per creator id (RF-25): a creator who is a group member reads as
 * that member's name, an archived member included, since a movement outlives the
 * member who recorded it. The email is the caller's own affordance only — it
 * stands in for their own id when it names no member, never for another user's.
 */
export async function resolveCreatorNames(
  userIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  const unique = [...new Set(userIds)];
  if (unique.length === 0) return names;

  const [user, group] = await Promise.all([getSessionUser(), getUserGroup()]);
  // Archived members carry a name too, so both rosters feed the lookup.
  const members = group
    ? (
        await Promise.all([
          listMembers(group.id, { archived: false }),
          listMembers(group.id, { archived: true }),
        ])
      ).flat()
    : [];

  const memberNames = new Map(
    members.flatMap((member) =>
      member.userId ? [[member.userId, member.name] as const] : [],
    ),
  );

  for (const id of unique) {
    const memberName = memberNames.get(id);
    if (memberName) {
      names.set(id, memberName);
    } else if (user && id === user.id) {
      names.set(id, user.email);
    }
  }

  return names;
}
