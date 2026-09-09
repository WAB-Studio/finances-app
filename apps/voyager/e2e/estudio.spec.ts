import { expect, test, type Page } from "@playwright/test";

// The module 7 done criterion: `/registro` groups by word, orders by
// frequency, folds case into one row, and links each row to its own
// history (RL-32's first half — the second is `palabra-historial.spec.ts`).

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md); the word path here must never reach it.
async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

type SeedRow = { at: number; text: string; normalised: string; translation: string | null };

// Raw IndexedDB, mirroring `lib/log/record.ts`'s own shape — this runs
// inside `page.evaluate`, a browser context no Node import reaches.
async function seedRows(page: Page, rows: SeedRow[]): Promise<void> {
  await page.evaluate(
    (rows) =>
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
          for (const row of rows) {
            store.add({
              schema: 2,
              at: row.at,
              text: row.text,
              normalised: row.normalised,
              kind: "word",
              outcome: "exact",
              headword: row.text,
              rule: null,
              senses: 1,
              translation: row.translation,
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
    rows,
  );
}

test("three lukewarm and a Word fold into two rows, lukewarm first, Word never its own row", async ({ page }) => {
  await deleteTranslator(page);
  // No `deleteLogDatabase` here: it is an init script, so it would also fire
  // on the `reload()` below and erase the rows just seeded. A fresh
  // Playwright context already starts with no `reading-log` of its own.

  const now = Date.now();
  await page.goto("/registro");
  await seedRows(page, [
    { at: now - 5000, text: "lukewarm", normalised: "lukewarm", translation: "tibio" },
    { at: now - 4000, text: "lukewarm", normalised: "lukewarm", translation: "tibio" },
    { at: now - 3000, text: "lukewarm", normalised: "lukewarm", translation: "tibio" },
    // The capitalised search is the older of the two: the newer, lowercase
    // one is what the fold's own `newer` branch (summary.ts:33) should show.
    { at: now - 2000, text: "Word", normalised: "word", translation: "palabra" },
    { at: now - 1000, text: "word", normalised: "word", translation: "palabra" },
  ]);
  await page.reload();

  const rows = page.locator('a[href^="/registro/"]');
  await expect(rows).toHaveCount(2);

  const texts = await rows.allInnerTexts();
  expect(texts[0]).toContain("lukewarm");
  expect(texts[0]).toContain("3");
  expect(texts[1]).toContain("word");
  expect(texts[1]).toContain("2");

  // The literal string "Word" never draws as its own row's text: the fold
  // resolved the group's display to the most recent search, "word".
  await expect(page.getByText("Word", { exact: true })).toHaveCount(0);
});

test("tapping a row from /registro reaches that word's own history", async ({ page }) => {
  await deleteTranslator(page);

  await page.goto("/registro");
  await seedRows(page, [{ at: Date.now(), text: "lukewarm", normalised: "lukewarm", translation: "tibio" }]);
  await page.reload();

  await page.locator('a[href="/registro/lukewarm"]').click();
  await expect(page).toHaveURL(/\/registro\/lukewarm$/);
});
