import { createTranslator } from "next-intl";
import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";

// The same runtime `next-intl` renders with: `log.study.header` is an ICU
// plural, so a literal `"{lookups}"` substring never appears in the
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

// Same store, read instead of wiped. Call this before any further
// navigation on `page`: `addInitScript` reinjects on every document `page`
// loads, not once (docs/TRAPS.md), so a `deleteLogDatabase`'d page that
// navigates again before this runs reads back nothing regardless of what
// was actually written.
async function readLogRows(page: Page): Promise<Array<{ normalised: string }>> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("reading-log");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("lookups", "readonly");
          const getAll = tx.objectStore("lookups").getAll();
          getAll.onsuccess = () => resolve(getAll.result);
          getAll.onerror = () => reject(getAll.error);
        };
      }),
  );
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

  await expect(page.getByText(t("log.study.header", { lookups: 1, words: 1 }))).toBeVisible();

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

test("tapping \"Registro\" in the nav bar draws the search that motivated the trip, with no reload and no 5s wait", async ({
  page,
}) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("apple");
  // Long enough for the lookup's own promise to answer and `recordLookup`
  // to run, well short of `record.ts`'s own `SETTLE_MS` (800ms): the row
  // is still only `latestCandidate`, never even `pending`, when the tap
  // below fires — the flush it forces has to fold that candidate in too.
  await page.waitForTimeout(300);

  // A client-side navigation, not `page.goto`: this is the trigger
  // `pagehide`/`visibilitychange` never fire for.
  await page
    .getByRole("navigation", { name: messages.nav.label })
    .getByRole("link", { name: messages.nav.log })
    .click();
  await expect(page).toHaveURL(/\/registro$/);

  // No ceiling forces this row to wait: the unmount flush this tap triggers
  // is the only thing that has to land before the count shows.
  await expect(page.getByText(t("log.study.header", { lookups: 1, words: 1 }))).toBeVisible({ timeout: 2500 });

  const row = page.locator('a[href="/registro/apple"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText("apple");
});

test("with no rows, /registro draws the study's empty state and its action returns to /", async ({ page }) => {
  await deleteTranslator(page);
  await deleteLogDatabase(page);

  await page.goto("/registro");
  await expect(page.getByText(messages.log.study.emptyTitle)).toBeVisible();
  await expect(page.getByText(messages.log.study.emptyBody)).toBeVisible();

  // The empty study already says there is nothing here; a download link
  // for a file with no rows in it would only repeat that with an action
  // that does not work.
  await expect(page.getByRole("button", { name: messages.log.study.download })).toHaveCount(0);
  await expect(page.getByText(t("log.study.header", { lookups: 0, words: 0 }))).toHaveCount(0);

  await page.getByRole("button", { name: messages.log.study.emptyAction }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("a reader who only ever missed leaves no row, and /registro still shows the empty state, not a dead screen", async ({
  page,
}) => {
  await deleteTranslator(page);
  await deleteLogDatabase(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  // RL-38: a word the dictionary carries nothing for leaves no row. A
  // multi-character nonsense string, not a single letter, so it stays a
  // miss regardless of the other lane's own change to one-character
  // queries.
  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("xyzzy");
  await searchBox.fill("");
  await page.waitForTimeout(300);

  // Read here, on this same document, before anything navigates again:
  // `deleteLogDatabase`'s `addInitScript` reinjects on the `goto` below too
  // and would wipe whatever RL-38's guard left behind before the assertion
  // ever got to see it.
  const rows = await readLogRows(page);
  expect(rows).toHaveLength(0);

  await page.goto("/registro");
  await expect(page.getByText(messages.log.study.emptyTitle)).toBeVisible();
  await expect(page.getByText(messages.log.study.emptyBody)).toBeVisible();
  await expect(page.getByText(t("log.study.header", { lookups: 0, words: 0 }))).toHaveCount(0);
});

test("with the store broken, /registro draws the failure, with no system red and a retry", async ({ page }) => {
  await deleteTranslator(page);
  await breakIndexedDB(page);

  await page.goto("/registro");
  await expect(page.getByText(messages.log.study.failedTitle)).toBeVisible();
  await expect(page.getByText(messages.log.study.failedBody)).toBeVisible();
  await expect(page.getByRole("button", { name: messages.log.study.failedAction })).toBeVisible();
});
