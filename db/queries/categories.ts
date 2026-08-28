import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { categories } from "@/db/schema";
import type { Category } from "@/db/schema";
import { withUserDb } from "@/db/session";

type CategoryKind = Category["kind"];

export type CategoryNode = {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string | null;
  children: { id: string; name: string; color: string | null }[];
};

export type CreateCategoryArgs = {
  fundId: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  color: string | null;
};

export type UpdateCategoryArgs = {
  fundId: string;
  categoryId: string;
  name: string;
  parentId: string | null;
  color: string | null;
};

// A subselect, not the caller's value: a subcategory always carries its parent's colour.
function subcategoryColor(parentId: string, fundId: string) {
  return sql`(select ${categories.color} from ${categories} where ${and(
    eq(categories.id, parentId),
    eq(categories.fundId, fundId),
  )})`;
}

/**
 * One query for the fund's categories of a kind, split in TypeScript into
 * parents and children — the trigger, not this function, keeps nesting at one
 * level, so a single pass is enough to tell a parent from a child.
 */
export async function listCategories(
  fundId: string,
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
      .where(and(eq(categories.fundId, fundId), eq(categories.kind, kind)))
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

// The parent picker's source: top-level categories only, one kind at a time.
export async function listParentCategories(
  fundId: string,
  kind: CategoryKind,
): Promise<{ id: string; name: string }[]> {
  return withUserDb(async (tx) =>
    tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(
        and(eq(categories.fundId, fundId), eq(categories.kind, kind), isNull(categories.parentId)),
      )
      .orderBy(asc(categories.name)),
  );
}

/**
 * Both kinds, top level only: the default colour belongs to the fund, not to
 * the tab open when a category is created.
 */
export async function listUsedCategoryColors(fundId: string): Promise<string[]> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .selectDistinct({ color: categories.color })
      .from(categories)
      .where(and(eq(categories.fundId, fundId), isNull(categories.parentId)));

    return rows.flatMap((row) => (row.color ? [row.color] : []));
  });
}

export async function createCategory({
  fundId,
  name,
  kind,
  parentId,
  color,
}: CreateCategoryArgs): Promise<{ categoryId: string }> {
  return withUserDb(async (tx) => {
    const [row] = await tx
      .insert(categories)
      .values({
        fundId,
        name,
        kind,
        parentId,
        color: parentId ? subcategoryColor(parentId, fundId) : color,
      })
      .returning({ id: categories.id });

    return { categoryId: row.id };
  });
}

export async function updateCategory({
  fundId,
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
        color: parentId ? subcategoryColor(parentId, fundId) : color,
      })
      .where(and(eq(categories.id, categoryId), eq(categories.fundId, fundId)))
      .returning({ id: categories.id });

    return rows.length > 0;
  });
}

// The composite foreign key's ON DELETE cascade removes the children; no second statement.
export async function deleteCategory({
  fundId,
  categoryId,
}: {
  fundId: string;
  categoryId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .delete(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.fundId, fundId)))
      .returning({ id: categories.id });

    return rows.length > 0;
  });
}
