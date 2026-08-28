import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { cache } from "react";

import { funds, members } from "@/db/schema";
import type { Fund } from "@/db/schema";
import { getSessionUser, withUserDb } from "@/db/session";

export type FundSummary = Pick<Fund, "id" | "name" | "currency">;

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
// Deduplicated per request: the layout, the metadata and the page all ask for the same fund.
export const getFundForUser = cache(async function getFundForUser(
  fundId: string,
): Promise<FundSummary | null> {
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
});
