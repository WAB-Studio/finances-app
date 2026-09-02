/**
 * The ledger, which no check had opened: the rows render, a filter narrows them
 * in Postgres and clearing brings them back. The filters live in the URL so the view
 * is shareable (RF-23, RNF-09), which is why the query string is asserted
 * alongside what is on screen.
 *
 * The two movements are seeded rather than written through the interface: this
 * spec is about reading a ledger that already holds both kinds.
 */
import { randomUUID } from "node:crypto";

import { expect } from "@playwright/test";

import messages from "@/messages/es.json";
import { TIME_ZONE } from "@/lib/locales";

import { fixtureSql } from "../scripts/harness/fixtures";
import { asHarnessUser, clearLedger, readScope, test } from "./global-setup";

const transactions = messages.transactions;
const common = messages.common;
const scope = readScope();

// A row is titled by its first split's category, so the income row needs a
// category of its own to be told apart from the expense's.
const incomeCategoryId = randomUUID();
const incomeCategoryName = `Ingreso ${randomUUID().slice(0, 8)}`;

const EXPENSE_CENTS = 3200000;
const INCOME_CENTS = 7100000;

test.beforeEach(async () => {
  await clearLedger();

  await asHarnessUser(async (tx) => {
    await tx`
      insert into categories (id, owner_user_id, name, kind, color)
      values (${incomeCategoryId}, ${scope.userId}, ${incomeCategoryName}, 'income', '#4C8C4A')`;

    const [expense] = await tx<{ id: string }[]>`
      insert into transactions (from_account_id, amount_cents, occurred_at, description)
      values (
        ${scope.accountId}, ${EXPENSE_CENTS},
        (now() at time zone ${TIME_ZONE})::date, 'Harness gasto')
      returning id`;
    await tx`
      insert into transaction_splits (transaction_id, category_id, amount_cents)
      values (${expense.id}, ${scope.categoryId}, ${EXPENSE_CENTS})`;

    const [income] = await tx<{ id: string }[]>`
      insert into transactions (to_account_id, amount_cents, occurred_at, description)
      values (
        ${scope.accountId}, ${INCOME_CENTS},
        (now() at time zone ${TIME_ZONE})::date, 'Harness ingreso')
      returning id`;
    await tx`
      insert into transaction_splits (transaction_id, category_id, amount_cents)
      values (${income.id}, ${incomeCategoryId}, ${INCOME_CENTS})`;
  });
});

test.afterEach(async () => {
  await clearLedger();
  await fixtureSql`delete from categories where id = ${incomeCategoryId}`;
});

test("lists both movements, narrows to one by kind and restores them on clear", async ({
  page,
}, testInfo) => {
  // Both shapes stay mounted at every width and CSS displays one of them, so a
  // page-wide locator matches the hidden one too. Every locator here is scoped
  // to the shape this project's viewport renders, and each viewport narrows
  // through the control it actually shows: the laptop's Tipo select and its
  // chip, the phone's segmented chips and its filter panel.
  const desktop = testInfo.project.name === "desktop";
  const ledger = page.getByRole("table", { name: transactions.listTitle });
  // On the laptop a row is named by its category cell; on the phone the whole
  // card is one link, and the category is its title.
  const rowFor = (category: string) =>
    desktop
      ? ledger.getByText(category, { exact: true })
      : page.getByRole("link", { name: category });

  const expenseRow = rowFor(scope.categoryName);
  const incomeRow = rowFor(incomeCategoryName);

  await page.goto("/es/movements");
  await expect(expenseRow).toBeVisible();
  await expect(incomeRow).toBeVisible();

  // The kind the control names is derived from the accounts the movement
  // carries — never stored, never chosen (RF-19).
  if (desktop) {
    await page.getByLabel(transactions.typeLabel, { exact: true }).click();
    await page
      .getByRole("option", { name: transactions.filterIncome, exact: true })
      .click();
  } else {
    await page
      .getByRole("radio", { name: transactions.filterIncome, exact: true })
      .click();
  }

  await expect(page).toHaveURL("/es/movements?type=income");
  await expect(incomeRow).toBeVisible();
  await expect(expenseRow).toHaveCount(0);

  // Clearing drops the key rather than emptying it: on the laptop from the chip
  // that names the narrowing, on the phone from the filter panel.
  if (desktop) {
    await page
      .getByRole("button", {
        name: common.removeFilter.replace("{label}", transactions.filterIncome),
        exact: true,
      })
      .click();
  } else {
    await page
      .getByRole("button", { name: transactions.filtersLabel, exact: true })
      .click();
    await page
      .getByRole("button", { name: transactions.clearFilters, exact: true })
      .click();
  }

  await expect(page).toHaveURL("/es/movements");
  await expect(expenseRow).toBeVisible();
  await expect(incomeRow).toBeVisible();
});
