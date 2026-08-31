import "server-only";

import { asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { accounts } from "@/db/schema";
import type { Account } from "@/db/schema";
import { withUserDb } from "@/db/session";
import { pesosToCents } from "@/lib/money";

type AccountKind = Account["kind"];
type AccountSubtype = Account["subtype"];

export type AccountRow = {
  id: string;
  name: string;
  kind: AccountKind;
  subtype: AccountSubtype;
  institution: string | null;
  lastFour?: string | null;
  ownerUserId: string | null;
  groupId: string | null;
  isShared: boolean;
  initialBalanceCents: number;
  initialBalanceOn: string;
  archivedAt: Date | null;
};

// Every account the caller may read: their personal accounts and their group's
// (RF-58, universal read). The policy scopes the rows; ordering only groups
// personal accounts ahead of the group's, then by name.
export async function listAccounts(
  options: { archived: boolean },
): Promise<AccountRow[]> {
  return withUserDb(async (tx) =>
    tx
      .select({
        id: accounts.id,
        name: accounts.name,
        kind: accounts.kind,
        subtype: accounts.subtype,
        institution: accounts.institution,
        lastFour: accounts.lastFour,
        ownerUserId: accounts.ownerUserId,
        groupId: accounts.groupId,
        isShared: accounts.isShared,
        initialBalanceCents: accounts.initialBalanceCents,
        initialBalanceOn: accounts.initialBalanceOn,
        archivedAt: accounts.archivedAt,
      })
      .from(accounts)
      .where(
        options.archived ? isNotNull(accounts.archivedAt) : isNull(accounts.archivedAt),
      )
      .orderBy(desc(sql`${accounts.ownerUserId} is not null`), asc(accounts.name)),
  );
}

// Placement is XOR, mirroring the schema check: a personal account names its
// owner, a group account names its group and may be shared.
export type CreateAccountArgs = {
  name: string;
  kind: AccountKind;
  subtype: AccountSubtype;
  ownerUserId: string | null;
  groupId: string | null;
  isShared: boolean;
  institution: string | null;
  lastFour?: string | null;
  pesos: number;
  balanceOn: string;
};

export async function createAccount({
  name,
  kind,
  subtype,
  ownerUserId,
  groupId,
  isShared,
  institution,
  lastFour,
  pesos,
  balanceOn,
}: CreateAccountArgs): Promise<{ accountId: string }> {
  const cents = pesosToCents(pesos);

  return withUserDb(async (tx) => {
    const [row] = await tx
      .insert(accounts)
      .values({
        name,
        kind,
        // Passed explicitly; `set_account_subtype` only fills an omitted one.
        subtype,
        ownerUserId,
        groupId,
        isShared,
        // A blank field means "no institution", the same as an absent one.
        institution: institution === "" ? null : institution,
        lastFour: lastFour ? lastFour : null,
        // A liability opens negative so net worth stays a plain sum (RNF-05).
        // `cents` is cast explicitly: an untyped param leaves unary minus with
        // no single best operator, and Postgres refuses to parse the case.
        initialBalanceCents: sql`case when ${kind} = 'liability' then -${cents}::bigint else ${cents}::bigint end`,
        initialBalanceOn: balanceOn,
      })
      .returning({ id: accounts.id });

    return { accountId: row.id };
  });
}

// Neither `kind` nor the owner/group pivot is in the update grant, so an edit
// only touches these fields; `is_shared` toggles whether the group may write it.
export type UpdateAccountArgs = {
  accountId: string;
  name: string;
  subtype: AccountSubtype;
  isShared: boolean;
  institution: string | null;
  lastFour?: string | null;
  pesos: number;
  balanceOn: string;
};

export async function updateAccount({
  accountId,
  name,
  subtype,
  isShared,
  institution,
  lastFour,
  pesos,
  balanceOn,
}: UpdateAccountArgs): Promise<boolean> {
  const cents = pesosToCents(pesos);

  return withUserDb(async (tx) => {
    const rows = await tx
      .update(accounts)
      .set({
        name,
        // A bank account may become cash or the reverse; the kind holds it (RF-56).
        subtype,
        isShared,
        institution: institution === "" ? null : institution,
        lastFour: lastFour ? lastFour : null,
        // `kind` is immutable and absent from the grant, so it is read from
        // the row itself rather than named in this `set`. `cents` is cast
        // explicitly for the same reason as in `createAccount`.
        initialBalanceCents: sql`case when ${accounts.kind} = 'liability' then -${cents}::bigint else ${cents}::bigint end`,
        initialBalanceOn: balanceOn,
      })
      .where(eq(accounts.id, accountId))
      .returning({ id: accounts.id });

    return rows.length > 0;
  });
}

export async function archiveAccount({
  accountId,
}: {
  accountId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(accounts)
      .set({ archivedAt: sql`now()` })
      .where(eq(accounts.id, accountId))
      .returning({ id: accounts.id });

    return rows.length > 0;
  });
}

export async function restoreAccount({
  accountId,
}: {
  accountId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(accounts)
      .set({ archivedAt: null })
      .where(eq(accounts.id, accountId))
      .returning({ id: accounts.id });

    return rows.length > 0;
  });
}

export async function deleteAccount({
  accountId,
}: {
  accountId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .delete(accounts)
      .where(eq(accounts.id, accountId))
      .returning({ id: accounts.id });

    return rows.length > 0;
  });
}
