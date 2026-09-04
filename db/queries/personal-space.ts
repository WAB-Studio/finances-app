import "server-only";

import { insertRow } from "@/db/insert-row";
import { categories } from "@/db/schema";
import type { Transaction } from "@/db/session";
import { SEED_CATEGORIES } from "@/lib/fund/seed";
import type { Locale } from "@/lib/locales";

/**
 * Seeds a user's personal category set in the language they arrived in (RF-64),
 * the personal half of what `createGroup` writes for a group. Without it a
 * personal-only user (RF-55) has nothing to split an expense across, and RF-69
 * requires every expense to carry a split.
 *
 * Runs on the caller's transaction and opens none: the confirm route is already
 * inside `withUserDb`, under the session `categories_insert_personal` reads.
 * Returns how many rows landed.
 */
export async function seedPersonalCategories(
  tx: Transaction,
  { userId, locale }: { userId: string; locale: Locale },
): Promise<number> {
  // Parents first, ids read back: the insert policy admits a row the caller
  // owns, so `returning` hands back each id a child references. Row order out of
  // a single INSERT matches the input.
  const parentRows = await insertRow(
    tx,
    categories,
    SEED_CATEGORIES.map((category) => ({
      ownerUserId: userId,
      groupId: null,
      name: category.name[locale],
      kind: category.kind,
      color: category.color,
    })),
    { returning: { id: categories.id } },
  );

  // A subcategory copies its parent's kind and colour — RF-63.
  const childRows = SEED_CATEGORIES.flatMap((category, index) =>
    (category.children ?? []).map((child) => ({
      ownerUserId: userId,
      groupId: null,
      parentId: parentRows[index].id,
      name: child.name[locale],
      kind: category.kind,
      color: category.color,
    })),
  );

  if (childRows.length > 0) {
    await insertRow(tx, categories, childRows);
  }

  return parentRows.length + childRows.length;
}
