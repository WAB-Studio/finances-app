// The harness user and the rows a run needs to exist before it drives the app's
// own functions. Everything here goes over a direct `postgres` connection —
// never the app pool the queries under test open — and runs as the owner, which
// holds BYPASSRLS. Fixtures are the ground; only the code under test meets RLS.
import { randomUUID } from "node:crypto";

import postgres from "postgres";

import { TIME_ZONE } from "@/lib/locales";

export const fixtureSql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
});

// Child before parent: `cleanup` walks this order, so a tracked row never
// outlives a row that points at it — several of these foreign keys are ON DELETE
// RESTRICT. `audit_log` is absent on purpose: the trail is append-only and the
// RNF-14 purge is its only deleter, so a harness run never removes a row from it.
const CLEANUP_ORDER = [
  ["goal_contributions", "id"],
  ["transaction_labels", "transaction_id"],
  ["transaction_splits", "transaction_id"],
  ["installment_lines", "id"],
  ["installment_plans", "id"],
  ["debt_statements", "id"],
  ["debt_terms", "account_id"],
  ["budgets", "id"],
  ["planned_payments", "id"],
  ["recurring_rules", "id"],
  ["savings_goals", "id"],
  ["transactions", "id"],
  ["webhook_credentials", "id"],
  ["labels", "id"],
  ["categories", "id"],
  ["accounts", "id"],
  // The group goes before its members: `assert_group_keeps_leader` refuses to
  // leave a live group leaderless, and the cascade from a deleted group is the
  // one path that may take a leader row with it.
  ["groups", "id"],
  ["group_members", "id"],
] as const;

export type FixtureTable = (typeof CLEANUP_ORDER)[number][0];

// The rows the harness seeds for the caller: one group it leads, the three
// accounts a movement needs both ends of, and one category and label to file it under.
export type HarnessScope = {
  groupId: string;
  assetAccountId: string;
  cashAccountId: string;
  liabilityAccountId: string;
  categoryId: string;
  labelId: string;
};

export type HarnessUser = { id: string; email: string };

const tracked = new Map<FixtureTable, string[]>();
const harnessUsers: HarnessUser[] = [];

export function track(table: FixtureTable, id: string): void {
  const ids = tracked.get(table);
  if (ids) ids.push(id);
  else tracked.set(table, [id]);
}

/**
 * The run's own user, created here and dropped at the end, so runs repeat and no
 * real user's data is ever read or written. `id` is the only column `auth.users`
 * requires; a real sign-in fills the rest and nothing here reads them.
 */
export async function createHarnessUser(): Promise<string> {
  const { id, email } = await createUser();

  // The Supabase stub reads these, so they are set before any app module runs.
  process.env.HARNESS_USER_ID = id;
  process.env.HARNESS_USER_EMAIL = email;

  return id;
}

/**
 * A second user of the same make, left out of every group: `seedHarnessScope`
 * turns the run's own user into a leader, and RF-55 holds a user to one live
 * membership, so a create-a-fund path can only be driven by someone else.
 * Sets no environment: `asUser` decides when a call speaks for this identity.
 */
export async function createMembershipFreeUser(): Promise<HarnessUser> {
  return createUser();
}

async function createUser(): Promise<HarnessUser> {
  const id = randomUUID();
  const email = `harness-${id}@example.invalid`;

  await fixtureSql`insert into auth.users (id, email) values (${id}, ${email})`;
  await fixtureSql`insert into app_users (id) values (${id})`;

  harnessUsers.push({ id, email });

  return { id, email };
}

/**
 * Runs `fn` under another identity by moving the claims the Supabase stub reads.
 * `getVerifiedClaims` memoises through React's `cache`, which no-ops outside a
 * request, so each call re-reads the environment. Restores it even on a throw.
 */
export async function asUser<T>(
  user: HarnessUser,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = {
    id: process.env.HARNESS_USER_ID,
    email: process.env.HARNESS_USER_EMAIL,
  };

  process.env.HARNESS_USER_ID = user.id;
  process.env.HARNESS_USER_EMAIL = user.email;

  try {
    return await fn();
  } finally {
    // Assigning `undefined` would store the string "undefined" and hand the stub
    // a subject that is not a user.
    if (previous.id === undefined) delete process.env.HARNESS_USER_ID;
    else process.env.HARNESS_USER_ID = previous.id;
    if (previous.email === undefined) delete process.env.HARNESS_USER_EMAIL;
    else process.env.HARNESS_USER_EMAIL = previous.email;
  }
}

/**
 * The rows the suites read and write against. Written under the harness user's
 * claims but WITHOUT the role switch: the stamping triggers read `auth.uid()`
 * and see them, while the owner's privileges do the writing — so a fixture never
 * has to satisfy the column grants the code under test is measured against.
 */
export async function seedHarnessScope(userId: string): Promise<HarnessScope> {
  const scope: HarnessScope = {
    groupId: randomUUID(),
    assetAccountId: randomUUID(),
    cashAccountId: randomUUID(),
    liabilityAccountId: randomUUID(),
    categoryId: randomUUID(),
    labelId: randomUUID(),
  };
  const memberId = randomUUID();
  const claims = JSON.stringify({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
  });

  await fixtureSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;

    await tx`
      insert into groups (id, name, cash_mode)
      values (${scope.groupId}, 'Harness fund', 'per_member')`;

    await tx`
      insert into group_members (id, group_id, user_id, name, role)
      values (${memberId}, ${scope.groupId}, ${userId}, 'Harness leader', 'leader')`;

    // Personal placement throughout: the group exists so the group-scoped reads
    // take their non-empty branch, not so the fixtures live inside it.
    const today = tx`(now() at time zone ${TIME_ZONE})::date`;
    await tx`
      insert into accounts (id, owner_user_id, name, kind, subtype, initial_balance_cents, initial_balance_on)
      values
        (${scope.assetAccountId}, ${userId}, 'Harness bank', 'asset', 'bancaria', 5000000, ${today}),
        (${scope.cashAccountId}, ${userId}, 'Harness cash', 'asset', 'efectivo', 0, ${today}),
        (${scope.liabilityAccountId}, ${userId}, 'Harness card', 'liability', 'tarjeta', -300000, ${today})`;

    await tx`
      insert into categories (id, owner_user_id, name, kind, color)
      values (${scope.categoryId}, ${userId}, 'Harness groceries', 'expense', '#4C8C4A')`;

    await tx`
      insert into labels (id, owner_user_id, name, color)
      values (${scope.labelId}, ${userId}, 'Harness label', '#4C8C4A')`;
  });

  track("groups", scope.groupId);
  track("group_members", memberId);
  track("accounts", scope.assetAccountId);
  track("accounts", scope.cashAccountId);
  track("accounts", scope.liabilityAccountId);
  track("categories", scope.categoryId);
  track("labels", scope.labelId);

  return scope;
}

/**
 * Drops every tracked row, then every user it made. Runs from a `finally`, so a
 * failed assertion still leaves the database at the row counts it found — with
 * `audit_log` excepted, which no harness ever deletes from.
 */
export async function cleanup(): Promise<void> {
  try {
    for (const [table, idColumn] of CLEANUP_ORDER) {
      const ids = tracked.get(table);
      if (ids === undefined || ids.length === 0) continue;

      await fixtureSql`
        delete from ${fixtureSql(table)}
        where ${fixtureSql(idColumn)} in ${fixtureSql(ids)}`;
    }

    for (const { id } of harnessUsers) {
      // The auth row cascades to `app_users`; both are named so the deletion is
      // stated, not inferred from a foreign key.
      await fixtureSql`delete from app_users where id = ${id}`;
      await fixtureSql`delete from auth.users where id = ${id}`;
    }
  } finally {
    await fixtureSql.end();
  }
}
