import fs from "node:fs/promises";

import { createTranslator } from "next-intl";
import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";
import type { LookupRecord } from "../lib/log/types";
import type { LogExport } from "../lib/log/export";
// A plain number, safe to import at Node runtime — `record.ts` guards every
// call that touches `indexedDB` or `window` behind a `typeof` check, and this
// constant sits outside all of them. Sourcing it here, instead of a second
// literal `2`, keeps the seeder below in lockstep with the schema it mirrors.
import { DATABASE_VERSION } from "../lib/log/record";

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

// Exposes every `Worker` construction as `window.__workersBuilt`, so a test
// can prove `/registro` mounts none (RNL-08) without importing the hook that
// would create one.
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

// Raw IndexedDB, mirroring `lib/log/record.ts`'s own shape — this file runs
// inside `page.evaluate`, a browser context no Node import reaches, so it
// opens the same database by name instead of importing `readAll`.
async function readRawRows(page: Page): Promise<LookupRecord[]> {
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

// Mirrors `lib/log/record.ts`'s own `onupgradeneeded`, version pin included:
// this may race the app's mount effect for who creates `reading-log` first,
// so it stays able to build the store itself rather than assume the app
// already did. Opening at a fixed, imported version — not versionless, the
// fix that applies to a reader — is what a schema's own creator does; a
// version this call wins the race at is a version the app's own later open
// must find already there, or its `onupgradeneeded` tries to recreate the
// sync store and aborts.
async function seedRows(page: Page, count: number): Promise<void> {
  await page.evaluate(
    ({ count, version }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("reading-log", version);
        request.onupgradeneeded = (event) => {
          const database = request.result;
          if (event.oldVersion < 1) {
            const store = database.createObjectStore("lookups", { keyPath: "id", autoIncrement: true });
            store.createIndex("at", "at");
            store.createIndex("normalised", "normalised");
          }
          if (event.oldVersion < 2) {
            database.createObjectStore("sync", { keyPath: "key" });
            request.transaction!
              .objectStore("lookups")
              .createIndex("foreign", ["device", "deviceSeq"], { unique: true });
          }
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
    { count, version: DATABASE_VERSION },
  );
}

async function downloadExport(page: Page): Promise<LogExport> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: messages.log.study.download }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^registro-lecturas-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  if (!path) throw new Error("no download path");
  const contents = await fs.readFile(path, "utf-8");
  return JSON.parse(contents) as LogExport;
}

test("10,003 rows export whole, and the file round-trips through JSON exactly", async ({ page }) => {
  // A larger workload than the suite's default 30s comfortably covers:
  // 10,003 IndexedDB writes, then a 10,003-row JSON round trip.
  test.setTimeout(60_000);
  await deleteTranslator(page);

  // `/registro` never imports `lib/dictionary`: opening it directly needs no
  // asset and never mounts a Worker (RNL-08), unlike `/`.
  await page.goto("/registro");
  await expect(page.getByRole("heading", { name: messages.log.title })).toBeVisible();

  await seedRows(page, 10_003);
  await page.reload();

  await expect(page.getByText(t("log.count", { count: 10_003 }))).toBeVisible();

  const rawRows = await readRawRows(page);
  expect(rawRows).toHaveLength(10_003);

  const exported = await downloadExport(page);
  // The envelope stays at 1 and the row schema moves with the store: a reader
  // that only knows version 1 still parses the file (plan, decision 10).
  expect(exported.exportSchema).toBe(1);
  expect(exported.recordSchema).toBe(2);
  expect(typeof exported.exportedAt).toBe("number");
  expect(exported.rows).toHaveLength(10_003);
  expect(exported.rows).toEqual(rawRows);
});

test("/fuente links to /registro, which counts what was searched and exports it", async ({ page }) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("apple");
  await searchBox.fill("");
  await page.waitForTimeout(300);

  await page.getByRole("link", { name: messages.source.open }).click();
  await expect(page).toHaveURL(/\/fuente$/);

  await page.getByRole("link", { name: messages.log.openLink }).click();
  await expect(page).toHaveURL(/\/registro$/);

  await expect(page.getByText(t("log.count", { count: 1 }))).toBeVisible();

  const exported = await downloadExport(page);
  expect(exported.exportSchema).toBe(1);
  expect(exported.rows).toHaveLength(1);
  expect(exported.rows[0].kind).toBe("word");
  expect(exported.rows[0].text).toBe("apple");
});

test("RNL-08: /registro mounts no dictionary Worker, and searching issues no request the export path would own", async ({
  page,
}) => {
  await deleteTranslator(page);
  await countWorkerConstructions(page);

  // Reached cold, the way a reader who never opened the box would reach it.
  await page.goto("/registro");
  await expect(page.getByRole("heading", { name: messages.log.title })).toBeVisible();
  await page.waitForTimeout(300);

  const requestsOnRegistro: string[] = [];
  page.on("request", (request) => requestsOnRegistro.push(request.url()));
  await page.waitForTimeout(500);
  expect(requestsOnRegistro.some((url) => url.includes(manifest.asset.path))).toBe(false);

  const workersOnRegistro = await page.evaluate(
    () => (window as unknown as { __workersBuilt: number }).__workersBuilt,
  );
  expect(workersOnRegistro).toBe(0);

  // Now the search screen: the one Worker construction it owns, and the one
  // request its own asset fetch owns — neither repeats on a keystroke.
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  const tenKeystrokes = "throughout";

  // A warm-up run of the exact same keystrokes first, autocomplete included,
  // so every web font any state along the way paints is already cached
  // before the measured run: a font request belongs to painting a state for
  // the first time ever, not to the word path RL-14 governs.
  await searchBox.pressSequentially(tenKeystrokes, { delay: 40 });
  await expect(page.getByRole("heading", { name: tenKeystrokes })).toBeVisible();
  await searchBox.fill("");
  await page.waitForTimeout(300);

  const requestsWhileTyping: string[] = [];
  page.on("request", (request) => requestsWhileTyping.push(request.url()));

  await searchBox.pressSequentially(tenKeystrokes, { delay: 40 });

  expect(requestsWhileTyping, `10 keystrokes issued: ${JSON.stringify(requestsWhileTyping)}`).toHaveLength(0);
});
