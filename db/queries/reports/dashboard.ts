import "server-only";

import { getAccountBalances } from "@/db/queries/account-balances";
import { listAccounts } from "@/db/queries/accounts";
import { listMembers } from "@/db/queries/group-members";
import { getUserGroup } from "@/db/queries/groups";
import { getMonthlyFlow } from "@/db/queries/reports/monthly-flow";
import type { MonthlyFlow } from "@/db/queries/reports/monthly-flow";
import { netWorthByOwner } from "@/db/queries/reports/net-worth";
import type { OwnerNetWorth } from "@/db/queries/reports/net-worth";
import { countUnreviewedGenerated } from "@/db/queries/recurring-rules";
import { getSessionUser } from "@/db/session";
import { currentMonthRange } from "@/lib/dates";

// A net-worth bucket carrying the display name the dashboard renders: a member's
// name, the group's name, or null for the caller's own personal-only bucket
// (RF-55), which the component labels itself off `isSelf`.
export type OwnerNetWorthNamed = OwnerNetWorth & {
  name: string | null;
  isSelf: boolean;
};

export type DashboardData = {
  hasAccounts: boolean;
  netWorth: OwnerNetWorthNamed[];
  totalNetWorthCents: number;
  monthFlow: MonthlyFlow;
  // Generated movements still awaiting review — the "N sin revisar" badge (RF-31).
  unreviewedCount: number;
};

/**
 * The home dashboard's read-model: net worth per owner and this month's flow
 * (RF-88). Scope is never a parameter — every underlying query runs inside
 * `withUserDb`, so RLS restricts the rows to the caller and their one group.
 * The five independent reads fan out in one `Promise.all`; the roster is a
 * conditional second trip, taken only once a group is known.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const [accounts, balances, monthFlow, group, sessionUser, unreviewedCount] =
    await Promise.all([
      listAccounts({ archived: false }),
      getAccountBalances(),
      getMonthlyFlow(currentMonthRange()),
      getUserGroup(),
      getSessionUser(),
      countUnreviewedGenerated(),
    ]);

  // Only a grouped caller has a roster to name member buckets against; a
  // personal-only caller falls back to the `isSelf` label with no round trip.
  const members = group ? await listMembers(group.id, { archived: false }) : [];
  const nameByUserId = new Map(
    members
      .filter((member) => member.userId !== null)
      .map((member) => [member.userId as string, member.name]),
  );

  // A group account is one bucket, never split across its members (RF-67); the
  // signed sum of derived balances IS net worth with no per-kind branch (RNF-05).
  const buckets = netWorthByOwner(accounts, balances);

  const netWorth: OwnerNetWorthNamed[] = buckets.map((bucket) => {
    if (bucket.bucket === "group") {
      return { ...bucket, name: group?.name ?? null, isSelf: false };
    }

    const isSelf = bucket.ownerUserId !== null && bucket.ownerUserId === sessionUser?.id;
    return {
      ...bucket,
      name: bucket.ownerUserId ? nameByUserId.get(bucket.ownerUserId) ?? null : null,
      isSelf,
    };
  });

  const totalNetWorthCents = buckets.reduce(
    (total, bucket) => total + bucket.netWorthCents,
    0,
  );

  return {
    hasAccounts: accounts.length > 0,
    netWorth,
    totalNetWorthCents,
    monthFlow,
    unreviewedCount,
  };
}
