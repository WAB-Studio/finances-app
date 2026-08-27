import "server-only";

import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { accounts, members } from "@/db/schema";
import { withUserDb } from "@/db/session";
import { pesosToCents } from "@/lib/money";

export type AccountRow = {
  id: string;
  name: string;
  kind: "asset" | "liability";
  institution: string | null;
  memberId: string | null;
  memberName: string | null;
  initialBalanceCents: number;
  initialBalanceOn: string;
  archivedAt: Date | null;
};

// A fund account has no member row to join, so its rank column comes back
// `true` and sorts first; a member account ranks `false` and then sorts by
// its member's name — the two passes the screen needs to group by owner.
export async function listAccounts(
  fundId: string,
  options: { archived: boolean },
): Promise<AccountRow[]> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .select({
        id: accounts.id,
        name: accounts.name,
        kind: accounts.kind,
        institution: accounts.institution,
        memberId: accounts.memberId,
        memberName: members.name,
        initialBalanceCents: accounts.initialBalanceCents,
        initialBalanceOn: accounts.initialBalanceOn,
        archivedAt: accounts.archivedAt,
      })
      .from(accounts)
      .leftJoin(members, eq(members.id, accounts.memberId))
      .where(
        and(
          eq(accounts.fundId, fundId),
          options.archived ? isNotNull(accounts.archivedAt) : isNull(accounts.archivedAt),
        ),
      )
      .orderBy(desc(sql`${accounts.memberId} is null`), asc(members.name), asc(accounts.name));

    return rows;
  });
}

export async function listAssignableMembers(
  fundId: string,
): Promise<{ id: string; name: string }[]> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(and(eq(members.fundId, fundId), isNull(members.archivedAt)))
      .orderBy(asc(members.name));

    return rows;
  });
}

export type CreateAccountArgs = {
  fundId: string;
  name: string;
  kind: "asset" | "liability";
  memberId: string | null;
  institution: string | null;
  pesos: number;
  balanceOn: string;
};

export async function createAccount({
  fundId,
  name,
  kind,
  memberId,
  institution,
  pesos,
  balanceOn,
}: CreateAccountArgs): Promise<{ accountId: string }> {
  const cents = pesosToCents(pesos);

  return withUserDb(async (tx) => {
    const [row] = await tx
      .insert(accounts)
      .values({
        fundId,
        name,
        kind,
        memberId,
        institution,
        // A liability opens negative so net worth stays a plain sum (RNF-05).
        initialBalanceCents: sql`case when ${kind} = 'liability' then -${cents} else ${cents} end`,
        initialBalanceOn: balanceOn,
      })
      .returning({ id: accounts.id });

    return { accountId: row.id };
  });
}

export type UpdateAccountArgs = {
  fundId: string;
  accountId: string;
  name: string;
  memberId: string | null;
  institution: string | null;
  pesos: number;
  balanceOn: string;
};

export async function updateAccount({
  fundId,
  accountId,
  name,
  memberId,
  institution,
  pesos,
  balanceOn,
}: UpdateAccountArgs): Promise<boolean> {
  const cents = pesosToCents(pesos);

  return withUserDb(async (tx) => {
    const rows = await tx
      .update(accounts)
      .set({
        name,
        memberId,
        institution,
        // `kind` is immutable and absent from the grant, so it is read from
        // the row itself rather than named in this `set`.
        initialBalanceCents: sql`case when ${accounts.kind} = 'liability' then -${cents} else ${cents} end`,
        initialBalanceOn: balanceOn,
      })
      .where(and(eq(accounts.id, accountId), eq(accounts.fundId, fundId)))
      .returning({ id: accounts.id });

    return rows.length > 0;
  });
}

export async function archiveAccount({
  fundId,
  accountId,
}: {
  fundId: string;
  accountId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(accounts)
      .set({ archivedAt: sql`now()` })
      .where(and(eq(accounts.id, accountId), eq(accounts.fundId, fundId)))
      .returning({ id: accounts.id });

    return rows.length > 0;
  });
}

export async function restoreAccount({
  fundId,
  accountId,
}: {
  fundId: string;
  accountId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(accounts)
      .set({ archivedAt: null })
      .where(and(eq(accounts.id, accountId), eq(accounts.fundId, fundId)))
      .returning({ id: accounts.id });

    return rows.length > 0;
  });
}

export async function deleteAccount({
  fundId,
  accountId,
}: {
  fundId: string;
  accountId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .delete(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.fundId, fundId)))
      .returning({ id: accounts.id });

    return rows.length > 0;
  });
}
