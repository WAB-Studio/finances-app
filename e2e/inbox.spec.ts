/**
 * The debt this slice pays: `/inbox` shipped with done criteria that named a
 * browser and an authenticated session, and was merged without either. Every
 * assertion here is one of those criteria (plan modules 10, 11 and 17).
 *
 * The copy is read from the message file the screen reads, so a rewording moves
 * both at once and never leaves a spec asserting a string nobody renders.
 */
import { expect } from "@playwright/test";

import messages from "@/messages/es.json";

import { fixtureSql } from "../scripts/harness/fixtures";
import { clearLedger, readScope, seedQueue, test } from "./global-setup";

const ingest = messages.ingest;
const transactions = messages.transactions;

const scope = readScope();

// 45.000 pesos, as the card reads it and as the prefilled form carries it.
const AMOUNT_CENTS = 4500000;
const AMOUNT_PESOS = "45000";

const TRUSTED = "Exito Poblado";
const UNREADABLE = "Comercio sin datos";
const DEFAULTED = "Comercio por defecto";

// A complete proposal: a trusted merchant taught the category, and the amount and
// account both read. One tap records it.
const complete = {
  merchant: TRUSTED,
  amountCents: AMOUNT_CENTS,
  accountId: scope.accountId,
  categoryId: scope.categoryId,
  categorySource: "merchant" as const,
  trusted: true,
};

// Everything the interpreter failed to read, so the card names each gap.
const incomplete = {
  merchant: UNREADABLE,
  amountCents: null,
  accountId: null,
  categoryId: null,
  categorySource: null,
};

// Read in full, but the category came from the credential's fallback rather than
// from anything about this message — which is exactly why it is not one tap.
const defaulted = {
  merchant: DEFAULTED,
  amountCents: AMOUNT_CENTS,
  accountId: scope.accountId,
  categoryId: scope.categoryId,
  categorySource: "credential_default" as const,
};

function acceptButton(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: ingest.accept, exact: true });
}

function reviewButton(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: ingest.review, exact: true });
}

// The card's menu is the only way to the rejection, and the dialog it raises is
// where both choices live.
async function openRejectDialog(page: import("@playwright/test").Page) {
  // The menu names its own row now, so match the prefix rather than the whole
  // label: which delivery it belongs to varies per test.
  await page
    .getByRole("button", { name: messages.common.actionsFor.split("{")[0].trim() })
    .click();
  await page.getByRole("menuitem", { name: ingest.reject, exact: true }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();

  return dialog;
}

test.describe("the inbox queue", () => {
  test("shows one card per delivery, one to accept and one to review", async ({
    page,
  }) => {
    await seedQueue([complete, incomplete]);
    await page.goto("/es/inbox");

    await expect(page.getByRole("heading", { name: TRUSTED })).toBeVisible();
    await expect(page.getByRole("heading", { name: UNREADABLE })).toBeVisible();

    await expect(acceptButton(page)).toHaveCount(1);
    await expect(reviewButton(page)).toHaveCount(1);

    // Each gap is named, and named in amber: that colour is what tells the two
    // cards apart at a glance.
    for (const missing of [
      ingest.amountMissing,
      ingest.accountMissing,
      ingest.categoryMissing,
    ]) {
      const field = page.getByText(missing, { exact: true });
      await expect(field).toBeVisible();
      await expect(field).toHaveAttribute("data-accent-color", "amber");
    }
  });

  test("discards the message once and leaves its shape unsilenced", async ({
    page,
  }) => {
    const [deliveryId] = await seedQueue([complete]);
    await page.goto("/es/inbox");

    const dialog = await openRejectDialog(page);
    // The permanence is stated by the silence control itself — "y no volver a
    // preguntar" — not by the description above it, so both are on offer here.
    await expect(
      dialog.getByRole("button", { name: ingest.rejectAndSilence, exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: ingest.rejectOnce, exact: true })
      .click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: TRUSTED })).toHaveCount(0);

    const [delivery] = await fixtureSql<{ status: string }[]>`
      select status from ingest_deliveries where id = ${deliveryId}`;
    expect(delivery.status).toBe("rejected");

    // Once is once: nothing about the message's shape was remembered, so the
    // next one like it still arrives.
    const shapes = await fixtureSql`
      select id from ingest_shapes where owner_user_id = ${scope.userId}`;
    expect(shapes).toHaveLength(0);
  });

  test("discards the message and silences every message of its shape", async ({
    page,
  }) => {
    const [deliveryId] = await seedQueue([complete]);
    await page.goto("/es/inbox");

    const dialog = await openRejectDialog(page);
    await dialog
      .getByRole("button", { name: ingest.rejectAndSilence, exact: true })
      .click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: TRUSTED })).toHaveCount(0);

    const [delivery] = await fixtureSql<
      { status: string; shape_hash: string; raw_text: string }[]
    >`
      select status, shape_hash, raw_text from ingest_deliveries
      where id = ${deliveryId}`;
    expect(delivery.status).toBe("rejected");

    // The silence is the shape row: the ingest reads it to drop the next message
    // that hashes the same, and it keeps the text that taught it.
    const shapes = await fixtureSql<
      { shape_hash: string; decision: string; sample_text: string }[]
    >`
      select shape_hash, decision, sample_text from ingest_shapes
      where owner_user_id = ${scope.userId}`;
    expect(shapes).toHaveLength(1);
    expect(shapes[0].shape_hash).toBe(delivery.shape_hash);
    expect(shapes[0].decision).toBe("rejected");
    expect(shapes[0].sample_text).toBe(delivery.raw_text);
  });

  test("records the movement on accept and drops the card", async ({ page }) => {
    await clearLedger();
    const [deliveryId] = await seedQueue([complete]);
    await page.goto("/es/inbox");

    await acceptButton(page).click();
    await expect(page.getByRole("heading", { name: TRUSTED })).toHaveCount(0);

    const movements = await fixtureSql<
      { id: string; amount_cents: string; from_account_id: string }[]
    >`
      select id, amount_cents::text as amount_cents, from_account_id
      from transactions
      where owner_user_id = ${scope.userId}`;
    expect(movements).toHaveLength(1);
    expect(movements[0].amount_cents).toBe(String(AMOUNT_CENTS));
    expect(movements[0].from_account_id).toBe(scope.accountId);

    const [delivery] = await fixtureSql<
      { status: string; transaction_id: string | null }[]
    >`select status, transaction_id from ingest_deliveries where id = ${deliveryId}`;
    expect(delivery.status).toBe("accepted");
    expect(delivery.transaction_id).toBe(movements[0].id);
  });
});

test.describe("a category that came from a credential default", () => {
  test.beforeEach(async () => {
    await seedQueue([defaulted]);
  });

  test("says so on the badge and offers review, not accept", async ({ page }) => {
    await page.goto("/es/inbox");

    await expect(
      page.getByText(ingest.categoryFromDefault, { exact: true }),
    ).toBeVisible();
    await expect(reviewButton(page)).toHaveCount(1);
    await expect(acceptButton(page)).toHaveCount(0);
  });

  test("opens the form already carrying the read amount, account and category", async ({
    page,
  }) => {
    await page.goto("/es/inbox");
    await reviewButton(page).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Two fields carry the amount: the movement's own and the lone split's, which
    // the editor keeps equal to it (RF-69).
    const amounts = dialog.getByRole("textbox", { name: transactions.amountLabel });
    await expect(amounts).toHaveCount(2);
    await expect(amounts.nth(0)).toHaveValue(AMOUNT_PESOS);
    await expect(amounts.nth(1)).toHaveValue(AMOUNT_PESOS);

    await expect(
      dialog.getByRole("combobox", { name: transactions.fromLabel }),
    ).toHaveText(scope.accountName);
    await expect(
      dialog.getByRole("combobox", { name: transactions.categoryLabel }),
    ).toHaveText(scope.categoryName);
  });
});

test.describe("the queue at 360 px", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 360,
    "RNF-08's base case is the mobile project's viewport",
  );

  test("holds with no horizontal overflow and no control under 32 px", async ({
    page,
  }) => {
    await seedQueue([complete, incomplete]);
    await page.goto("/es/inbox");
    await expect(page.getByRole("heading", { name: TRUSTED })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    const controls = page.getByRole("button").or(page.getByRole("link"));
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      if (!(await control.isVisible())) continue;

      const box = await control.boundingBox();
      expect(box, `control ${index} has no box`).not.toBeNull();
      expect(
        Math.min(box!.width, box!.height),
        `control ${index} named ${JSON.stringify(await control.textContent())}`,
      ).toBeGreaterThanOrEqual(32);
    }
  });
});
