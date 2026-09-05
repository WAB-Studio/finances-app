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
 *
 * What the describes below add is everything no server-side check reaches: the
 * two bands at the two widths, the row menus, the dialogs they open, the detail
 * route's three tables, and the same screens driven by an identity the database
 * would refuse every write to. Every case is asserted against a figure the screen
 * rendered or the accessible name of a control it offered — never against a
 * heading the shipped catalogue would match on an empty page.
 */
import { randomUUID } from "node:crypto";

import { expect, type Locator, type Page } from "@playwright/test";

import messages from "@/messages/es.json";
import { addCivilDays, addCivilMonths, todayInBogota } from "@/lib/dates";
import { TIME_ZONE } from "@/lib/locales";

import { fixtureSql } from "../scripts/harness/fixtures";
import {
  MEMBER_STORAGE_STATE,
  asHarnessUser,
  clearGroup,
  readScope,
  seedGroup,
  test,
} from "./global-setup";

const debts = messages.debts;
const installments = messages.installments;
const common = messages.common;

// The em dash a cell with nothing to name reads as, which is what a debt with no
// credit limit shows instead of a cupo of zero (RF-117).
const NO_VALUE = "\u2014";

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
  return digitsIn(await locator.innerText());
}

function digitsIn(text: string): number {
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
  // Under the caller's claims, so the trail rows this drop stamps name an actor
  // the next run's purge can find again.
  await asHarnessUser(async (tx) => {
    await tx`delete from debt_terms where account_id = ${cardId}`;
    await tx`delete from accounts where id in ${tx([cardId, bareId])}`;
  });
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

// The menu names the row it acts on, so a debt is reached by its own name and
// never by a position among whatever else the table is carrying.
function rowMenu(page: Page, name: string): Locator {
  return page.getByRole("button", {
    name: common.actionsFor.replace("{name}", name),
    exact: true,
  });
}

// The `other` branch of an ICU plural with `#` filled, which is what a count
// renders as on screen once it leaves the catalogue.
function atCount(message: string, count: number): string {
  const branch = /other \{([^}]*)\}/.exec(message)?.[1] ?? message;
  return branch.replace("#", String(count));
}

// A plan's position as the list states it, paid over total (RF-81).
function positionText(paid: number, total: number): string {
  return debts.installmentPosition
    .replace("{paid}", String(paid))
    .replace("{total}", String(total));
}

/**
 * The figure a tile states under its label. Several labels are also column
 * headers of the table below them and one is also the badge on a row, so the
 * match is narrowed to the sibling that actually carries digits.
 */
function tileValue(scope: Locator, label: string): Locator {
  return scope
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::*[1]")
    .filter({ hasText: /\d/ });
}

/**
 * The detail door a phone card carries. Named twice over — by the copy the row
 * menu already uses and by the route of that debt — so a control that reads
 * right but leads to the list is not a match.
 */
function cardDetailLink(page: Page, accountId: string): Locator {
  return band(page)
    .getByRole("link", { name: debts.rowDetail, exact: true })
    .and(page.locator(`a[href="/es/planning/debts/${accountId}"]`));
}

// The owed a phone card states: the head puts the name in a column and the
// amount right after it.
function cardOwed(page: Page, name: string): Locator {
  return band(page)
    .getByText(name, { exact: true })
    .locator("xpath=../following-sibling::*[1]");
}

/**
 * The open period's own balance, read inside the panel that names it: the same
 * word labels the statements column and the detail's first tile, and only this
 * one moves with a movement recorded after the last cut-off (RF-84). The heading
 * sits in the panel's head, so the panel is two levels up.
 */
function openPeriodBalance(page: Page): Locator {
  return page
    .getByRole("heading", { name: installments.currentPeriod, exact: true })
    .locator("xpath=../..")
    .getByText(installments.statementBalance, { exact: true })
    .locator("xpath=following-sibling::*[1]");
}

/**
 * One column of a `DataTable`, as text, over the rows carrying exactly `columns`
 * cells — which is what leaves the caption, the column headers and the totals
 * row out of a reading of the data.
 */
async function readColumn(
  table: Locator,
  index: number,
  columns: number,
): Promise<string[]> {
  const rows = table.getByRole("row");
  const total = await rows.count();
  const values: string[] = [];

  for (let at = 0; at < total; at++) {
    const cells = rows.nth(at).getByRole("cell");
    if ((await cells.count()) !== columns) continue;
    values.push((await cells.nth(index).innerText()).trim());
  }

  return values;
}

type SeededTerms = {
  debtKind: "revolving" | "installment";
  annualRate: number;
  minimumPaymentCents?: number;
  creditLimitCents?: number;
  cutOffDay?: number;
  dueDay?: number;
};

// A liability opens owing, stored negative, so net worth stays a plain sum
// (RNF-05); the terms are optional, and a debt without them owes without a rate.
async function seedDebt({
  id,
  name,
  owedCents,
  openedOn,
  terms,
}: {
  id: string;
  name: string;
  owedCents: number;
  openedOn?: string;
  terms?: SeededTerms;
}): Promise<void> {
  await asHarnessUser(async (tx) => {
    await tx`
      insert into accounts (
        id, owner_user_id, name, kind, subtype, initial_balance_cents, initial_balance_on)
      values (
        ${id}, ${scope.userId}, ${name}, 'liability', 'tarjeta',
        ${-owedCents}, ${openedOn ?? todayInBogota()})`;

    if (terms === undefined) return;

    await tx`
      insert into debt_terms (
        account_id, debt_kind, annual_rate, minimum_payment_cents,
        credit_limit_cents, statement_cut_off_day, payment_due_day)
      values (
        ${id}, ${terms.debtKind}, ${terms.annualRate},
        ${terms.minimumPaymentCents ?? null}, ${terms.creditLimitCents ?? null},
        ${terms.cutOffDay ?? null}, ${terms.dueDay ?? null})`;
  });
}

async function seedAsset({
  id,
  name,
  openingCents,
}: {
  id: string;
  name: string;
  openingCents: number;
}): Promise<void> {
  await asHarnessUser(async (tx) => {
    await tx`
      insert into accounts (
        id, owner_user_id, name, kind, subtype, initial_balance_cents, initial_balance_on)
      values (
        ${id}, ${scope.userId}, ${name}, 'asset', 'bancaria',
        ${openingCents}, ${todayInBogota()})`;
  });
}

// A transfer that credits the liability, the shape a debt payment takes (RF-16);
// it carries no split, which only an expense must.
async function seedPayment({
  fromId,
  toId,
  amountCents,
  occurredAt,
}: {
  fromId: string;
  toId: string;
  amountCents: number;
  occurredAt: string;
}): Promise<string> {
  let id = "";

  await asHarnessUser(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into transactions (
        from_account_id, to_account_id, amount_cents, occurred_at, description)
      values (
        ${fromId}, ${toId}, ${amountCents}, ${occurredAt}, ${`Abono ${stamp}`})
      returning id`;
    id = row.id;
  });

  return id;
}

// A plan whose first `paidLines` lines are settled by one movement, which is the
// shape the FIFO allocation leaves behind (RF-82).
async function seedPlan({
  accountId,
  merchant,
  lines,
  amountCents,
  startDate,
  paidLines = 0,
  paidTransactionId = null,
}: {
  accountId: string;
  merchant: string;
  lines: number;
  amountCents: number;
  startDate: string;
  paidLines?: number;
  paidTransactionId?: string | null;
}): Promise<void> {
  await asHarnessUser(async (tx) => {
    const [plan] = await tx<{ id: string }[]>`
      insert into installment_plans (
        account_id, merchant, principal_cents, n_installments, frequency, start_date)
      values (
        ${accountId}, ${merchant}, ${lines * amountCents}, ${lines}, 'monthly',
        ${startDate})
      returning id`;

    await tx`
      insert into installment_lines (
        plan_id, seq, due_date, amount_cents, paid_transaction_id)
      select
        ${plan.id},
        g.seq,
        (${startDate}::date + ((g.seq - 1) || ' month')::interval)::date,
        ${amountCents},
        case when g.seq <= ${paidLines} then ${paidTransactionId}::uuid else null end
      from generate_series(1, ${lines}) as g(seq)`;
  });
}

// Child before parent: the plan's lines ride its cascade, and a movement naming
// an account is what makes that account's deletion fail rather than cascade.
async function dropAccounts(ids: string[]): Promise<void> {
  // Under the caller's claims, so the trail rows this drop stamps name an actor
  // the next run's purge can find again.
  await asHarnessUser(async (tx) => {
    await tx`delete from installment_plans where account_id in ${tx(ids)}`;
    await tx`delete from debt_statements where account_id in ${tx(ids)}`;
    await tx`delete from debt_terms where account_id in ${tx(ids)}`;
    await tx`
      delete from transactions
      where from_account_id in ${tx(ids)} or to_account_id in ${tx(ids)}`;
    await tx`delete from accounts where id in ${tx(ids)}`;
  });
}

const SECOND_OWED_CENTS = 50_000_000;
const SECOND_LIMIT_CENTS = 200_000_000;
const SECOND_ANNUAL_RATE = 0.36;
const SECOND_INTEREST_CENTS = Math.round(
  SECOND_OWED_CENTS * ((1 + SECOND_ANNUAL_RATE) ** (1 / 12) - 1),
);

test.describe("the laptop band", () => {
  // The dense table and its tiles render from `lg` up, and both projects drive
  // this describe at the width the artboard states rather than skipping one of
  // them (SPEC-A3, RNF-08).
  test.use({ viewport: { width: 1280, height: 900 } });

  const secondId = randomUUID();
  const secondName = `Tarjeta con cupo ${stamp}`;

  // A second debt carrying a limit, so the cupo tile sums a column rather than
  // repeating one cell, and a second rate so the interest tile sums two.
  test.beforeAll(async () => {
    await seedDebt({
      id: secondId,
      name: secondName,
      owedCents: SECOND_OWED_CENTS,
      terms: {
        debtKind: "revolving",
        annualRate: SECOND_ANNUAL_RATE,
        creditLimitCents: SECOND_LIMIT_CENTS,
      },
    });
  });

  test.afterAll(async () => {
    await dropAccounts([secondId]);
  });

  test("displays itself alone and states the four derived figures, the cupo tile summing its own column", async ({
    page,
  }) => {
    await page.goto("/es/planning/debts");

    // Exactly one of the two bands is displayed at any width, and at 1280 it is
    // the one carrying the table.
    await expect(band(page)).toHaveCount(1);
    const table = page.getByRole("table", { name: debts.title });
    await expect(table).toBeVisible();

    const shown = band(page);

    expect(await digitsOf(tileValue(shown, debts.tileTotal))).toBe(
      pesos(CARD_OWED_CENTS + BARE_OWED_CENTS + SECOND_OWED_CENTS),
    );

    // Only the two debts that carry a rate contribute; each is rounded in
    // `numeric` before the sum, so the reading may land a peso either side of
    // each of them.
    const interest = await digitsOf(tileValue(shown, debts.tileMonthlyInterest));
    expect(
      Math.abs(interest - pesos(MONTHLY_INTEREST_CENTS + SECOND_INTEREST_CENTS)),
    ).toBeLessThanOrEqual(2);

    // The card is the only debt naming a payment day, so the consolidated next
    // payment is its minimum and the note under the figure names it (RF-83).
    expect(await digitsOf(tileValue(shown, debts.tileNextPayment))).toBe(
      pesos(MINIMUM_PAYMENT_CENTS),
    );
    const note = await shown
      .getByText(debts.tileNextPayment, { exact: true })
      .locator("xpath=following-sibling::*[2]")
      .innerText();
    expect(note.endsWith(cardName)).toBe(true);

    const availableCents =
      CREDIT_LIMIT_CENTS -
      CARD_OWED_CENTS +
      (SECOND_LIMIT_CENTS - SECOND_OWED_CENTS);
    expect(await digitsOf(tileValue(shown, debts.tileAvailableCredit))).toBe(
      pesos(availableCents),
    );

    // And the tile is the sum of the cells beneath it: the two debts that carry
    // a limit state a cupo, and the one that does not reads absent rather than
    // spent (RF-117).
    const cupo = await readColumn(table, 1, 8);
    expect(cupo).toHaveLength(3);
    expect(cupo.filter((cell) => cell === NO_VALUE)).toHaveLength(1);
    expect(
      cupo
        .filter((cell) => /\d/.test(cell))
        .reduce((sum, cell) => sum + digitsIn(cell), 0),
    ).toBe(pesos(availableCents));
  });
});

const MENU_DEBT_OWED_CENTS = 100_000_000;
const MENU_LINE_CENTS = 10_000_000;
const MENU_PAID_CENTS = 25_000_000;

test.describe("the row menus", () => {
  // A row menu is the dense table's alone: nothing below `lg` mounts one.
  test.use({ viewport: { width: 1280, height: 900 } });

  const sourceId = randomUUID();
  const sourceName = `Cuenta pagadora ${stamp}`;
  const switchingId = randomUUID();
  const switchingName = `Cuenta que cambia ${stamp}`;
  const debtId = randomUUID();
  const debtName = `Deuda del menú ${stamp}`;

  test.beforeEach(async () => {
    await seedAsset({ id: sourceId, name: sourceName, openingCents: 900_000_000 });
    // Opens at zero, which both kinds admit: it is the source that stops being
    // an asset half way through the last test.
    await seedAsset({ id: switchingId, name: switchingName, openingCents: 0 });
    await seedDebt({
      id: debtId,
      name: debtName,
      owedCents: MENU_DEBT_OWED_CENTS,
    });
  });

  test.afterEach(async () => {
    await dropAccounts([debtId, sourceId, switchingId]);
  });

  test("the plan dialog schedules the lines the row's meta then counts", async ({
    page,
  }) => {
    await page.goto("/es/planning/debts");

    const row = page.getByRole("row").filter({ hasText: debtName });
    await expect(row.getByText(positionText(0, 6), { exact: true })).toHaveCount(0);

    await rowMenu(page, debtName).click();
    await page
      .getByRole("menuitem", { name: debts.rowNewPlan, exact: true })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The plan lands on the debt whose menu opened it, which the dialog states
    // rather than offering as a choice (RF-81).
    await expect(dialog.getByText(debtName, { exact: true })).toBeVisible();

    await dialog
      .getByRole("textbox", { name: installments.principalLabel })
      .fill("600000");
    await dialog
      .getByRole("textbox", { name: installments.installmentsLabel })
      .fill("6");
    await dialog
      .getByRole("button", { name: installments.planSave, exact: true })
      .click();

    await expect(
      page.getByText(installments.planSaved, { exact: true }),
    ).toBeVisible();
    await expect(row.getByText(positionText(0, 6), { exact: true })).toBeVisible();

    // The dated schedule is derived server-side and the lines total the
    // principal exactly — no cent is lost to the split (RF-81).
    const [scheduled] = await fixtureSql<{ lines: string; total: string }[]>`
      select count(*)::text as lines, coalesce(sum(l.amount_cents), 0)::text as total
      from installment_lines l
      join installment_plans p on p.id = l.plan_id
      where p.account_id = ${debtId}`;
    expect(scheduled.lines).toBe("6");
    expect(scheduled.total).toBe(String(60_000_000));
  });

  test("the payment dialog closes the oldest cuotas, names what it did not reach and drops the saldo", async ({
    page,
  }) => {
    await seedPlan({
      accountId: debtId,
      merchant: `Compra del menú ${stamp}`,
      lines: 3,
      amountCents: MENU_LINE_CENTS,
      startDate: todayInBogota(),
    });

    await page.goto("/es/planning/debts");

    const row = page.getByRole("row").filter({ hasText: debtName });
    expect(await digitsOf(row.getByRole("cell").nth(6))).toBe(
      pesos(MENU_DEBT_OWED_CENTS),
    );

    await rowMenu(page, debtName).click();
    await page.getByRole("menuitem", { name: debts.rowPay, exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(debtName, { exact: true })).toBeVisible();

    await dialog.getByLabel(installments.fromLabel).click();
    await page.getByRole("option", { name: sourceName, exact: true }).click();
    await dialog
      .getByRole("textbox", { name: installments.amountLabel })
      .fill("250000");
    await dialog
      .getByRole("button", { name: installments.paymentSave, exact: true })
      .click();

    // Two lines of $100.000 are covered in full and the third is not: both the
    // count and the leftover come off the allocation itself (RF-82).
    await expect(
      page.getByText(atCount(installments.paymentPaidLines, 2), { exact: true }),
    ).toBeVisible();
    const remainder = page.getByText(
      installments.paymentRemainder.split("{")[0].trim(),
    );
    await expect(remainder).toBeVisible();
    expect(await digitsOf(remainder)).toBe(
      pesos(MENU_PAID_CENTS - 2 * MENU_LINE_CENTS),
    );

    await expect(row.getByText(positionText(2, 3), { exact: true })).toBeVisible();
    // The saldo is derived from the movements, so the payment moves it by
    // exactly what it paid.
    expect(await digitsOf(row.getByRole("cell").nth(6))).toBe(
      pesos(MENU_DEBT_OWED_CENTS - MENU_PAID_CENTS),
    );
  });

  test("the source picker offers no liability, and a source that stopped being one is refused", async ({
    page,
  }) => {
    await page.goto("/es/planning/debts");

    await rowMenu(page, debtName).click();
    await page.getByRole("menuitem", { name: debts.rowPay, exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(installments.fromLabel).click();

    // A debt is paid from an asset (RF-16): the picker holds exactly the assets
    // the caller can read, and not one of the liabilities the screen behind it
    // is listing.
    const options = page.getByRole("option");
    const assets = await fixtureSql<{ id: string }[]>`
      select id from accounts
      where owner_user_id = ${scope.userId}
        and kind = 'asset' and archived_at is null`;
    await expect(options).toHaveCount(assets.length);
    for (const liability of [debtName, cardName, bareName]) {
      await expect(options.filter({ hasText: liability })).toHaveCount(0);
    }

    // The roster the dialog is holding goes stale: the account it named stops
    // being an asset between the render and the submit, which is the one path
    // that reaches the refusal's own message.
    await page.getByRole("option", { name: switchingName, exact: true }).click();
    await dialog
      .getByRole("textbox", { name: installments.amountLabel })
      .fill("10000");
    await fixtureSql`
      update accounts set kind = 'liability', subtype = 'tarjeta'
      where id = ${switchingId}`;
    await dialog
      .getByRole("button", { name: installments.paymentSave, exact: true })
      .click();

    await expect(
      page.getByText(installments.errors.notFromAsset, { exact: true }),
    ).toBeVisible();
    // The kinds guard lands before anything is written.
    expect(
      await fixtureSql`select id from transactions where to_account_id = ${debtId}`,
    ).toHaveLength(0);
  });
});

const PLAN_LINES = 24;
const PLAN_PAID_LINES = 9;
const DETAIL_LINE_CENTS = 10_000_000;
const DETAIL_OWED_CENTS = PLAN_LINES * DETAIL_LINE_CENTS;
const DETAIL_PAID_CENTS = PLAN_PAID_LINES * DETAIL_LINE_CENTS;
const AFTER_CUT_OFF_CENTS = 30_000_000;

test.describe("the detail route", () => {
  const detailId = randomUUID();
  const detailName = `Deuda con extractos ${stamp}`;
  const payerId = randomUUID();
  const payerName = `Cuenta del extracto ${stamp}`;
  const planTitle = `Compra a cuotas ${stamp}`;

  let paymentId = "";

  // Opened four months back so past cut-offs exist to close, and settled by one
  // movement dated between two of them, so the frozen balances differ from
  // period to period rather than repeating one figure.
  test.beforeEach(async () => {
    const openedOn = addCivilMonths(todayInBogota(), -4);

    await seedAsset({ id: payerId, name: payerName, openingCents: 900_000_000 });
    await seedDebt({
      id: detailId,
      name: detailName,
      owedCents: DETAIL_OWED_CENTS,
      openedOn,
      terms: {
        debtKind: "revolving",
        annualRate: ANNUAL_RATE,
        minimumPaymentCents: 5_000_000,
        creditLimitCents: 400_000_000,
        cutOffDay: 15,
        dueDay: 5,
      },
    });
    paymentId = await seedPayment({
      fromId: payerId,
      toId: detailId,
      amountCents: DETAIL_PAID_CENTS,
      occurredAt: addCivilDays(todayInBogota(), -70),
    });
    await seedPlan({
      accountId: detailId,
      merchant: planTitle,
      lines: PLAN_LINES,
      amountCents: DETAIL_LINE_CENTS,
      startDate: openedOn,
      paidLines: PLAN_PAID_LINES,
      paidTransactionId: paymentId,
    });
  });

  test.afterEach(async () => {
    await dropAccounts([detailId, payerId]);
  });

  test("marks the nine lines a movement settled and totals the pending of the other fifteen", async ({
    page,
  }) => {
    await page.goto(`/es/planning/debts/${detailId}`);

    const plan = page.getByRole("table", { name: planTitle });
    // The column headers and the totals ride rows of their own; the read below
    // is a snapshot and does not wait for the render behind it.
    await expect(plan.getByRole("row")).toHaveCount(PLAN_LINES + 2);
    await expect(
      plan.getByText(
        installments.planPosition
          .replace("{paid}", String(PLAN_PAID_LINES))
          .replace("{total}", String(PLAN_LINES)),
        { exact: true },
      ),
    ).toBeVisible();

    // A line reads paid exactly when a movement is linked to it, and that
    // movement is reachable from the row (RF-82).
    const status = await readColumn(plan, 3, 5);
    expect(status).toHaveLength(PLAN_LINES);
    expect(status.filter((cell) => cell === installments.statusPaid)).toHaveLength(
      PLAN_PAID_LINES,
    );
    expect(
      status.filter((cell) => cell === installments.statusPending),
    ).toHaveLength(PLAN_LINES - PLAN_PAID_LINES);
    await expect(
      plan.getByRole("link", { name: installments.viewMovement, exact: true }),
    ).toHaveCount(PLAN_PAID_LINES);

    // The pending is the sum of the lines still unpaid, and of no others.
    const amounts = await readColumn(plan, 2, 5);
    const pending = amounts
      .filter((_, at) => status[at] === installments.statusPending)
      .reduce((sum, cell) => sum + digitsIn(cell), 0);
    expect(pending).toBe(
      pesos((PLAN_LINES - PLAN_PAID_LINES) * DETAIL_LINE_CENTS),
    );

    // The totals row of the plan and the screen's own tile both state it.
    const totals = await readColumn(plan, 2, 3);
    expect(digitsIn(totals[0])).toBe(pending);
    expect(
      await digitsOf(
        tileValue(page.getByRole("main"), installments.tilePending),
      ),
    ).toBe(pending);
  });

  test("reads the frozen statement saldos, which a later movement leaves alone while the open period moves", async ({
    page,
  }) => {
    await page.goto(`/es/planning/debts/${detailId}`);

    const history = page.getByRole("table", {
      name: installments.statementsTitle,
    });
    await expect(history).toBeVisible();

    // Opening the detail is what cuts the past periods (RF-84), and the screen
    // reads back exactly the balances they froze.
    const stored = await fixtureSql<{ balance: string }[]>`
      select statement_balance_cents::text as balance
      from debt_statements where account_id = ${detailId}
      order by cut_off_date desc`;
    expect(stored.length).toBeGreaterThan(1);

    // The column headers ride a row of their own, so the history is drawn once
    // the table carries one row more than it has periods. Read only then: a
    // column read is a snapshot and does not wait for the render behind it.
    await expect(history.getByRole("row")).toHaveCount(stored.length + 1);

    const shown = await readColumn(history, 3, 6);
    expect(shown.map(digitsIn)).toEqual(
      stored.map((row) => pesos(Math.abs(Number(row.balance)))),
    );
    // Two of them differ, so "unchanged" below is a statement about each row and
    // not about one figure repeated down the column.
    expect(new Set(shown).size).toBeGreaterThan(1);

    const openBefore = await digitsOf(openPeriodBalance(page));

    // A movement after the last cut-off falls in the period nobody has closed.
    await seedPayment({
      fromId: payerId,
      toId: detailId,
      amountCents: AFTER_CUT_OFF_CENTS,
      occurredAt: todayInBogota(),
    });
    await page.reload();
    await expect(history.getByRole("row")).toHaveCount(stored.length + 1);

    expect((await readColumn(history, 3, 6)).map(digitsIn)).toEqual(
      shown.map(digitsIn),
    );
    expect(await digitsOf(openPeriodBalance(page))).toBe(
      openBefore - pesos(AFTER_CUT_OFF_CENTS),
    );

    // And a snapshot is immutable: nothing rewrote the rows either (RF-84).
    const after = await fixtureSql<{ balance: string }[]>`
      select statement_balance_cents::text as balance
      from debt_statements where account_id = ${detailId}
      order by cut_off_date desc`;
    expect(after).toEqual(stored);
  });

  test("names every line the delete drops, and keeps the movement it unlinks", async ({
    page,
  }) => {
    await page.goto(`/es/planning/debts/${detailId}`);

    await rowMenu(page, planTitle).click();
    await page.getByRole("menuitem", { name: common.delete, exact: true }).click();

    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(
      confirm.getByText(
        installments.deleteDescription.replace("{count}", String(PLAN_LINES)),
        { exact: true },
      ),
    ).toBeVisible();

    await confirm
      .getByRole("button", { name: common.delete, exact: true })
      .click();
    await expect(
      page.getByText(installments.planDeleted, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(installments.plansEmpty, { exact: true }),
    ).toBeVisible();

    // The lines go with the plan; the movement that paid nine of them stays,
    // unlinked, which is what the confirmation said it would do.
    expect(
      await fixtureSql`select id from installment_plans where account_id = ${detailId}`,
    ).toHaveLength(0);
    expect(
      await fixtureSql`select id from transactions where id = ${paymentId}`,
    ).toHaveLength(1);
  });
});

const PHONE_LINES = 4;
const PHONE_PAID_LINES = 1;
const PHONE_LINE_CENTS = 15_000_000;
const PHONE_OPENING_CENTS = PHONE_LINES * PHONE_LINE_CENTS;
const PHONE_OWED_CENTS =
  PHONE_OPENING_CENTS - PHONE_PAID_LINES * PHONE_LINE_CENTS;

test.describe("the phone list", () => {
  // RNF-08's base case, driven at the artboard's own width by both projects.
  test.use({ viewport: { width: 360, height: 740 } });

  const phoneId = randomUUID();
  const phoneName = `Deuda a cuotas ${stamp}`;
  const phonePayerId = randomUUID();
  const phonePayerName = `Cuenta del teléfono ${stamp}`;

  test.beforeAll(async () => {
    await seedAsset({
      id: phonePayerId,
      name: phonePayerName,
      openingCents: 900_000_000,
    });
    await seedDebt({
      id: phoneId,
      name: phoneName,
      owedCents: PHONE_OPENING_CENTS,
      // A debt read by its kind: the card the phone draws for it is the one that
      // states a plan position (RF-81).
      terms: { debtKind: "installment", annualRate: 0.2 },
    });
    const paid = await seedPayment({
      fromId: phonePayerId,
      toId: phoneId,
      amountCents: PHONE_PAID_LINES * PHONE_LINE_CENTS,
      occurredAt: todayInBogota(),
    });
    await seedPlan({
      accountId: phoneId,
      merchant: `Compra del teléfono ${stamp}`,
      lines: PHONE_LINES,
      amountCents: PHONE_LINE_CENTS,
      startDate: todayInBogota(),
      paidLines: PHONE_PAID_LINES,
      paidTransactionId: paid,
    });
  });

  test.afterAll(async () => {
    await dropAccounts([phoneId, phonePayerId]);
  });

  test("shows the card list without the laptop table, and the installment card states its plan position", async ({
    page,
  }) => {
    await page.goto("/es/planning/debts");

    // The dense table renders from `lg` up and is not in the tree below it, so
    // the phone is not carrying a second copy of every figure.
    await expect(page.getByRole("table", { name: debts.title })).toHaveCount(0);
    await expect(band(page)).toHaveCount(1);

    await expect(band(page).getByText(phoneName, { exact: true })).toBeVisible();
    await expect(
      band(page).getByText(
        positionText(PHONE_PAID_LINES, PHONE_LINES),
        { exact: true },
      ),
    ).toBeVisible();
    expect(await digitsOf(cardOwed(page, phoneName))).toBe(
      pesos(PHONE_OWED_CENTS),
    );
  });

  test("the card's detail control opens that debt and not the list", async ({
    page,
  }) => {
    await page.goto("/es/planning/debts");

    // The phone has no row menu, so this control is the only way into a debt's
    // cuotas and its extractos from here.
    await cardDetailLink(page, phoneId).click();

    await expect(page).toHaveURL(`/es/planning/debts/${phoneId}`);
    await expect(
      page.getByRole("heading", { name: phoneName, exact: true }),
    ).toBeVisible();
  });
});

const READER_OWED_CENTS = 80_000_000;
const READER_LIMIT_CENTS = 250_000_000;

test.describe("under a plain member", () => {
  // The second identity, who belongs to the fund and owns none of its accounts:
  // the policies show them every debt below and admit no write to any of it,
  // which is the flag all three surfaces gate on (RF-58, RF-100).
  test.use({ storageState: MEMBER_STORAGE_STATE });

  const readerId = randomUUID();
  const readerName = `Deuda compartida ${stamp}`;
  const readerPlanTitle = `Compra compartida ${stamp}`;

  test.beforeAll(async () => {
    await seedGroup();
    await seedDebt({
      id: readerId,
      name: readerName,
      owedCents: READER_OWED_CENTS,
      terms: {
        debtKind: "revolving",
        annualRate: 0.18,
        minimumPaymentCents: 2_000_000,
        creditLimitCents: READER_LIMIT_CENTS,
      },
    });
    await seedPlan({
      accountId: readerId,
      merchant: readerPlanTitle,
      lines: 3,
      amountCents: 5_000_000,
      startDate: todayInBogota(),
    });
  });

  test.afterAll(async () => {
    await dropAccounts([readerId]);
    await clearGroup();
  });

  test("reads every figure on the list and is offered no write over it", async ({
    page,
  }, testInfo) => {
    // Both shapes stay mounted at every width and CSS displays one of them, so
    // each viewport is read through the surface it actually renders.
    const desktop = testInfo.project.name === "desktop";

    await page.goto("/es/planning/debts");

    if (desktop) {
      await rowMenu(page, readerName).click();
      // Reading a debt is offered to everyone it is shown to; writing one only
      // to the caller the policies would admit.
      await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText([
        debts.rowDetail,
      ]);
      await page.keyboard.press("Escape");

      const row = page.getByRole("row").filter({ hasText: readerName });
      expect(await digitsOf(row.getByRole("cell").nth(6))).toBe(
        pesos(READER_OWED_CENTS),
      );
      expect(await digitsOf(row.getByRole("cell").nth(1))).toBe(
        pesos(READER_LIMIT_CENTS - READER_OWED_CENTS),
      );
    } else {
      // The phone card's only controls are the abono and the invitation to
      // complete a bare debt's terms; a reader is handed neither, on this card
      // or on any other the fund is showing them.
      await expect(
        band(page).getByRole("button", { name: debts.rowPay, exact: true }),
      ).toHaveCount(0);
      await expect(
        band(page).getByRole("button", { name: debts.completeTerms, exact: true }),
      ).toHaveCount(0);
      // Reading is never closed: the door onto this debt's own detail is on the
      // card whether or not the caller may write it.
      await expect(cardDetailLink(page, readerId)).toBeVisible();
      expect(await digitsOf(cardOwed(page, readerName))).toBe(
        pesos(READER_OWED_CENTS),
      );
    }
  });

  test("reads the detail and is offered neither the abono, the plan nor the delete", async ({
    page,
  }) => {
    await page.goto(`/es/planning/debts/${readerId}`);

    await expect(
      page.getByRole("heading", { name: readerName, exact: true }),
    ).toBeVisible();

    // Every figure still reads. The saldo names the tile, the open period and
    // the statements column alike, so the first of them is the tile.
    const main = page.getByRole("main");
    expect(await digitsOf(tileValue(main, debts.tableBalance).first())).toBe(
      pesos(READER_OWED_CENTS),
    );
    expect(await digitsOf(tileValue(main, debts.tileAvailableCredit))).toBe(
      pesos(READER_LIMIT_CENTS - READER_OWED_CENTS),
    );
    await expect(page.getByRole("table", { name: readerPlanTitle })).toBeVisible();

    // And no action the database would refuse is on offer.
    await expect(
      page.getByRole("button", { name: debts.rowPay, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: debts.rowNewPlan, exact: true }),
    ).toHaveCount(0);
    await expect(rowMenu(page, readerPlanTitle)).toHaveCount(0);
  });
});
