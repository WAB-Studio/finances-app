import "server-only";

import { and, asc, count, eq, isNull } from "drizzle-orm";

import { accounts, categories, funds, members } from "@/db/schema";
import type { Fund } from "@/db/schema";
import { getSessionUser, withUserDb } from "@/db/session";

export type FundSummary = Pick<Fund, "id" | "name" | "currency">;

export type FundOverview = {
  fund: FundSummary;
  cashAccountName: string | null;
  categoryCount: number;
};

// Ordered for a picker, not a ledger: `funds.name` is the only order a user compares by.
export async function listUserFunds(): Promise<FundSummary[]> {
  const user = await getSessionUser();
  if (!user) return [];

  return withUserDb(async (tx) => {
    const rows = await tx
      .select({ id: funds.id, name: funds.name, currency: funds.currency })
      .from(funds)
      .innerJoin(members, eq(members.fundId, funds.id))
      .where(and(eq(members.userId, user.id), isNull(members.archivedAt)))
      .orderBy(asc(funds.name));

    return rows;
  });
}

// `null` here means the policy filtered the row, not that the query excluded it.
export async function getFundForUser(fundId: string): Promise<FundSummary | null> {
  const user = await getSessionUser();
  if (!user) return null;

  return withUserDb(async (tx) => {
    const [row] = await tx
      .select({ id: funds.id, name: funds.name, currency: funds.currency })
      .from(funds)
      .where(eq(funds.id, fundId))
      .limit(1);

    return row ?? null;
  });
}

export async function getFundOverview(fundId: string): Promise<FundOverview | null> {
  const user = await getSessionUser();
  if (!user) return null;

  return withUserDb(async (tx) => {
    const [fund] = await tx
      .select({ id: funds.id, name: funds.name, currency: funds.currency })
      .from(funds)
      .where(eq(funds.id, fundId))
      .limit(1);

    if (!fund) return null;

    const [cashAccount] = await tx
      .select({ name: accounts.name })
      .from(accounts)
      .where(
        and(
          eq(accounts.fundId, fundId),
          isNull(accounts.memberId),
          eq(accounts.kind, "asset"),
          isNull(accounts.archivedAt),
        ),
      )
      .orderBy(asc(accounts.name))
      .limit(1);

    const [categoryTotal] = await tx
      .select({ total: count() })
      .from(categories)
      .where(eq(categories.fundId, fundId));

    return {
      fund,
      cashAccountName: cashAccount?.name ?? null,
      categoryCount: categoryTotal?.total ?? 0,
    };
  });
}
