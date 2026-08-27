import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { accounts, members } from "@/db/schema";
import type { Account, Member } from "@/db/schema";
import { withUserDb } from "@/db/session";

type MemberRole = Member["role"];

export type MemberRow = {
  id: string;
  name: string;
  role: MemberRole;
  userId: string | null;
  archivedAt: Date | null;
  activeAccountCount: number;
};

// Ordered for a roster, not a ledger: `members.name` is the only order a user compares by.
export async function listMembers(
  fundId: string,
  options: { archived: boolean },
): Promise<MemberRow[]> {
  return withUserDb(async (tx) => {
    // Correlated, not a second round trip: the screen needs this count to decide
    // whether archiving needs its extra dialog.
    const activeAccountCount = sql<number>`(
      select count(*)::int from ${accounts}
      where ${accounts.memberId} = ${members.id}
        and ${accounts.fundId} = ${members.fundId}
        and ${accounts.archivedAt} is null
    )`;

    return tx
      .select({
        id: members.id,
        name: members.name,
        role: members.role,
        userId: members.userId,
        archivedAt: members.archivedAt,
        activeAccountCount,
      })
      .from(members)
      .where(
        and(
          eq(members.fundId, fundId),
          options.archived ? isNotNull(members.archivedAt) : isNull(members.archivedAt),
        ),
      )
      .orderBy(asc(members.name));
  });
}

export async function listMemberActiveAccounts(
  fundId: string,
  memberId: string,
): Promise<{ id: string; name: string; kind: Account["kind"] }[]> {
  return withUserDb(async (tx) =>
    tx
      .select({ id: accounts.id, name: accounts.name, kind: accounts.kind })
      .from(accounts)
      .where(
        and(
          eq(accounts.fundId, fundId),
          eq(accounts.memberId, memberId),
          isNull(accounts.archivedAt),
        ),
      )
      .orderBy(asc(accounts.name)),
  );
}

// `user_id` stays null and `role` stays at its default — the only shape
// `members_insert_fund_member` accepts (RF-07: a member need not have a login).
export async function createMember({
  fundId,
  name,
}: {
  fundId: string;
  name: string;
}): Promise<{ memberId: string }> {
  return withUserDb(async (tx) => {
    const [row] = await tx
      .insert(members)
      .values({ fundId, name })
      .returning({ id: members.id });

    return { memberId: row.id };
  });
}

export async function updateMember({
  fundId,
  memberId,
  name,
}: {
  fundId: string;
  memberId: string;
  name: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(members)
      .set({ name })
      .where(and(eq(members.fundId, fundId), eq(members.id, memberId)))
      .returning({ id: members.id });

    return rows.length > 0;
  });
}

// One transaction, member's archive last: a failed account decision must leave
// nothing half-applied (RF-12 — no account is archived except the ones chosen).
export async function archiveMember({
  fundId,
  memberId,
  decisions,
}: {
  fundId: string;
  memberId: string;
  decisions: { accountId: string; decision: "archive" | "fund" }[];
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const archiveIds = decisions
      .filter((decision) => decision.decision === "archive")
      .map((decision) => decision.accountId);
    const fundIds = decisions
      .filter((decision) => decision.decision === "fund")
      .map((decision) => decision.accountId);

    if (archiveIds.length > 0) {
      await tx
        .update(accounts)
        .set({ archivedAt: sql`now()` })
        .where(
          and(
            eq(accounts.fundId, fundId),
            eq(accounts.memberId, memberId),
            inArray(accounts.id, archiveIds),
          ),
        );
    }

    if (fundIds.length > 0) {
      await tx
        .update(accounts)
        .set({ memberId: null })
        .where(
          and(
            eq(accounts.fundId, fundId),
            eq(accounts.memberId, memberId),
            inArray(accounts.id, fundIds),
          ),
        );
    }

    const rows = await tx
      .update(members)
      .set({ archivedAt: sql`now()` })
      .where(and(eq(members.fundId, fundId), eq(members.id, memberId)))
      .returning({ id: members.id });

    return rows.length > 0;
  });
}

// Mirrors the archive rule: it does not touch accounts, so re-adopting them
// never silently undoes a decision the person made.
export async function restoreMember({
  fundId,
  memberId,
}: {
  fundId: string;
  memberId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(members)
      .set({ archivedAt: null })
      .where(and(eq(members.fundId, fundId), eq(members.id, memberId)))
      .returning({ id: members.id });

    return rows.length > 0;
  });
}

// No account check here: the foreign key does that, and the calling action
// reads the error code (RF-11).
export async function deleteMember({
  fundId,
  memberId,
}: {
  fundId: string;
  memberId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .delete(members)
      .where(and(eq(members.fundId, fundId), eq(members.id, memberId)))
      .returning({ id: members.id });

    return rows.length > 0;
  });
}
