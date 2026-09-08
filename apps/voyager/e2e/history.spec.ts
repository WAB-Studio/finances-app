import fs from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import esbuild from "esbuild";

import type { HistoryCursor, HistoryPage } from "../lib/log/history";
import type { LookupOutcome } from "../lib/log/types";

// `history.ts` has no caller yet (module 26 wires it into `/registro`), so
// there is no screen to drive it through. It bundles clean on its own —
// only `record.ts` and `types.ts` behind it — so the real source is bundled
// for the browser and exercised there, against real IndexedDB, rather than
// re-typed by hand into a `page.evaluate` string the way `readAll`'s shape
// is mirrored elsewhere in this directory.
let bundlePromise: Promise<string> | null = null;
async function historyBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = esbuild
      .build({
        entryPoints: [path.resolve(__dirname, "../lib/log/history.ts")],
        bundle: true,
        format: "iife",
        globalName: "__voyagerHistory",
        platform: "browser",
        target: "es2020",
        write: false,
      })
      .then((result) => result.outputFiles[0].text);
  }
  return bundlePromise;
}

// `/registro` already opens `reading-log` at version 2 on mount
// (`ExportPanel`'s `countRecords()`), so visiting it first leaves the
// database in the same shape `record.ts`'s own `onupgradeneeded` produces —
// including the `foreign` index — before any row is seeded by hand.
async function loadHistoryModule(page: Page): Promise<void> {
  await page.goto("/registro");
  await page.addScriptTag({ content: await historyBundle() });
}

type SeedRow = {
  schema?: number;
  at: number;
  text: string;
  normalised: string;
  kind?: "word" | "phrase";
  outcome: LookupOutcome;
  headword?: string | null;
  rule?: string | null;
  senses?: number;
  translation?: string | null;
  dictionaryReady?: boolean;
  origin?: "device" | "network" | null;
  device?: string;
  deviceSeq?: number;
};

function defaultRow(overrides: Partial<SeedRow> & { at: number; outcome: LookupOutcome }): SeedRow {
  return {
    schema: 2,
    text: `row-${overrides.at}`,
    normalised: `row-${overrides.at}`,
    kind: "word",
    headword: null,
    rule: null,
    senses: 0,
    translation: null,
    dictionaryReady: true,
    origin: null,
    ...overrides,
  };
}

// Raw IndexedDB, matching `record.ts`'s own shape — the pattern every other
// spec in this directory already uses to seed `reading-log` by hand.
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
          for (const row of rows) store.add(row);
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

// Mirrors `e2e/log.spec.ts:147-178`'s own seeding loop exactly, run inside
// the page so 10,003 objects never cross the Node/browser boundary.
async function seedSequential(page: Page, count: number, startAt: number): Promise<void> {
  await page.evaluate(
    ({ count, startAt }) =>
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
              at: startAt - i,
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
    { count, startAt },
  );
}

async function rawCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("reading-log");
        request.onsuccess = () => {
          const db = request.result;
          const countRequest = db.transaction("lookups", "readonly").objectStore("lookups").count();
          countRequest.onsuccess = () => resolve(countRequest.result);
          countRequest.onerror = () => reject(countRequest.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
}

function callHistory(page: Page, after: HistoryCursor | null, limit?: number): Promise<HistoryPage> {
  return page.evaluate(
    ({ after, limit }) =>
      (
        window as unknown as {
          __voyagerHistory: { readHistoryPage: (after: HistoryCursor | null, limit?: number) => Promise<HistoryPage> };
        }
      ).__voyagerHistory.readHistoryPage(after, limit),
    { after, limit },
  );
}

test("history.ts imports nothing from lib/dictionary, lib/sync or components", async () => {
  const source = await fs.readFile(path.resolve(__dirname, "../lib/log/history.ts"), "utf-8");
  expect(source).not.toMatch(/lib\/dictionary|lib\/sync|components\//);
});

test("a tied `at` straddling the page boundary is returned exactly once per row, never repeated or skipped", async ({
  page,
}) => {
  await loadHistoryModule(page);

  const tiedAt = Date.now();
  const seededIds: number[] = [];
  const rows: SeedRow[] = [];
  for (let i = 0; i < 60; i++) {
    seededIds.push(i + 1); // a fresh store, so `add` assigns 1..60 in order
    rows.push(defaultRow({ at: tiedAt, outcome: "miss", text: `tied-${i}`, normalised: `tied-${i}` }));
  }
  await seedRows(page, rows);

  const first = await callHistory(page, null, 50);
  expect(first.rows).toHaveLength(50);
  expect(first.next).not.toBeNull();
  expect(first.rows.every((row) => row.at === tiedAt)).toBe(true);

  const second = await callHistory(page, first.next, 50);
  expect(second.rows).toHaveLength(10);
  expect(second.next).toBeNull();

  const returnedIds = [...first.rows, ...second.rows].map((row) => row.id);
  const uniqueIds = new Set(returnedIds);
  console.log(
    `tie test — seeded ${seededIds.length} rows on one \`at\`, returned ${returnedIds.length}, unique ${uniqueIds.size}`,
  );
  expect(returnedIds).toHaveLength(60);
  expect(uniqueIds.size).toBe(60);
  expect([...uniqueIds].sort((a, b) => a - b)).toEqual(seededIds);
});

test("10,003 rows page 50 at a time without reading the store whole, and the chain covers every row once", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await loadHistoryModule(page);

  const startAt = Date.now();
  await seedSequential(page, 10_003, startAt);
  expect(await rawCount(page)).toBe(10_003);

  const result = await page.evaluate(
    async (limit) => {
      const history = (
        window as unknown as {
          __voyagerHistory: { readHistoryPage: (after: unknown, limit?: number) => Promise<HistoryPage> };
        }
      ).__voyagerHistory;
      const start = performance.now();
      let current = await history.readHistoryPage(null, limit);
      const firstDuration = performance.now() - start;
      const firstPageLength = current.rows.length;
      const firstPageAts = current.rows.map((row) => row.at);
      const seenIds = new Set<number>();
      let total = 0;
      let pageCount = 0;
      while (true) {
        for (const row of current.rows) seenIds.add(row.id);
        total += current.rows.length;
        pageCount += 1;
        if (current.next === null) break;
        current = await history.readHistoryPage(current.next, limit);
      }
      return { firstDuration, firstPageLength, firstPageAts, total, uniqueCount: seenIds.size, pageCount };
    },
    50,
  );

  console.log(
    `first page at 10,003 rows — ${result.firstDuration.toFixed(3)} ms, ${result.firstPageLength} rows; ` +
      `full chain — ${result.pageCount} pages, ${result.total} rows read, ${result.uniqueCount} unique`,
  );

  expect(result.firstPageLength).toBe(50);
  // A page held to 50 rows answers in single-digit milliseconds regardless
  // of store size; a full `getAll()` over 10,003 objects does not.
  expect(result.firstDuration).toBeLessThan(50);
  for (let i = 1; i < result.firstPageAts.length; i++) {
    expect(result.firstPageAts[i]).toBeLessThanOrEqual(result.firstPageAts[i - 1]);
  }
  expect(result.total).toBe(10_003);
  expect(result.uniqueCount).toBe(10_003);
});

test("a row from before translation and a miss both come back as `translation: null`, indistinguishably", async ({
  page,
}) => {
  await loadHistoryModule(page);

  await seedRows(page, [
    {
      schema: 1, // pre-module-23: no `translation` field at all
      at: 2000,
      text: "legacy",
      normalised: "legacy",
      kind: "word",
      outcome: "exact",
      headword: "legacy",
      rule: null,
      senses: 1,
      dictionaryReady: true,
      origin: null,
    },
    defaultRow({ at: 1000, outcome: "miss", text: "zzqxplorph", normalised: "zzqxplorph", translation: null }),
  ]);

  const { rows } = await callHistory(page, null, 10);
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.translation)).toEqual([null, null]);
  expect(rows.map((row) => row.outcome)).toEqual(["exact", "miss"]);
});

test("a foreign row interleaves by its own `at`, and every row carries exactly five fields — no device", async ({
  page,
}) => {
  await loadHistoryModule(page);

  await seedRows(page, [
    defaultRow({ at: 3000, outcome: "exact", text: "local-new", normalised: "local-new", translation: "reciente" }),
    defaultRow({
      at: 2000,
      outcome: "translated",
      text: "foreign",
      normalised: "foreign",
      translation: "extranjera",
      device: "other-device",
      deviceSeq: 1,
    }),
    defaultRow({ at: 1000, outcome: "exact", text: "local-old", normalised: "local-old", translation: "vieja" }),
  ]);

  const { rows } = await callHistory(page, null, 10);
  expect(rows.map((row) => row.text)).toEqual(["local-new", "foreign", "local-old"]);
  for (const row of rows) {
    expect(Object.keys(row).sort()).toEqual(["at", "id", "outcome", "text", "translation"]);
  }
});
