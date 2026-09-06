/**
 * The two report surfaces, neither of which any check had opened: the dashboard's
 * month flow (RF-88) and the reports screen's expenses-by-category breakdown
 * (RF-34) over its six-month series (RF-35). Layer 1 proves the figures the
 * queries return; what it cannot prove is that they reach a screen — the whole
 * next-intl catalogue ships in the page payload, so a heading matches even when
 * nothing rendered.
 *
 * A transfer sits in the same window as the income and the expense, so every
 * figure below is asserted at the value that excludes it (RF-19).
 */
import { randomUUID } from "node:crypto";

import { expect, type Locator, type Page } from "@playwright/test";

import messages from "@/messages/es.json";
import { TIME_ZONE } from "@/lib/locales";

import { fixtureSql } from "../scripts/harness/fixtures";
import { asHarnessUser, clearLedger, readScope, test } from "./global-setup";

const dashboard = messages.dashboard;
const reports = messages.reports;

const scope = readScope();

// The income needs a category of its own: a split shares its movement's kind.
const incomeCategoryId = randomUUID();
const incomeCategoryName = `Ingreso reportes ${randomUUID().slice(0, 8)}`;
// The transfer needs a second account, which is what makes it a transfer at all.
const secondAccountId = randomUUID();

const EXPENSE_CENTS = 4_300_000;
const INCOME_CENTS = 9_100_000;
const TRANSFER_CENTS = 5_500_000;
// Last month's expense, inside the six-month window and outside this month's.
const PRIOR_EXPENSE_CENTS = 2_100_000;

// The digits of a rendered amount: the separators and the currency mark are
// `Intl`'s, and the browser's ICU need not agree with Node's.
async function digitsOf(locator: Locator): Promise<string> {
  return ((await locator.innerText()).match(/\d/g) ?? []).join("");
}

// COP shows no decimals, so an integer number of pesos is what a figure reads as.
function pesos(cents: number): string {
  return String(cents / 100);
}

// A dashboard month figure sits under its own label, which carries no digits.
function monthStat(page: Page, label: string): Locator {
  return page.getByText(label, { exact: true }).locator("..");
}

// One bar's drawn height against another's. Both are drawn against the same
// axis, so what comes out is the ratio of the two figures.
async function barRatio(bar: Locator, against: Locator): Promise<number> {
  const [height, other] = await Promise.all([
    bar.getAttribute("height"),
    against.getAttribute("height"),
  ]);

  return Number(height) / Number(other);
}

test.beforeAll(async () => {
  await clearLedger();

  await asHarnessUser(async (tx) => {
    await tx`
      insert into categories (id, owner_user_id, name, kind, color)
      values (${incomeCategoryId}, ${scope.userId}, ${incomeCategoryName}, 'income', '#4C8C4A')`;

    await tx`
      insert into accounts (
        id, owner_user_id, name, kind, subtype, initial_balance_cents, initial_balance_on)
      values (
        ${secondAccountId}, ${scope.userId}, 'Cuenta de los reportes', 'asset', 'bancaria',
        9000000, (now() at time zone ${TIME_ZONE})::date)`;

    const [expense] = await tx<{ id: string }[]>`
      insert into transactions (from_account_id, amount_cents, occurred_at, description)
      values (
        ${scope.accountId}, ${EXPENSE_CENTS},
        (now() at time zone ${TIME_ZONE})::date, 'Harness gasto del mes')
      returning id`;
    await tx`
      insert into transaction_splits (transaction_id, category_id, amount_cents)
      values (${expense.id}, ${scope.categoryId}, ${EXPENSE_CENTS})`;

    const [income] = await tx<{ id: string }[]>`
      insert into transactions (to_account_id, amount_cents, occurred_at, description)
      values (
        ${scope.accountId}, ${INCOME_CENTS},
        (now() at time zone ${TIME_ZONE})::date, 'Harness ingreso del mes')
      returning id`;
    await tx`
      insert into transaction_splits (transaction_id, category_id, amount_cents)
      values (${income.id}, ${incomeCategoryId}, ${INCOME_CENTS})`;

    // Neither an income nor an expense, and it carries no split (RF-19).
    await tx`
      insert into transactions (
        from_account_id, to_account_id, amount_cents, occurred_at, description)
      values (
        ${scope.accountId}, ${secondAccountId}, ${TRANSFER_CENTS},
        (now() at time zone ${TIME_ZONE})::date, 'Harness traslado')`;

    // The last day of the previous month: a second populated bar in the series.
    const [prior] = await tx<{ id: string }[]>`
      insert into transactions (from_account_id, amount_cents, occurred_at, description)
      values (
        ${scope.accountId}, ${PRIOR_EXPENSE_CENTS},
        (date_trunc('month', now() at time zone ${TIME_ZONE}) - interval '1 day')::date,
        'Harness gasto del mes pasado')
      returning id`;
    await tx`
      insert into transaction_splits (transaction_id, category_id, amount_cents)
      values (${prior.id}, ${scope.categoryId}, ${PRIOR_EXPENSE_CENTS})`;
  });
});

test.afterAll(async () => {
  await clearLedger();
  await fixtureSql`delete from accounts where id = ${secondAccountId}`;
  await fixtureSql`delete from categories where id = ${incomeCategoryId}`;
});

test("the dashboard reads the month's income, expense and net, the transfer in neither", async ({
  page,
}) => {
  await page.goto("/es");

  expect(await digitsOf(monthStat(page, dashboard.monthIncome))).toBe(
    pesos(INCOME_CENTS),
  );
  expect(await digitsOf(monthStat(page, dashboard.monthExpense))).toBe(
    pesos(EXPENSE_CENTS),
  );
  expect(await digitsOf(monthStat(page, dashboard.monthNet))).toBe(
    pesos(INCOME_CENTS - EXPENSE_CENTS),
  );
});

test("the breakdown reads the month's expense under its category", async ({
  page,
}) => {
  await page.goto("/es/reports");

  const row = page.getByText(scope.categoryName, { exact: true }).locator("..");

  await expect(row).toBeVisible();
  // This month's expense alone: last month's split is outside the window and the
  // transfer carries no split at all.
  expect(await digitsOf(row)).toBe(pesos(EXPENSE_CENTS));
});

test("the six-month series draws each month's figures", async ({ page }) => {
  await page.goto("/es/reports");

  const chart = page.getByRole("img", { name: reports.comparisonTitle });
  // The container measures itself before Recharts draws into it.
  await expect(chart.locator("svg")).toBeVisible();

  // The screen's own series colours: jade carries income, tomato expense. A month
  // with no movement draws no bar, so these counts are the populated months — and
  // the transfer, which is neither, adds no bar of its own (RF-19).
  const incomeBars = chart.locator('path[fill="var(--jade-9)"]');
  const expenseBars = chart.locator('path[fill="var(--tomato-9)"]');

  await expect(incomeBars).toHaveCount(1);
  await expect(expenseBars).toHaveCount(2);

  // A bar's height is linear in the figure behind it, so a ratio of heights is the
  // ratio of the figures. A transfer summed as an expense would lift this month's
  // expense above its income and turn the first ratio upside down.
  await expect
    .poll(() => barRatio(incomeBars.first(), expenseBars.last()))
    .toBeCloseTo(INCOME_CENTS / EXPENSE_CENTS, 2);
  // Oldest first, so the first tomato bar is last month's expense.
  await expect
    .poll(() => barRatio(expenseBars.first(), expenseBars.last()))
    .toBeCloseTo(PRIOR_EXPENSE_CENTS / EXPENSE_CENTS, 2);
});

test.describe("a second currency on the dashboard", () => {
  // Held for this describe alone: a USD account in the shared fixture above
  // would draw a second "en USD" band under the two tests that read the COP
  // figures by a bare label, and dying on strict mode is not what proves RF-124.
  const usdAccountId = randomUUID();
  const usdIncomeCategoryId = randomUUID();
  const usdIncomeCategoryName = `Ingreso USD ${randomUUID().slice(0, 8)}`;

  // The stored scale is hundredths of the major unit for every currency alike
  // (RNF-05): $650.00 and $120.00 land as 65000 and 12000, no float involved.
  const USD_OPENING_CENTS = 65_000;
  const USD_INCOME_CENTS = 12_000;

  test.beforeAll(async () => {
    await asHarnessUser(async (tx) => {
      await tx`
        insert into categories (id, owner_user_id, name, kind, color)
        values (${usdIncomeCategoryId}, ${scope.userId}, ${usdIncomeCategoryName}, 'income', '#4C8C4A')`;

      await tx`
        insert into accounts (
          id, owner_user_id, name, kind, subtype, settlement_currency,
          initial_balance_cents, initial_balance_on)
        values (
          ${usdAccountId}, ${scope.userId}, 'Cuenta reportes USD', 'asset', 'bancaria', 'USD',
          ${USD_OPENING_CENTS}, (now() at time zone ${TIME_ZONE})::date)`;

      const [income] = await tx<{ id: string }[]>`
        insert into transactions (to_account_id, amount_cents, occurred_at, description)
        values (
          ${usdAccountId}, ${USD_INCOME_CENTS},
          (now() at time zone ${TIME_ZONE})::date, 'Harness ingreso en dólares')
        returning id`;
      await tx`
        insert into transaction_splits (transaction_id, category_id, amount_cents)
        values (${income.id}, ${usdIncomeCategoryId}, ${USD_INCOME_CENTS})`;
    });
  });

  test.afterAll(async () => {
    await fixtureSql`delete from transactions where to_account_id = ${usdAccountId}`;
    await fixtureSql`delete from accounts where id = ${usdAccountId}`;
    await fixtureSql`delete from categories where id = ${usdIncomeCategoryId}`;
  });

  // The band a currency draws its own month figures in (RF-124): "Ingresos del
  // mes" now repeats once per currency the fund holds, so a figure is read from
  // the section that names its own currency, never bare off the page.
  function currencyBlock(page: Page, currency: string): Locator {
    return page
      .getByText(reports.inCurrency.replace("{currency}", currency), { exact: true })
      .locator("..");
  }

  test("draws a second net worth and a second month flow, and neither is the peso figure plus the dollar one", async ({
    page,
  }) => {
    await page.goto("/es");

    // The peso figures still read at what the shared fixture wrote — summed
    // into the dollar income, this would be off by exactly USD_INCOME_CENTS.
    const copIncome = currencyBlock(page, "COP")
      .getByText(dashboard.monthIncome, { exact: true })
      .locator("..");
    expect(await digitsOf(copIncome)).toBe(pesos(INCOME_CENTS));

    const usdIncome = currencyBlock(page, "USD")
      .getByText(dashboard.monthIncome, { exact: true })
      .locator("..");
    expect(await digitsOf(usdIncome)).toBe(String(USD_INCOME_CENTS));

    // Its own net-worth heading, named by the currency alone — no bare label to
    // scope, since no other heading on the page reads "Patrimonio en USD".
    await expect(
      page.getByText(dashboard.netWorthIn.replace("{currency}", "USD"), {
        exact: true,
      }),
    ).toBeVisible();
  });
});
