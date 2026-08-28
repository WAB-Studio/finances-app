import "server-only";

import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

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
    // whether archiving needs its extra dialog. Built as a query, not a raw `sql`
    // fragment — a single-table outer select strips table qualifiers from any
    // column it finds inside an interpolated fragment, which turned this into
    // `accounts.member_id = accounts.id` and a count of zero for every member.
    const activeAccountCount = tx
      .select({ n: count().as("n") })
      .from(accounts)
      .where(
        and(
          eq(accounts.memberId, members.id),
          eq(accounts.fundId, members.fundId),
          isNull(accounts.archivedAt),
        ),
      )
      .as("activeAccountCount");

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

// One query for the whole fund, not one per member: the members page used to
// pay a round trip per row it rendered.
export async function listMembersActiveAccounts(
  fundId: string,
): Promise<Record<string, { id: string; name: string; kind: Account["kind"] }[]>> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .select({
        memberId: accounts.memberId,
        id: accounts.id,
        name: accounts.name,
        kind: accounts.kind,
      })
      .from(accounts)
      .where(
        and(
          eq(accounts.fundId, fundId),
          isNotNull(accounts.memberId),
          isNull(accounts.archivedAt),
        ),
      )
      .orderBy(asc(accounts.memberId), asc(accounts.name));

    const byMember: Record<string, { id: string; name: string; kind: Account["kind"] }[]> = {};
    for (const row of rows) {
      // `isNotNull(accounts.memberId)` above already excludes the null case.
      const memberId = row.memberId as string;
      (byMember[memberId] ??= []).push({ id: row.id, name: row.name, kind: row.kind });
    }
    return byMember;
  });
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

export type ArchiveMemberResult = { status: "ok" } | { status: "not-found" } | { status: "incomplete" };

// One transaction. RF-12 needs every active account decided before anything is
// written, so the decision set is checked against the member's active accounts
// first — a member archived with an undecided account would leave that account
// live under an archived owner.
export async function archiveMember({
  fundId,
  memberId,
  decisions,
}: {
  fundId: string;
  memberId: string;
  decisions: { accountId: string; decision: "archive" | "fund" }[];
}): Promise<ArchiveMemberResult> {
  return withUserDb(async (tx) => {
    const activeAccounts = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.fundId, fundId),
          eq(accounts.memberId, memberId),
          isNull(accounts.archivedAt),
        ),
      );

    const activeIds = new Set(activeAccounts.map((account) => account.id));
    const decidedIds = new Set<string>();

    for (const decision of decisions) {
      // Outside the active set or already decided — either way a nothing-written return.
      if (!activeIds.has(decision.accountId) || decidedIds.has(decision.accountId)) {
        return { status: "incomplete" };
      }
      decidedIds.add(decision.accountId);
    }

    if (decidedIds.size < activeIds.size) {
      return { status: "incomplete" };
    }

    // Member first: `members_update_member` is the only policy here that can
    // refuse on `archived_at`, so a 42501 raised at this statement is always
    // the self-archive refusal, never one of the account updates below.
    const rows = await tx
      .update(members)
      .set({ archivedAt: sql`now()` })
      .where(and(eq(members.fundId, fundId), eq(members.id, memberId)))
      .returning({ id: members.id });

    if (rows.length === 0) {
      return { status: "not-found" };
    }

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

    return { status: "ok" };
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
