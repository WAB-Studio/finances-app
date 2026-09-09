import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/es.json";
import type { LookupOutcome } from "../lib/log/types";

// The module 12 done criterion: `/registro/<normalised>` lists every search
// for one word, most recent first, and never bleeds a different word in.

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md); the word path here must never reach it.
async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

async function deleteLogDatabase(page: Page): Promise<void> {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase("reading-log");
  });
}

// Exposes every `Worker` construction as `window.__workersBuilt`, mirroring
// `export.spec.ts`'s own helper — RNL-08 holds here too.
async function countWorkerConstructions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __workersBuilt: number }).__workersBuilt = 0;
    const NativeWorker = window.Worker;
    class CountingWorker extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        (window as unknown as { __workersBuilt: number }).__workersBuilt += 1;
      }
    }
    window.Worker = CountingWorker as unknown as typeof Worker;
  });
}

type SeedRow = {
  at: number;
  text: string;
  normalised: string;
  translation: string | null;
  outcome?: LookupOutcome;
  // Set on a row standing in for one another device already merged in
  // (`merge.ts`'s own shape); absent on a row this "device" wrote itself.
  device?: string;
  deviceSeq?: number;
};

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
            const record: Record<string, unknown> = {
              schema: 2,
              at: row.at,
              text: row.text,
              normalised: row.normalised,
              kind: "word",
              outcome: row.outcome ?? "exact",
              headword: row.text,
              rule: null,
              senses: 1,
              translation: row.translation,
              dictionaryReady: true,
              origin: null,
            };
            // Only a foreign row names a device, matching `record.ts`'s own
            // `foreign` index: a local row carries neither key at all.
            if (row.device !== undefined) record.device = row.device;
            if (row.deviceSeq !== undefined) record.deviceSeq = row.deviceSeq;
            store.add(record);
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

const DAY_MS = 24 * 60 * 60 * 1000;

test("a word's history lists every one of its searches with its date, and no other word leaks in", async ({
  page,
}) => {
  await deleteTranslator(page);
  // No `deleteLogDatabase` here: it is an init script, so it would also fire
  // on the `/registro/lukewarm` navigation below and erase the rows just
  // seeded. A fresh Playwright context already starts with no database.
  await countWorkerConstructions(page);

  const now = Date.now();
  await page.goto("/registro");
  await seedRows(page, [
    { at: now - 3 * DAY_MS, text: "lukewarm", normalised: "lukewarm", translation: "tibio" },
    { at: now - 2 * DAY_MS, text: "lukewarm", normalised: "lukewarm", translation: "tibio" },
    { at: now - 1 * DAY_MS, text: "lukewarm", normalised: "lukewarm", translation: "tibio" },
    { at: now - 5 * DAY_MS, text: "Word", normalised: "word", translation: "palabra" },
  ]);

  await page.goto("/registro/lukewarm");
  await expect(page.getByRole("heading", { name: "lukewarm" })).toBeVisible();
  await expect(page.getByText(/3 búsquedas/)).toBeVisible();

  // Three rows: one `Exacta` label per search, none of them the other word's.
  await expect(page.getByText(messages.log.outcome.exact, { exact: true })).toHaveCount(3);
  await expect(page.getByText("Word", { exact: true })).toHaveCount(0);
  await expect(page.getByText("palabra", { exact: true })).toHaveCount(0);

  // RNL-08: this screen is IndexedDB-only, never the dictionary Worker.
  const workers = await page.evaluate(() => (window as unknown as { __workersBuilt: number }).__workersBuilt);
  expect(workers).toBe(0);

  await page.goto("/registro/word");
  await expect(page.getByRole("heading", { name: "Word" })).toBeVisible();
  await expect(page.getByText(messages.log.outcome.exact, { exact: true })).toHaveCount(1);
});

// RL-32's other half, `readWordHistory`, filters `lookups` on `normalised`
// alone: a foreign row (`device`/`deviceSeq` set, `merge.ts`'s own shape)
// sits in the same store as a local one and the reader never sees the
// difference — the screen just orders every row by its own `at`. Seeded
// out of both `at` order and insertion order, so a bug that sorted by
// insertion (autoincrement `id`) or grouped by device would show a
// different order than this test expects.
test("a word's history interleaves two devices' rows by their own `at`, not by device or insertion order", async ({
  page,
}) => {
  await deleteTranslator(page);

  const now = Date.now();
  await page.goto("/registro");
  await seedRows(page, [
    // id 1, at -3d, local
    { at: now - 3 * DAY_MS, text: "twilight", normalised: "twilight", translation: "crepúsculo", outcome: "inflected" },
    // id 2, at -1d, foreign (device-a)
    {
      at: now - 1 * DAY_MS,
      text: "twilight",
      normalised: "twilight",
      translation: "crepúsculo",
      outcome: "exact",
      device: "device-a",
      deviceSeq: 1,
    },
    // id 3, at -4d, local
    { at: now - 4 * DAY_MS, text: "twilight", normalised: "twilight", translation: "crepúsculo", outcome: "miss" },
    // id 4, at -2d, foreign (device-b)
    {
      at: now - 2 * DAY_MS,
      text: "twilight",
      normalised: "twilight",
      translation: "crepúsculo",
      outcome: "translated",
      device: "device-b",
      deviceSeq: 1,
    },
  ]);

  await page.goto("/registro/twilight");
  await expect(page.getByRole("heading", { name: "twilight" })).toBeVisible();
  await expect(page.getByText(/4 búsquedas/)).toBeVisible();

  // Document order of the four outcome labels: most recent `at` first,
  // regardless of which device wrote the row or when it was inserted.
  const labelPattern = new RegExp(
    [
      messages.log.outcome.exact,
      messages.log.outcome.translated,
      messages.log.outcome.inflected,
      messages.log.outcome.miss,
    ].join("|"),
  );
  const rendered = await page.getByText(labelPattern).allTextContents();
  expect(rendered).toEqual([
    messages.log.outcome.exact, // -1d, foreign, id 2
    messages.log.outcome.translated, // -2d, foreign, id 4
    messages.log.outcome.inflected, // -3d, local, id 1
    messages.log.outcome.miss, // -4d, local, id 3
  ]);
});

test("from /registro, tapping the lukewarm row reaches /registro/lukewarm", async ({ page }) => {
  await deleteTranslator(page);

  await page.goto("/registro");
  await seedRows(page, [{ at: Date.now(), text: "lukewarm", normalised: "lukewarm", translation: "tibio" }]);
  await page.reload();

  await page.locator('a[href="/registro/lukewarm"]').click();
  await expect(page).toHaveURL(/\/registro\/lukewarm$/);
});

test("a word never searched draws its own empty state, never a failure or a blank screen", async ({ page }) => {
  await deleteTranslator(page);
  await deleteLogDatabase(page);

  await page.goto("/registro/zzqqxv");
  await expect(page.getByRole("heading", { name: "zzqqxv" })).toBeVisible();
  await expect(page.getByText(messages.log.word.emptyBody.replace("{word}", "zzqqxv"))).toBeVisible();
  await expect(page.getByRole("button", { name: messages.log.word.emptyAction })).toBeVisible();
  await expect(page.getByText(messages.log.listFailed)).toHaveCount(0);
});

// The module 25 fix (`PalabraHistorialVacio`): the old copy borrowed from
// `study.emptyTitle`, "Todavía no has buscado nada" — false the moment the
// record holds even one row for some other word, which this seeds on
// purpose so a regression back to the borrowed copy fails loudly.
test("a word never searched keeps its own empty copy even when the record holds other words", async ({ page }) => {
  await deleteTranslator(page);

  await page.goto("/registro");
  await seedRows(page, [{ at: Date.now(), text: "lukewarm", normalised: "lukewarm", translation: "tibio" }]);

  await page.goto("/registro/zzqqxv");
  await expect(page.getByRole("heading", { name: "zzqqxv" })).toBeVisible();
  await expect(page.getByText(messages.log.word.emptyBody.replace("{word}", "zzqqxv"))).toBeVisible();
  await expect(page.getByText(messages.log.study.emptyTitle)).toHaveCount(0);

  // "Buscarla" hands the word straight to the search box.
  await page.getByRole("button", { name: messages.log.word.emptyAction }).click();
  await expect(page).toHaveURL(/\/\?q=zzqqxv$/);
  await expect(page.getByRole("textbox", { name: messages.search.label })).toHaveValue("zzqqxv");
});

// The dictionary's own longest headword, no space anywhere in it — the same
// literal string `word.spec.ts:157` and `estudio.spec.ts` already prove the
// search screen and the study hold at 360px. This screen's headline is
// `Headword`, which wraps mid-word by design (`headword.module.css`'s own
// `overflow-wrap: anywhere`) rather than truncating, so it carries none of
// `history-list.tsx`'s `Grid`+`Box`+`truncate` shape — proved here, not
// assumed from reading the component.
const LONGEST_HEADWORD = "Taumatawhakatangihangakoauauotamateaturipukakapikimaungahoronukupokaiwhenuakitanatahu";

test("a word's own headword with no space to break on never scrolls /registro/[palabra] sideways, at 360px", async ({
  page,
}) => {
  await deleteTranslator(page);

  await page.goto("/registro");
  await seedRows(page, [
    { at: Date.now(), text: LONGEST_HEADWORD, normalised: LONGEST_HEADWORD.toLowerCase(), translation: "tibio" },
  ]);
  await page.goto(`/registro/${LONGEST_HEADWORD.toLowerCase()}`);

  await expect(page.getByRole("heading", { name: LONGEST_HEADWORD })).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBe(clientWidth);
});

// A URL segment arrives percent-encoded, never decoded, on this Next
// version (measured against the page's own production build): a
// multi-word `normalised` used to render and to query IndexedDB as its own
// raw, still-encoded self, so a real record for "give up" never matched
// and the reader read a lie about a word they had searched twice.
test("a multi-word normalised decodes off its own URL segment, and still finds its own rows", async ({ page }) => {
  await deleteTranslator(page);

  await page.goto("/registro");
  await seedRows(page, [
    { at: Date.now() - DAY_MS, text: "give up", normalised: "give up", translation: "rendirse" },
    { at: Date.now(), text: "give up", normalised: "give up", translation: "rendirse" },
  ]);

  await page.goto("/registro/give%20up");
  await expect(page.getByRole("heading", { name: "give up" })).toBeVisible();
  await expect(page.getByText(/2 búsquedas/)).toBeVisible();
});

// The other half of the same defect: a word this record never held still
// names itself correctly in the empty state, and "Buscarla" hands the
// dictionary a real, single-decoded query — never `give%2520up`, the
// double-encoded href a raw `normalised` used to build.
test("a multi-word normalised never searched names itself right, and Buscarla finds the real entry", async ({
  page,
}) => {
  await deleteTranslator(page);
  await deleteLogDatabase(page);

  await page.goto("/registro/give%20up");
  await expect(page.getByRole("heading", { name: "give up" })).toBeVisible();
  await expect(page.getByText(messages.log.word.emptyBody.replace("{word}", "give up"))).toBeVisible();

  await page.getByRole("button", { name: messages.log.word.emptyAction }).click();
  await page.waitForURL(/\/\?q=/);
  expect(page.url()).toMatch(/\/\?q=give(\+|%20)up$/);
  await expect(page.getByRole("heading", { name: "give up" })).toBeVisible();
});

// Same defect, no space in sight: an accented `normalised` must decode too,
// not merely split on `%20`.
test("an accented normalised decodes off its own URL segment", async ({ page }) => {
  await deleteTranslator(page);
  await deleteLogDatabase(page);

  await page.goto("/registro/caf%C3%A9");
  await expect(page.getByRole("heading", { name: "café" })).toBeVisible();
});

// The mixed reading the fix must not produce: a real percent-encoded `%25`
// (a literal "%" character) decodes exactly once, to the same "100%" in
// every one of the three places that read `normalised` — the heading, the
// empty state's own body copy, and the query "Buscarla" hands the search
// box — never landing on `100%25` in one and `100%` in another.
test("a percent-encoded percent sign decodes once, the same way everywhere", async ({ page }) => {
  await deleteTranslator(page);
  await deleteLogDatabase(page);

  await page.goto("/registro/100%25");
  await expect(page.getByRole("heading", { name: "100%", exact: true })).toBeVisible();
  await expect(page.getByText(messages.log.word.emptyBody.replace("{word}", "100%"))).toBeVisible();

  await page.getByRole("button", { name: messages.log.word.emptyAction }).click();
  await page.waitForURL(/\/\?q=/);
  expect(page.url()).toMatch(/\/\?q=100%25$/);
});

// The regression that matters most: a single-word `normalised` carries no
// percent escape, so decoding it is a no-op — 75% of the dictionary's own
// entries take this path and must read exactly as they did before the fix.
test("a single-word normalised with nothing to decode is unchanged", async ({ page }) => {
  await deleteTranslator(page);
  await page.goto("/registro");
  await seedRows(page, [{ at: Date.now(), text: "book", normalised: "book", translation: "libro" }]);

  await page.goto("/registro/book");
  await expect(page.getByRole("heading", { name: "book" })).toBeVisible();
  await expect(page.getByText(messages.log.outcome.exact, { exact: true })).toHaveCount(1);
});
