import "server-only";

export type OwnerNetWorth = {
  bucket: "member" | "group";
  ownerUserId: string | null;
  groupId: string | null;
  netWorthCents: number;
};

/**
 * Net worth per owner, folded from the already-fanned `listAccounts` and
 * `getAccountBalances` outputs — a PURE reducer, no round trip of its own
 * (RF-88, RNF-09). A personal account sums into its member's bucket, a group
 * account into the single group bucket, and the group's accounts are never
 * split across members (RF-67). Each balance is derived from movements upstream
 * (RNF-07), and a liability's is already negative, so this signed sum IS net
 * worth with no per-kind branch (RNF-05).
 */
export function netWorthByOwner(
  accounts: { id: string; ownerUserId: string | null; groupId: string | null }[],
  balances: { accountId: string; balanceCents: number }[],
): OwnerNetWorth[] {
  const balanceByAccount = new Map(
    balances.map((balance) => [balance.accountId, balance.balanceCents]),
  );

  const buckets = new Map<string, OwnerNetWorth>();
  for (const account of accounts) {
    const balanceCents = balanceByAccount.get(account.id) ?? 0;

    // The owner-XOR-group check pins each account to exactly one bucket; an
    // account naming neither belongs nowhere and is skipped.
    let key: string;
    let seed: OwnerNetWorth;
    if (account.ownerUserId !== null) {
      key = `member:${account.ownerUserId}`;
      seed = { bucket: "member", ownerUserId: account.ownerUserId, groupId: null, netWorthCents: 0 };
    } else if (account.groupId !== null) {
      key = `group:${account.groupId}`;
      seed = { bucket: "group", ownerUserId: null, groupId: account.groupId, netWorthCents: 0 };
    } else {
      continue;
    }

    const existing = buckets.get(key) ?? seed;
    existing.netWorthCents += balanceCents;
    buckets.set(key, existing);
  }

  return [...buckets.values()];
}
