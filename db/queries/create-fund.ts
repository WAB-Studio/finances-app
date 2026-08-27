import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { accounts, categories, funds, members } from "@/db/schema";
import { getSessionUser, withUserDb } from "@/db/session";
import { CASH_ACCOUNT_NAME, SEED_CATEGORIES } from "@/lib/fund/seed";
import type { Locale } from "@/lib/locales";

export type CreateFundArgs = { name: string; memberName: string; locale: Locale };

/**
 * Five inserts in one transaction: fund, owner, cash account, then categories
 * two rows deep. Order matters — accounts and categories' INSERT policies ask
 * whether the caller is a member, which only becomes true once step 2 lands.
 */
export async function createFund({
  name,
  memberName,
  locale,
}: CreateFundArgs): Promise<{ fundId: string }> {
  const user = await getSessionUser();
  if (!user) throw new Error("createFund called without a session");

  // Generated here, client-side: reading a brand-new fund's own id back from the
  // insert fails its SELECT policy before the members row exists to satisfy it.
  const fundId = randomUUID();

  await withUserDb(async (tx) => {
    await tx.insert(funds).values({ id: fundId, name });

    await tx.insert(members).values({
      fundId,
      userId: user.id,
      name: memberName,
      role: "owner",
    });

    await tx.insert(accounts).values({
      fundId,
      memberId: null,
      name: CASH_ACCOUNT_NAME[locale],
      kind: "asset",
      initialBalanceCents: 0,
      initialBalanceOn: sql`(now() at time zone 'America/Bogota')::date`,
    });

    // Ids generated up front so children can reference a parent without a
    // round trip and without assuming insertion order back from Postgres.
    const parentRows = SEED_CATEGORIES.map((category) => ({
      id: randomUUID(),
      fundId,
      name: category.name[locale],
      kind: category.kind,
      color: category.color,
    }));

    await tx.insert(categories).values(parentRows);

    // A subcategory copies its parent's kind and color — RF-27.
    const childRows = SEED_CATEGORIES.flatMap((category, index) =>
      (category.children ?? []).map((child) => ({
        fundId,
        parentId: parentRows[index].id,
        name: child.name[locale],
        kind: category.kind,
        color: category.color,
      })),
    );

    if (childRows.length > 0) {
      await tx.insert(categories).values(childRows);
    }
  });

  return { fundId };
}
