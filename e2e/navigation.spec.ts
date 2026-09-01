/**
 * The queue's two navigation surfaces and the dashboard badge that points at it
 * (plan modules 13 and 17). The sheet closing on a navigation and the badge
 * collapsing at zero are rendered states no headless check reaches.
 */
import { expect } from "@playwright/test";

import messages from "@/messages/es.json";

import {
  clearLedger,
  clearQueue,
  readScope,
  seedQueue,
  seedUnreviewedMovement,
  test,
} from "./global-setup";

const nav = messages.nav;

const scope = readScope();

const MERCHANT = "Comercio de la bandeja";

const pending = {
  merchant: MERCHANT,
  amountCents: 4500000,
  accountId: scope.accountId,
  categoryId: scope.categoryId,
  categorySource: "merchant" as const,
  trusted: true,
};

// The `one` branch of an ICU plural with `#` filled: the badge's caption at one
// waiting delivery, taken from the message the screen renders.
function atOne(message: string): string {
  return (/one \{([^}]*)\}/.exec(message)?.[1] ?? message).replace("#", "1");
}

const PENDING_BADGE = atOne(messages.dashboard.pendingDeliveriesBadge);

test.describe("the desktop navigation panel", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1280,
    "the panel renders from md up",
  );

  test("lists the inbox and marks it current when open", async ({ page }) => {
    await page.goto("/es");
    await page.getByRole("button", { name: nav.openLabel }).click();

    const entry = page.getByRole("link", { name: nav.inbox, exact: true });
    await expect(entry).toHaveAttribute("href", "/es/inbox");

    await entry.click();
    await expect(page).toHaveURL("/es/inbox");

    await page.getByRole("button", { name: nav.openLabel }).click();
    await expect(
      page.getByRole("link", { name: nav.inbox, exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });
});

test.describe("the phone's navigation", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 360,
    "the bottom bar and its sheet render below md",
  );

  test("reaches the inbox from the settings sheet, which closes behind it", async ({
    page,
  }) => {
    await page.goto("/es");
    await page.getByRole("button", { name: nav.settings, exact: true }).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    await sheet.getByRole("link", { name: nav.inbox, exact: true }).click();
    await expect(page).toHaveURL("/es/inbox");
    await expect(sheet).toBeHidden();
  });

  test("keeps its three tabs, each at least 32 px on its shorter side", async ({
    page,
  }) => {
    await page.goto("/es");

    for (const label of [nav.home, nav.movements, nav.planning]) {
      const tab = page.getByRole("link", { name: label, exact: true });
      await expect(tab).toBeVisible();

      const box = await tab.boundingBox();
      expect(box, `${label} has no box`).not.toBeNull();
      expect(Math.min(box!.width, box!.height), label).toBeGreaterThanOrEqual(32);
    }
  });
});

test.describe("the dashboard's pending badge", () => {
  test("carries the count and reaches the inbox in one tap", async ({ page }) => {
    await seedQueue([pending]);
    await page.goto("/es");

    const badge = page.getByRole("link", { name: PENDING_BADGE, exact: true });
    await expect(badge).toBeVisible();

    await badge.click();
    await expect(page).toHaveURL("/es/inbox");
  });

  test("leaves no gap at zero", async ({ page }) => {
    // No generated movement either: the other badge would hold the row open.
    await clearLedger();
    await seedQueue([pending]);
    await page.goto("/es");

    const below = page.getByText(messages.dashboard.monthIncome, { exact: true });
    const withBadge = await below.boundingBox();

    await clearQueue();
    await page.reload();
    await expect(
      page.getByRole("link", { name: PENDING_BADGE, exact: true }),
    ).toHaveCount(0);

    // The row is conditional, not merely empty: what stood below it moves up by
    // the badge's own height rather than keeping its place.
    const withoutBadge = await below.boundingBox();
    expect(withBadge).not.toBeNull();
    expect(withoutBadge).not.toBeNull();
    expect(withoutBadge!.y).toBeLessThan(withBadge!.y);
  });

  test("sits beside the unreviewed badge with no overflow at 360 px", async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== "mobile",
      "RNF-08's base case is the mobile project's viewport",
    );

    await clearLedger();
    await seedQueue([pending]);
    await seedUnreviewedMovement();
    await page.goto("/es");

    await expect(
      page.getByRole("link", { name: PENDING_BADGE, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /sin revisar/ })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
});
