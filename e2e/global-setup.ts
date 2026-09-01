/**
 * Layer 3's ground: the browser's login, the rows the specs read, and the
 * teardown that drops them. Playwright calls the default export once, before any
 * spec, and calls the function it returns once after the last one.
 *
 * The login uses no mailbox. `magicLinkUrl()` formats the app's own
 * `/auth/confirm` link from the token hash layer 2 reads over the direct
 * connection, a browser visits it, and the cookies that land are saved as the
 * storage state every spec starts from. No special user, no email, no fixture
 * that fakes a session.
 *
 * Every row here belongs to the harness's own user, which nothing else writes,
 * so the purge below is a reset rather than a deletion of someone's data. It runs
 * at both ends: a crashed run leaves the next one a clean queue.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { chromium, test as base } from "@playwright/test";
import type { TransactionSql } from "postgres";

import { TIME_ZONE } from "@/lib/locales";

import { fixtureSql } from "../scripts/harness/fixtures";
import { harnessSession, magicLinkUrl } from "../scripts/harness/session";

export const STORAGE_STATE = "private/harness-storage.json";

const SCOPE_FILE = resolve(process.cwd(), "private/harness-e2e.json");

export type E2eScope = {
  userId: string;
  accountId: string;
  accountName: string;
  categoryId: string;
  categoryName: string;
};

/**
 * The specs' entry point instead of `@playwright/test`'s own: every one of them
 * reads the database back, and the pool has to be closed or the worker outlives
 * its tests.
 */
export const test = base.extend<object, { harnessDatabase: void }>({
  harnessDatabase: [
    // The empty pattern is required: Playwright reads the destructuring to learn
    // which fixtures this one depends on, and it depends on none.
    async ({}, use) => {
      await use();
      await fixtureSql.end();
    },
    { scope: "worker", auto: true },
  ],
});

export function readScope(): E2eScope {
  return JSON.parse(readFileSync(SCOPE_FILE, "utf8")) as E2eScope;
}

// The claims the stamping triggers read: a fixture writes as the owner role but
// speaks for the harness user, so `auth.uid()` resolves inside every trigger.
function claimsFor(userId: string): string {
  return JSON.stringify({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
  });
}

/**
 * Runs `fn` in one transaction that speaks for the harness user, which is what
 * the stamping triggers read, while the owner's privileges do the writing. A
 * spec seeds its own rows through this and drops them itself; nothing here is
 * tracked, so a spec that leaks a row leaks it until the teardown purge.
 */
export async function asHarnessUser(
  fn: (tx: TransactionSql) => Promise<void>,
): Promise<void> {
  const { userId } = readScope();

  await fixtureSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claimsFor(userId)}, true)`;
    await fn(tx);
  });
}

export type SeedDelivery = {
  merchant: string | null;
  amountCents: number | null;
  accountId: string | null;
  categoryId: string | null;
  categorySource: "merchant" | "interpreter" | "credential_default" | null;
  // Writes the merchant memory as already trusted, which is what makes a card
  // complete enough to accept in one tap (RF-94).
  trusted?: boolean;
  text?: string;
};

/**
 * Replaces the queue with exactly these deliveries, so a test states the state it
 * runs against instead of inheriting the previous test's.
 */
export async function seedQueue(rows: SeedDelivery[]): Promise<string[]> {
  const { userId } = readScope();

  await clearQueue();

  const ids: string[] = [];

  await fixtureSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claimsFor(userId)}, true)`;

    for (const row of rows) {
      const text =
        row.text ?? `Bancolombia: Compraste en ${row.merchant ?? "un comercio"}`;
      const merchantKey = row.merchant?.toUpperCase() ?? null;

      // The memory goes first: the queue joins a delivery to it by merchant key.
      if (row.trusted && merchantKey && row.categoryId) {
        await tx`
          insert into ingest_merchants (
            owner_user_id, merchant_key, merchant_label, state, trusted_category_id, streak)
          values (${userId}, ${merchantKey}, ${row.merchant}, 'trusted', ${row.categoryId}, 2)`;
      }

      const [delivery] = await tx<{ id: string }[]>`
        insert into ingest_deliveries (
          external_ref, raw_text, shape_hash, merchant_key, merchant_label,
          proposed_amount_cents, proposed_account_id, proposed_category_id,
          category_source, proposed_direction, proposed_occurred_at, proposed_description)
        values (
          ${randomUUID()},
          ${text},
          ${createHash("sha256").update(text).digest("hex")},
          ${merchantKey},
          ${row.merchant},
          ${row.amountCents},
          ${row.accountId},
          ${row.categoryId},
          ${row.categorySource},
          'expense',
          (now() at time zone ${TIME_ZONE})::date,
          ${row.merchant})
        returning id`;

      ids.push(delivery.id);
    }
  });

  return ids;
}

export async function clearQueue(): Promise<void> {
  const { userId } = readScope();

  await fixtureSql`delete from ingest_deliveries where owner_user_id = ${userId}`;
  await fixtureSql`delete from ingest_shapes where owner_user_id = ${userId}`;
  await fixtureSql`delete from ingest_merchants where owner_user_id = ${userId}`;
}

export async function clearLedger(): Promise<void> {
  const { userId } = readScope();

  // A delivery points at the movement it recorded, and the queue is what a spec
  // reads next, so it goes first. Splits and labels ride the movement's cascade:
  // deleting a split on its own trips the trigger that keeps an expense carrying
  // one, and that trigger stands down only once the parent is gone.
  await fixtureSql`delete from ingest_deliveries where owner_user_id = ${userId}`;
  await fixtureSql`delete from transactions where owner_user_id = ${userId}`;
  await fixtureSql`delete from recurring_rules where owner_user_id = ${userId}`;
}

/**
 * One generated movement still awaiting review (RF-31), which is what raises the
 * dashboard's other amber badge — the pair is what the overflow test needs.
 */
export async function seedUnreviewedMovement(): Promise<void> {
  const scope = readScope();

  await fixtureSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claimsFor(scope.userId)}, true)`;

    const [rule] = await tx<{ id: string }[]>`
      insert into recurring_rules (
        from_account_id, amount_cents, category_id, description,
        frequency, interval_n, day_of_month, next_run_on)
      values (
        ${scope.accountId}, 1500000, ${scope.categoryId}, 'Harness recurrente',
        'monthly', 1, 1, (now() at time zone ${TIME_ZONE})::date)
      returning id`;

    const [movement] = await tx<{ id: string }[]>`
      insert into transactions (
        from_account_id, amount_cents, occurred_at, description, recurring_rule_id)
      values (
        ${scope.accountId}, 1500000, (now() at time zone ${TIME_ZONE})::date,
        'Harness generado', ${rule.id})
      returning id`;

    await tx`
      insert into transaction_splits (transaction_id, category_id, amount_cents)
      values (${movement.id}, ${scope.categoryId}, 1500000)`;
  });
}

// Everything the harness user owns, child before parent. The specs write through
// the interface, so the rows a run leaves behind are not all tracked by id, and a
// run must end at the row counts it found — `audit_log` excepted, which no
// harness ever deletes from.
async function purge(userId: string): Promise<void> {
  await fixtureSql`delete from ingest_deliveries where owner_user_id = ${userId}`;
  await fixtureSql`delete from ingest_shapes where owner_user_id = ${userId}`;
  await fixtureSql`delete from ingest_merchants where owner_user_id = ${userId}`;
  // A contribution is named before its goal even though it cascades: an aporte
  // that outlived its goal would be a leak no later count could explain.
  await fixtureSql`
    delete from goal_contributions
    where goal_id in (select id from savings_goals where owner_user_id = ${userId})`;
  await fixtureSql`delete from savings_goals where owner_user_id = ${userId}`;
  await fixtureSql`delete from budgets where owner_user_id = ${userId}`;
  await fixtureSql`delete from planned_payments where owner_user_id = ${userId}`;
  // These three hang off an account rather than off a user. `debt_terms` goes
  // before `accounts` in particular: its row is what makes an account's deletion
  // fail rather than cascade.
  await fixtureSql`
    delete from installment_plans
    where account_id in (select id from accounts where owner_user_id = ${userId})`;
  await fixtureSql`
    delete from debt_statements
    where account_id in (select id from accounts where owner_user_id = ${userId})`;
  await fixtureSql`
    delete from debt_terms
    where account_id in (select id from accounts where owner_user_id = ${userId})`;
  // Splits and labels ride the movement's cascade; see `clearLedger`.
  await fixtureSql`delete from transactions where owner_user_id = ${userId}`;
  await fixtureSql`delete from recurring_rules where owner_user_id = ${userId}`;
  await fixtureSql`delete from webhook_credentials where owner_user_id = ${userId}`;
  await fixtureSql`delete from labels where owner_user_id = ${userId}`;
  await fixtureSql`delete from categories where owner_user_id = ${userId}`;
  await fixtureSql`delete from accounts where owner_user_id = ${userId}`;
  // The group goes before its members: `assert_group_keeps_leader` refuses to
  // leave a live group leaderless, and the cascade from a deleted group is the
  // one path that may take a leader row with it.
  await fixtureSql`
    delete from groups
    where id in (select group_id from group_members where user_id = ${userId})`;
  await fixtureSql`delete from group_members where user_id = ${userId}`;
}

async function seedScope(userId: string): Promise<E2eScope> {
  const scope: E2eScope = {
    userId,
    accountId: randomUUID(),
    accountName: "Cuenta de la bandeja",
    categoryId: randomUUID(),
    categoryName: "Mercado de prueba",
  };

  await fixtureSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claimsFor(userId)}, true)`;

    await tx`
      insert into accounts (
        id, owner_user_id, name, kind, subtype, initial_balance_cents, initial_balance_on)
      values (
        ${scope.accountId}, ${userId}, ${scope.accountName}, 'asset', 'bancaria',
        5000000, (now() at time zone ${TIME_ZONE})::date)`;

    await tx`
      insert into categories (id, owner_user_id, name, kind, color)
      values (${scope.categoryId}, ${userId}, ${scope.categoryName}, 'expense', '#4C8C4A')`;
  });

  return scope;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const session = await harnessSession();
  const userId = session.user.id;

  await purge(userId);
  const scope = await seedScope(userId);
  // `private/` is gitignored, so a fresh clone reaches this write without it.
  mkdirSync(dirname(SCOPE_FILE), { recursive: true });
  writeFileSync(SCOPE_FILE, `${JSON.stringify(scope, null, 2)}\n`, "utf8");

  const link = await magicLinkUrl();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(link);
  await page.waitForLoadState("networkidle");

  if (page.url().includes("/login")) {
    await browser.close();
    throw new Error(`the magic link landed on the login: ${page.url()}`);
  }

  await page.context().storageState({ path: STORAGE_STATE });
  await browser.close();

  console.log(`harness user ${userId} <${session.user.email}> signed in through /auth/confirm`);

  return async () => {
    try {
      await purge(userId);
    } finally {
      await fixtureSql.end();
    }
  };
}
