import "server-only";

import { and, asc, eq, isNull, or, sql } from "drizzle-orm";

import { insertRow } from "@/db/insert-row";
import { callerGroupId } from "@/db/queries/groups";
import { categories } from "@/db/schema";
import type { Category } from "@/db/schema";
import type { Transaction } from "@/db/session";
import { withUserDb } from "@/db/session";

type CategoryKind = Category["kind"];

// A category set is read and written for one scope at a time: a user's personal
// set or a group's (RF-63). The scope decides which of the XOR columns is set.
export type CategoryScope = { ownerUserId: string } | { groupId: string };

export type CategoryNode = {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string | null;
  children: { id: string; name: string; color: string | null }[];
};

// A node carries the scope it was read from, so a caller that asked for both
// tells a personal category apart from the group's without a second lookup.
export type ScopedCategoryNode = CategoryNode & { scope: "personal" | "group" };

export type CreateCategoryArgs = {
  scope: CategoryScope;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  color: string | null;
};

export type UpdateCategoryArgs = {
  categoryId: string;
  name: string;
  parentId: string | null;
  color: string | null;
};

function scopeWhere(scope: CategoryScope) {
  return "ownerUserId" in scope
    ? eq(categories.ownerUserId, scope.ownerUserId)
    : eq(categories.groupId, scope.groupId);
}

// A subselect, not the caller's value: a subcategory always carries its parent's
// colour. The read is policy-scoped, so the parent id alone pins the row.
function subcategoryColor(parentId: string) {
  return sql`(select ${categories.color} from ${categories} where ${eq(categories.id, parentId)})`;
}

/**
 * One query for the scope's categories of a kind, split in TypeScript into
 * parents and children — the trigger, not this function, keeps nesting at one
 * level, so a single pass is enough to tell a parent from a child.
 */
export async function listCategories(
  scope: CategoryScope,
  kind: CategoryKind,
): Promise<CategoryNode[]> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .select({
        id: categories.id,
        name: categories.name,
        color: categories.color,
        parentId: categories.parentId,
      })
      .from(categories)
      .where(and(scopeWhere(scope), eq(categories.kind, kind)))
      .orderBy(asc(categories.name));

    const parents = new Map<string, CategoryNode>();
    for (const row of rows) {
      if (row.parentId === null) {
        parents.set(row.id, {
          id: row.id,
          name: row.name,
          kind,
          color: row.color,
          children: [],
        });
      }
    }
    for (const row of rows) {
      if (row.parentId !== null) {
        parents.get(row.parentId)?.children.push({
          id: row.id,
          name: row.name,
          color: row.color,
        });
      }
    }

    return [...parents.values()];
  });
}

/**
 * Every category a form offers, in ONE statement: both kinds and both scopes, the
 * caller's group resolved by subselect rather than behind a transaction of its
 * own. A personal-only caller matches no group row and gets their own set alone.
 *
 * The order reproduces what the four separate reads used to arrive in — personal
 * before the group's, expense before income, then by name — so a picker built
 * from this list reads the same as before.
 */
export async function listScopedCategories(
  userId: string,
): Promise<ScopedCategoryNode[]> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
        color: categories.color,
        parentId: categories.parentId,
        ownerUserId: categories.ownerUserId,
      })
      .from(categories)
      .where(
        or(
          eq(categories.ownerUserId, userId),
          eq(categories.groupId, callerGroupId(userId)),
        ),
      )
      .orderBy(
        asc(sql`${categories.ownerUserId} is null`),
        asc(sql`${categories.kind} = 'income'`),
        asc(categories.name),
      );

    const parents = new Map<string, ScopedCategoryNode>();
    for (const row of rows) {
      if (row.parentId === null) {
        parents.set(row.id, {
          id: row.id,
          name: row.name,
          kind: row.kind,
          color: row.color,
          scope: row.ownerUserId === null ? "group" : "personal",
          children: [],
        });
      }
    }
    for (const row of rows) {
      if (row.parentId !== null) {
        parents.get(row.parentId)?.children.push({
          id: row.id,
          name: row.name,
          color: row.color,
        });
      }
    }

    return [...parents.values()];
  });
}

// The parent picker's source: top-level categories only, one kind at a time.
export async function listParentCategories(
  scope: CategoryScope,
  kind: CategoryKind,
): Promise<{ id: string; name: string }[]> {
  return withUserDb(async (tx) =>
    tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(scopeWhere(scope), eq(categories.kind, kind), isNull(categories.parentId)))
      .orderBy(asc(categories.name)),
  );
}

/**
 * Both kinds, top level only: the default colour belongs to the scope, not to
 * the tab open when a category is created.
 */
export async function listUsedCategoryColors(scope: CategoryScope): Promise<string[]> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .selectDistinct({ color: categories.color })
      .from(categories)
      .where(and(scopeWhere(scope), isNull(categories.parentId)));

    return rows.flatMap((row) => (row.color ? [row.color] : []));
  });
}

export async function createCategory(
  args: CreateCategoryArgs,
): Promise<{ categoryId: string }> {
  return withUserDb((tx) => insertCategory(tx, args));
}

// The insert body of `createCategory`, against a caller-supplied transaction, so a
// rolled-back proof drives the statement a screen commits.
export async function insertCategory(
  tx: Transaction,
  { scope, name, kind, parentId, color }: CreateCategoryArgs,
): Promise<{ categoryId: string }> {
  const ownerUserId = "ownerUserId" in scope ? scope.ownerUserId : null;
  const groupId = "groupId" in scope ? scope.groupId : null;

  const [row] = await insertRow(
    tx,
    categories,
    {
      ownerUserId,
      groupId,
      name,
      kind,
      parentId,
      color: parentId ? subcategoryColor(parentId) : color,
    },
    { returning: { id: categories.id } },
  );

  return { categoryId: row.id };
}

export async function updateCategory({
  categoryId,
  name,
  parentId,
  color,
}: UpdateCategoryArgs): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(categories)
      .set({
        name,
        parentId,
        color: parentId ? subcategoryColor(parentId) : color,
      })
      .where(eq(categories.id, categoryId))
      .returning({ id: categories.id });

    return rows.length > 0;
  });
}

// The composite foreign key's ON DELETE cascade removes the children; no second statement.
export async function deleteCategory({
  categoryId,
}: {
  categoryId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .delete(categories)
      .where(eq(categories.id, categoryId))
      .returning({ id: categories.id });

    return rows.length > 0;
  });
}
