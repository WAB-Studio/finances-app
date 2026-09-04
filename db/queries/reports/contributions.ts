import "server-only";

import { sql } from "drizzle-orm";

import { withUserDb } from "@/db/session";

export type MemberContribution = {
  userId: string;
  contributionCents: number;
};

/**
 * Each member's net contribution to the group's accounts for one window, in ONE
 * round trip (RF-66). A contribution is a transfer from a member's personal
 * account into a group account, credited to that member; a return is the mirror,
 * debited back. Only transfers touch the pot (RF-19), so the join reads both
 * sides of every transfer and nets `Σ contributions − Σ returns` per member. The
 * group's own accounts are the pot, never a contributor, so no group row appears
 * (RF-67). A caller with no group has no group account on either side of any
 * transfer, so the same statement returns nothing — no membership read first.
 */
export async function getMemberContributions(range: {
  start: string;
  endExclusive: string;
}): Promise<MemberContribution[]> {
  return withUserDb(async (tx) => {
    const rows = await tx.execute<{
      user_id: string;
      contribution_cents: string;
    }>(sql`
      select member.user_id, coalesce(sum(member.delta), 0) as contribution_cents
      from (
        select
          case
            when ta.group_id is not null and fa.owner_user_id is not null then fa.owner_user_id
            when fa.group_id is not null and ta.owner_user_id is not null then ta.owner_user_id
          end as user_id,
          case
            when ta.group_id is not null and fa.owner_user_id is not null then t.amount_cents
            when fa.group_id is not null and ta.owner_user_id is not null then -t.amount_cents
            else 0
          end as delta
        from transactions t
        join accounts fa on fa.id = t.from_account_id
        join accounts ta on ta.id = t.to_account_id
        where t.kind = 'transfer'
          and t.occurred_at >= ${range.start} and t.occurred_at < ${range.endExclusive}
      ) member
      where member.user_id is not null
      group by member.user_id
    `);

    // A bigint sum arrives from the driver as a string; the ledger keeps cents a number.
    return rows.map((row) => ({
      userId: row.user_id,
      contributionCents: Number(row.contribution_cents),
    }));
  });
}
