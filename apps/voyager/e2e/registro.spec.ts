import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";

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

// Mirrors `e2e/export.spec.ts:56-98`'s own seeder: `schema: 1` rows with no
// `translation` at all, the shape `toRow`'s `?? null` heals rather than the
// shape a real search writes.
async function seedRows(page: Page, count: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("reading-log");
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore("lookups", { keyPath: "id", autoIncrement: true });
          store.createIndex("at", "at");
          store.createIndex("normalised", "normalised");
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("lookups", "readwrite");
          const store = tx.objectStore("lookups");
          for (let i = 0; i < count; i++) {
            store.add({
              schema: 1,
              at: Date.now() - i,
              text: `seed-${i}`,
              normalised: `seed-${i}`,
              kind: "word",
              outcome: "miss",
              headword: null,
              rule: null,
              senses: 0,
              dictionaryReady: true,
              origin: null,
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
    count,
  );
}

test("a lookup's row lists with the typed text, a non-empty translation and the Exacta label", async ({ page }) => {
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

  const expectedCount = messages.log.count.replace("{count}", "1");
  await expect(page.getByText(expectedCount)).toBeVisible();

  await expect(page.getByText("apple", { exact: true })).toBeVisible();
  await expect(page.getByText(messages.log.outcome.exact, { exact: true })).toBeVisible();

  // The row's own container: the word span and the outcome label share it,
  // two ancestors up — proven against a live build in this branch's own
  // history, not assumed. What is left over once both known strings are
  // stripped is the translation module 24 wrote and module 25 read back.
  const rowText = await page.getByText("apple", { exact: true }).locator("xpath=../..").innerText();
  const translation = rowText.replace("apple", "").replace(messages.log.outcome.exact, "").trim();
  expect(translation.length).toBeGreaterThan(0);
});

test("10,003 rows draw 50, and log.more draws 50 more without changing the count", async ({ page }) => {
  test.setTimeout(60_000);
  await deleteTranslator(page);

  await page.goto("/registro");
  await seedRows(page, 10_003);
  await page.reload();

  const missLabel = page.getByText(messages.log.outcome.miss, { exact: true });
  await expect(missLabel.first()).toBeVisible();
  await expect(missLabel).toHaveCount(50);

  const expectedCount = messages.log.count.replace("{count}", "10003");
  await expect(page.getByText(expectedCount)).toBeVisible();

  await page.getByRole("button", { name: messages.log.more }).click();
  await expect(missLabel).toHaveCount(100);
  await expect(page.getByText(expectedCount)).toBeVisible();
});

test("with no rows, /registro draws the empty state and its link returns to /", async ({ page }) => {
  await deleteTranslator(page);
  await deleteLogDatabase(page);

  await page.goto("/registro");
  await expect(page.getByText(messages.log.empty)).toBeVisible();

  await page.getByRole("link", { name: messages.log.emptyAction }).click();
  await expect(page).toHaveURL(/\/$/);
});
