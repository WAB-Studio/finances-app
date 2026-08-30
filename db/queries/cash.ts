import "server-only";

import { and, asc, desc, eq, isNull, ne, or, sql } from "drizzle-orm";

import type { AccountRow } from "@/db/queries/accounts";
import { getUserGroup } from "@/db/queries/groups";
import { accounts } from "@/db/schema";
import { requireUser, withUserDb } from "@/db/session";

// Where a cash withdrawal lands and what it may draw from (RF-68). The target is
// the sole `subtype = 'efectivo'` account the mode points at; `sourceAccounts`
// are the non-cash asset accounts the caller may write, i.e. what a withdrawal
// takes money out of. `reason` names why a target is missing, so the caller can
// decide to create-on-demand — a write path this read never takes.
export type WithdrawalTarget = {
  targetCashAccountId: string | null;
  sourceAccounts: AccountRow[];
  reason?: "no-cash-account";
};

const accountRowColumns = {
  id: accounts.id,
  name: accounts.name,
  kind: accounts.kind,
  subtype: accounts.subtype,
  institution: accounts.institution,
  ownerUserId: accounts.ownerUserId,
  groupId: accounts.groupId,
  isShared: accounts.isShared,
  initialBalanceCents: accounts.initialBalanceCents,
  initialBalanceOn: accounts.initialBalanceOn,
  archivedAt: accounts.archivedAt,
} as const;

/**
 * Resolves a withdrawal's cash destination and its possible sources. The group
 * and its `cash_mode` come first because they name where the cash sits: shared
 * cash is the group's one `efectivo` account, per-member cash is the caller's
 * own, and a personal-only user (RF-55) draws to their own cash if it exists.
 * The target lookup and the source list are independent, so they fan out.
 */
export async function resolveWithdrawalTarget(): Promise<WithdrawalTarget> {
  const user = await requireUser();
  const group = await getUserGroup();

  // 'shared' points at the group's cash; every other case points at the caller's
  // own, which never resolves to another member's account.
  const targetScope =
    group?.cashMode === "shared"
      ? eq(accounts.groupId, group.id)
      : eq(accounts.ownerUserId, user.id);

  const [targetCashAccountId, sourceAccounts] = await Promise.all([
    findCashAccountId(targetScope),
    listWithdrawalSources(user.id),
  ]);

  if (targetCashAccountId === null) {
    return { targetCashAccountId, sourceAccounts, reason: "no-cash-account" };
  }

  return { targetCashAccountId, sourceAccounts };
}

// The one live `efectivo` account inside the given scope, RLS-scoped on top. A
// stable order keeps the pick deterministic if a scope ever holds more than one.
async function findCashAccountId(
  scope: ReturnType<typeof eq>,
): Promise<string | null> {
  return withUserDb(async (tx) => {
    const [row] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(scope, eq(accounts.subtype, "efectivo"), isNull(accounts.archivedAt)))
      .orderBy(asc(accounts.createdAt))
      .limit(1);

    return row?.id ?? null;
  });
}

// The caller's writable, live, non-cash asset accounts — what a withdrawal draws
// FROM. Writable is own-or-shared, mirroring the accounts INSERT policy; the
// `efectivo` subtype is excluded so cash never draws from cash.
async function listWithdrawalSources(userId: string): Promise<AccountRow[]> {
  return withUserDb(async (tx) =>
    tx
      .select(accountRowColumns)
      .from(accounts)
      .where(
        and(
          eq(accounts.kind, "asset"),
          ne(accounts.subtype, "efectivo"),
          isNull(accounts.archivedAt),
          or(eq(accounts.ownerUserId, userId), eq(accounts.isShared, true)),
        ),
      )
      .orderBy(desc(sql`${accounts.ownerUserId} is not null`), asc(accounts.name)),
  );
}
