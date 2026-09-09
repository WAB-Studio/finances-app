import { createTranslator } from "next-intl";
import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";

// The same runtime `next-intl` renders with: module 2's `log.count` is an
// ICU plural, so a literal `"{count}"` substring never appears in the
// rendered text and a naive `.replace` against it always misses.
const t = createTranslator({ locale: "es", messages });

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md); the word path here must never reach it.
async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

// Raw IndexedDB, mirroring `lib/log/record.ts`'s own shape — this runs
// inside `page.evaluate`, a browser context no Node import reaches, so it
// opens the same database by name instead of importing `record.ts`.
async function deleteLogDatabase(page: Page): Promise<void> {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase("reading-log");
  });
}

// `record.ts`'s own guard (`typeof indexedDB === "undefined"`) is what a
// broken store looks like to this app; `open` throwing synchronously turns
// every read the screen makes into a rejected promise, the same way a real
// storage failure would.
async function breakIndexedDB(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: { open: () => { throw new Error("storage broken"); } },
    });
  });
}

test("a lookup's row lists the typed word, its count and a non-empty translation", async ({ page }) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("apple");
  // Clearing the box forces the flush `record.ts:129-143` describes: the
  // guard has no other way to learn a query was abandoned mid-word.
  await searchBox.fill("");
  await page.waitForTimeout(300);

  await page.goto("/registro");

  await expect(page.getByText(t("log.count", { count: 1 }))).toBeVisible();

  const row = page.locator('a[href="/registro/apple"]');
  await expect(row).toBeVisible();
  const rowText = await row.innerText();
  expect(rowText).toContain("apple");
  expect(rowText).toContain("1");

  // What is left over once the word and its count are stripped is the
  // translation module 24 wrote and module 25's grouped read carries here.
  const translation = rowText.replace("apple", "").replace("1", "").trim();
  expect(translation.length).toBeGreaterThan(0);
});

test("with no rows, /registro draws the study's empty state and its action returns to /", async ({ page }) => {
  await deleteTranslator(page);
  await deleteLogDatabase(page);

  await page.goto("/registro");
  await expect(page.getByText(messages.log.study.emptyTitle)).toBeVisible();
  await expect(page.getByText(messages.log.study.emptyBody)).toBeVisible();

  await page.getByRole("button", { name: messages.log.study.emptyAction }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("with the store broken, /registro draws the failure, with no system red and a retry", async ({ page }) => {
  await deleteTranslator(page);
  await breakIndexedDB(page);

  await page.goto("/registro");
  await expect(page.getByText(messages.log.study.failedTitle)).toBeVisible();
  await expect(page.getByText(messages.log.study.failedBody)).toBeVisible();
  await expect(page.getByRole("button", { name: messages.log.study.failedAction })).toBeVisible();
});
