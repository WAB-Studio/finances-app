/**
 * The consolidated debts screen, which no check had opened (RF-83): the total
 * owed across every liability, each card's available credit and the summed
 * estimated monthly interest. Layer 1 proves what `getDebtsScreenData` returns;
 * what it cannot prove is that the figures reach the screen — the whole next-intl
 * catalogue ships in the page payload, so a heading matches even when nothing
 * rendered.
 *
 * Two liabilities, only one of them carrying terms, so the total is a sum of
 * both while the interest comes from the one with a rate.
 */
import { randomUUID } from "node:crypto";

import { expect, type Locator, type Page } from "@playwright/test";

import messages from "@/messages/es.json";
import { TIME_ZONE } from "@/lib/locales";

import { fixtureSql } from "../scripts/harness/fixtures";
import { asHarnessUser, readScope, test } from "./global-setup";

const debts = messages.debts;

const scope = readScope();
const stamp = randomUUID().slice(0, 8);

const cardId = randomUUID();
const cardName = `Tarjeta deudas ${stamp}`;
const bareId = randomUUID();
const bareName = `Deuda sin términos ${stamp}`;

// Every balance is derived, so the opening figure of a liability is what it owes,
// stored negative (RNF-05).
const CARD_OWED_CENTS = 120_000_000;
const BARE_OWED_CENTS = 45_000_000;
const CREDIT_LIMIT_CENTS = 300_000_000;
const ANNUAL_RATE = 0.24;
const MINIMUM_PAYMENT_CENTS = 6_000_000;

// The effective twelfth-root step of the annual rate, never the linear rate/12
// (RF-79). Postgres rounds the same product in `numeric`, so the screen may land
// one cent away from this — a peso apart at the very most.
const MONTHLY_INTEREST_CENTS = Math.round(
  CARD_OWED_CENTS * ((1 + ANNUAL_RATE) ** (1 / 12) - 1),
);

// The digits of a rendered amount: the separators and the currency mark are
// `Intl`'s, and the browser's ICU need not agree with Node's.
async function digitsOf(locator: Locator): Promise<number> {
  const text = await locator.innerText();

  return Number((text.match(/\d/g) ?? []).join(""));
}

// COP shows no decimals, so an integer number of pesos is what a figure reads as.
function pesos(cents: number): number {
  return cents / 100;
}

/**
 * The band the width displays. Both are in the DOM at every width and they carry
 * the same words — `debts.total` and `debts.tileTotal` are one string — so a
 * locator that does not name a band matches twice and dies on strict mode.
 */
function band(page: Page): Locator {
  return page.locator("main > div > .rt-Box").filter({ visible: true });
}

/**
 * A figure the two bands state in their own shapes: the phone interpolates it
 * into a line, the laptop puts it in the tile under its label. Whichever band is
 * displayed, this is the one element that carries the digits.
 */
function statedAmount(page: Page, message: string, tileLabel: string): Locator {
  const shown = band(page);

  return shown
    .getByText(message.split("{")[0].trim())
    .or(
      shown
        // The tile's label and the table's column header read the same words; only
        // the tile is followed by its figure.
        .getByText(tileLabel, { exact: true })
        .locator("xpath=following-sibling::*[1]")
        .filter({ hasText: /\d/ }),
    );
}

test.beforeAll(async () => {
  await asHarnessUser(async (tx) => {
    const today = tx`(now() at time zone ${TIME_ZONE})::date`;

    await tx`
      insert into accounts (
        id, owner_user_id, name, kind, subtype, initial_balance_cents, initial_balance_on)
      values
        (${cardId}, ${scope.userId}, ${cardName}, 'liability', 'tarjeta',
          ${-CARD_OWED_CENTS}, ${today}),
        (${bareId}, ${scope.userId}, ${bareName}, 'liability', 'tarjeta',
          ${-BARE_OWED_CENTS}, ${today})`;

    // Only the first carries terms; the other owes without a rate (RF-78, RF-79).
    await tx`
      insert into debt_terms (
        account_id, debt_kind, annual_rate, minimum_payment_cents,
        credit_limit_cents, statement_cut_off_day, payment_due_day)
      values (
        ${cardId}, 'revolving', ${ANNUAL_RATE}, ${MINIMUM_PAYMENT_CENTS},
        ${CREDIT_LIMIT_CENTS}, 15, 5)`;
  });
});

test.afterAll(async () => {
  await fixtureSql`delete from debt_terms where account_id = ${cardId}`;
  await fixtureSql`delete from accounts where id in ${fixtureSql([cardId, bareId])}`;
});

test("the consolidated view totals both debts and carries the card's own figures", async ({
  page,
}) => {
  await page.goto("/es/planning/debts");

  // The figure right under the label — the phone's heading, the laptop's tile
  // value: the sum of the two derived balances. A total that dropped the bare
  // debt would read the card's owed alone.
  const total = band(page)
    .getByText(debts.total, { exact: true })
    .locator("xpath=following-sibling::*[1]");

  await expect(total).toBeVisible();
  expect(await digitsOf(total)).toBe(pesos(CARD_OWED_CENTS + BARE_OWED_CENTS));

  // Both liabilities are on screen: a card each on the phone, a row each on the
  // laptop.
  await expect(band(page).getByText(cardName, { exact: true })).toBeVisible();
  await expect(band(page).getByText(bareName, { exact: true })).toBeVisible();

  // The limit less what the card owes; the bare debt has no limit to lift it.
  expect(
    await digitsOf(
      statedAmount(page, debts.availableCredit, debts.tileAvailableCredit),
    ),
  ).toBe(pesos(CREDIT_LIMIT_CENTS - CARD_OWED_CENTS));

  // The summed interest, which only the card with a rate contributes to.
  const interest = await digitsOf(
    statedAmount(page, debts.monthlyInterest, debts.tileMonthlyInterest),
  );
  expect(Math.abs(interest - pesos(MONTHLY_INTEREST_CENTS))).toBeLessThanOrEqual(1);
});
