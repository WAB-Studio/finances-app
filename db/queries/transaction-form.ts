import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { cache } from "react";

import { listAccounts } from "@/db/queries/accounts";
import type { AccountRow } from "@/db/queries/accounts";
import { listScopedCategories } from "@/db/queries/categories";
import type { ScopedCategoryNode } from "@/db/queries/categories";
import { listCallerMembers } from "@/db/queries/group-members";
import { listScopedLabels } from "@/db/queries/labels";
import type { ScopedLabelRow } from "@/db/queries/labels";
import { accounts, transactions } from "@/db/schema";
import { getSessionUser, requireUser, withUserDb } from "@/db/session";
import { BASE_CURRENCY, currencySchema } from "@/lib/currency";

// A category carries the scope it was read for (RF-62), so the form can tell a
// personal category apart from the group's without a second lookup.
export type ScopedCategory = ScopedCategoryNode;

// A label carries its scope for the same reason (RF-70): a movement's labels
// must share its scope, and the picker tells the two sets apart with no lookup.
export type ScopedLabel = ScopedLabelRow;

// A code a selector may hold. A row may carry another one — the column is the
// shape of ISO 4217, not a list — and the form reads that as the base currency
// rather than as a value no item names.
export type OfferedCurrency = typeof currencySchema.def.entries[keyof typeof currencySchema.def.entries];

export type TransactionFormOptions = {
  accounts: AccountRow[];
  categories: ScopedCategory[];
  labels: ScopedLabel[];
  members: { userId: string; name: string }[];
  lastUsedAccountId: string | null;
  // What each selectable account settles in (RF-121), so the form knows when to
  // ask for the second amount without going back to the server for it.
  accountCurrencies: Record<string, OfferedCurrency>;
};

/**
 * Everything the write screen needs to open, in one fan-out. Every read resolves
 * the caller's group inside its own statement, so there is no guard transaction
 * to wait behind and the group half of a set costs no read of its own.
 *
 * Deduplicated per request: the shell fetches this for quick entry and the page
 * under it asks for the same options, and one read serves both (RF-22).
 */
export const getTransactionFormOptions = cache(
  async function getTransactionFormOptions(): Promise<TransactionFormOptions> {
    const user = await requireUser();

    const [
      accountRows,
      categories,
      labels,
      members,
      lastUsedAccountId,
      accountCurrencies,
    ] = await Promise.all([
      listAccounts({ archived: false }),
      listScopedCategories(user.id),
      listScopedLabels(user.id),
      listCallerMembers(user.id, { archived: false }),
      getLastUsedAccountId(),
      listAccountCurrencies(),
    ]);

    return {
      accounts: accountRows,
      categories,
      labels,
      // Only members who have claimed a login can be a movement's creator (RF-25).
      members: members.flatMap((member) =>
        member.userId ? [{ userId: member.userId, name: member.name }] : [],
      ),
      lastUsedAccountId,
      accountCurrencies,
    };
  },
);

// The settlement currency of every account the caller may read, keyed by id
// (RF-121). Its own read, fanned out with the rest: the roster it rides beside
// does not carry the column yet, and one more statement in the same fan-out
// costs no wall time.
async function listAccountCurrencies(): Promise<
  Record<string, OfferedCurrency>
> {
  const offered = currencySchema.catch(BASE_CURRENCY);

  return withUserDb(async (tx) => {
    const rows = await tx
      .select({ id: accounts.id, currency: accounts.settlementCurrency })
      .from(accounts);

    return Object.fromEntries(
      rows.map((row) => [row.id, offered.parse(row.currency)]),
    );
  });
}

// The account the quick-entry field defaults to (RF-22): the source of the
// caller's most recent movement, or its destination for an income, or null when
// they have recorded nothing yet.
export async function getLastUsedAccountId(): Promise<string | null> {
  const user = await getSessionUser();
  if (!user) return null;

  return withUserDb(async (tx) => {
    const [row] = await tx
      .select({
        accountId: sql<
          string | null
        >`coalesce(${transactions.fromAccountId}, ${transactions.toAccountId})`,
      })
      .from(transactions)
      .where(eq(transactions.createdBy, user.id))
      .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt))
      .limit(1);

    return row?.accountId ?? null;
  });
}

/**
 * A display name per creator id (RF-25): a creator who is a group member reads as
 * that member's name, an archived member included, since a movement outlives the
 * member who recorded it. The email is the caller's own affordance only — it
 * stands in for their own id when it names no member, never for another user's.
 */
export async function resolveCreatorNames(
  userIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  const unique = [...new Set(userIds)];
  if (unique.length === 0) return names;

  // No round trip of its own: the session is already verified for the request.
  const user = await getSessionUser();
  if (!user) return names;

  // Archived members carry a name too, so one read covers both rosters.
  const members = await listCallerMembers(user.id, { archived: "all" });

  const memberNames = new Map(
    members.flatMap((member) =>
      member.userId ? [[member.userId, member.name] as const] : [],
    ),
  );

  for (const id of unique) {
    const memberName = memberNames.get(id);
    if (memberName) {
      names.set(id, memberName);
    } else if (id === user.id) {
      names.set(id, user.email);
    }
  }

  return names;
}
