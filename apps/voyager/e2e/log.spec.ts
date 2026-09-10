import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";
import type { WorkerRequest, WorkerResponse } from "../lib/dictionary/worker-protocol";

async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

async function exposeDictionaryWorker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    class CapturingWorker extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        (window as unknown as { __dictionaryWorker?: Worker }).__dictionaryWorker = this;
      }
    }
    window.Worker = CapturingWorker as unknown as typeof Worker;
  });
}

type WorkerRequestShape = Extract<WorkerRequest, { kind: "lookup" }>;
type WorkerResponseShape = Extract<WorkerResponse, { kind: "answer" }> | { id?: number; kind: string };

let nextProbeId = 20_000_000;

async function measureWorkerRoundTrips(page: Page, count: number, text: string): Promise<number[]> {
  return page.evaluate(
    async ({ count, text, startId }) => {
      const worker = (window as unknown as { __dictionaryWorker: Worker }).__dictionaryWorker;
      const durations: number[] = [];
      for (let i = 0; i < count; i++) {
        const id = startId + i;
        const start = performance.now();
        await new Promise<void>((resolve) => {
          const onMessage = (event: MessageEvent<WorkerResponseShape>) => {
            if (event.data.id !== id || event.data.kind !== "answer") return;
            worker.removeEventListener("message", onMessage);
            durations.push(performance.now() - start);
            resolve();
          };
          worker.addEventListener("message", onMessage);
          worker.postMessage({ id, kind: "lookup", text } satisfies WorkerRequestShape);
        });
      }
      return durations;
    },
    { count, text, startId: (nextProbeId += count * 2) - count * 2 },
  );
}

function percentile(durations: readonly number[], p: number): number {
  const sorted = [...durations].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

// Raw IndexedDB, mirroring `lib/log/record.ts`'s own shape — this file may
// not import it (it runs inside `page.evaluate`, a browser context no Node
// import reaches), so it opens the same database by name instead.
async function readLogRows(
  page: Page,
): Promise<
  Array<{ normalised: string; outcome: string; dictionaryReady: boolean; senses: number; translation: string | null }>
> {
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

// No version pinned and no `onupgradeneeded`: every caller navigates first,
// so the store already exists at whatever version the app itself opened.
async function seedLocalRows(page: Page, count: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("reading-log");
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

// Mirrors `lib/log/merge.ts`'s own batching and per-row constraint
// swallowing — `mergeForeign` itself is unreachable from here: nothing in
// the shipped app calls it yet (module 12), so no bundle exposes it on
// `window`, and this evaluates inside a browser context no Node import
// reaches regardless. Resolves once every batch has landed; a caller that
// wants the merge running *while* it does something else holds this
// promise without awaiting it first (RNL-01 under fusion).
async function mergeForeignRows(page: Page, count: number, device: string): Promise<void> {
  await page.evaluate(
    ({ count, device }) =>
      new Promise<void>((resolve, reject) => {
        const BATCH_SIZE = 500;
        const request = indexedDB.open("reading-log");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const insertBatch = (offset: number) => {
            if (offset >= count) {
              db.close();
              resolve();
              return;
            }
            const tx = db.transaction("lookups", "readwrite");
            const store = tx.objectStore("lookups");
            const end = Math.min(offset + BATCH_SIZE, count);
            for (let i = offset; i < end; i++) {
              const add = store.add({
                schema: 2,
                at: Date.now() - i,
                text: `foreign-${i}`,
                normalised: `foreign-${i}`,
                kind: "word",
                outcome: "miss",
                headword: null,
                rule: null,
                senses: 0,
                translation: null,
                dictionaryReady: true,
                origin: null,
                device,
                deviceSeq: i,
              });
              // Already merged: cancel the default abort, keep going.
              add.onerror = (event) => {
                if (add.error?.name === "ConstraintError") event.preventDefault();
              };
            }
            tx.oncomplete = () => insertBatch(end);
            tx.onabort = () => reject(tx.error);
          };
          insertBatch(0);
        };
      }),
    { count, device },
  );
}

test("every lookup that finds an answer is recorded, a miss leaves no row, a fat log costs nothing, and a lost log costs nothing either", async ({
  page,
  context,
}) => {
  await deleteTranslator(page);
  await exposeDictionaryWorker(page);

  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });

  // RL-17 / RNL-06's guard: five keystrokes under the 800ms settle fold into
  // one row, not a deck full of "thro" and "throu".
  await searchBox.pressSequentially("throughout", { delay: 30 });
  await searchBox.fill("");
  await page.waitForTimeout(300);

  const afterWord = await readLogRows(page);
  expect(afterWord.filter((row) => row.normalised === "throughout")).toHaveLength(1);
  expect(afterWord).toHaveLength(1);

  // A word the dictionary carries nothing for: RL-39 leaves no row for a
  // miss, so the log stays at the one row "throughout" already wrote.
  await searchBox.fill("zzqxplorph");
  await searchBox.fill("");
  await page.waitForTimeout(300);

  const afterMiss = await readLogRows(page);
  expect(afterMiss.find((row) => row.normalised === "zzqxplorph")).toBeUndefined();
  expect(afterMiss).toHaveLength(1);

  // A query typed while the install is still running: a second page shares
  // the same origin's storage, so its row lands beside the first one. A
  // real headword, not a miss — RL-39 leaves nothing to inspect on a miss,
  // and this row's `dictionaryReady` is the whole point of the test.
  const installingPage = await context.newPage();
  await deleteTranslator(installingPage);
  await installingPage.route(`**${manifest.asset.path}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
  await installingPage.goto("/");
  const installingBox = installingPage.getByRole("textbox", { name: messages.search.label });
  await installingBox.fill("apple");
  // The keystroke's own `dictionaryReady` flag is read synchronously, at
  // type time — long before this settles, however long the install takes.
  // Waiting for the answer to render proves the worker actually reached
  // this query, queued behind the delayed install, before the box is
  // cleared to force the row's flush.
  await expect(installingPage.getByRole("heading", { name: "apple" })).toBeVisible({ timeout: 8000 });
  await installingBox.fill("");
  await installingPage.waitForTimeout(300);
  await installingPage.close();

  const afterInstalling = await readLogRows(page);
  const installingRow = afterInstalling.find((row) => row.normalised === "apple");
  expect(installingRow?.dictionaryReady).toBe(false);

  // The guard that matters: 10,000 rows already in the log, and the worker's
  // own round trip is unmoved — it never reads this database at all.
  await seedLocalRows(page, 10_000);

  const seededCount = (await readLogRows(page)).length;
  expect(seededCount).toBe(10_002);

  const durations = await measureWorkerRoundTrips(page, 200, "throughout");
  const p95 = percentile(durations, 95);
  console.log(`RNL-01 worker round trip, 200 lookups, log at 10,002 rows — p95 ${p95.toFixed(3)} ms`);
  expect(p95).toBeLessThan(10);

  // A lost log, mid-session: force-clear IndexedDB the way a browser's own
  // storage eviction would — bypassing the polite `versionchange` handshake
  // `lib/log/record.ts` never listens for, which a plain `deleteDatabase()`
  // would instead block on forever behind the page's own open connection.
  const client = await context.newCDPSession(page);
  await client.send("Storage.clearDataForOrigin", {
    origin: new URL(page.url()).origin,
    storageTypes: "indexeddb",
  });

  // The worker already holds its index in memory; a lookup answers exactly
  // as before, and nothing about the vanished log reaches the page as an
  // unhandled rejection (RNL-06: a failed write is swallowed, not thrown).
  await searchBox.fill("throughout");
  await expect(page.getByRole("heading", { name: "throughout" })).toBeVisible({ timeout: 5000 });
  await searchBox.fill("");
  await page.waitForTimeout(300);

  expect(pageErrors).toEqual([]);
});

test("RNL-01 stays under 10ms with a 10,000-row merge in flight (RNL-06 under decision 3)", async ({ page }) => {
  await deleteTranslator(page);
  await exposeDictionaryWorker(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  // `reading-log` opens lazily, on the first settled query (`record.ts`):
  // one throwaway lookup is what stands up the real v2 schema — store, sync,
  // `foreign` index — before the raw seeders below reach for it with no
  // `onupgradeneeded` of their own to fall back on.
  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.pressSequentially("primer", { delay: 30 });
  await searchBox.fill("");
  await page.waitForTimeout(300);

  await seedLocalRows(page, 10_000);

  // Launched, not awaited: the merge's own batches of `add` calls are still
  // landing while the round trips below run, which is the only way to prove
  // the worker's answer never waits on this database (RNL-06).
  const mergeDone = mergeForeignRows(page, 10_000, "peer-device");

  const durations = await measureWorkerRoundTrips(page, 200, "throughout");
  const p95 = percentile(durations, 95);
  console.log(`RNL-01 worker round trip under a 10,000-row merge in flight, 200 lookups — p95 ${p95.toFixed(3)} ms`);
  expect(p95).toBeLessThan(10);

  await mergeDone;
  const rowCount = (await readLogRows(page)).length;
  expect(rowCount).toBe(20_001);
});

test("RL-34: a word's stored translation spans senses, and the 120-char cut still wins over the 3-sense cap", async ({
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

  // "back" carries four senses (v, n, adj, adv). Its first sense alone never
  // reaches 120 characters, so a translation reaching "dorso" — the noun
  // sense's own second gloss, not a substring of anything the verb sense
  // carries — is the only way this row proves the second sense was kept,
  // not just the first one over budget.
  await searchBox.fill("back");
  await expect(page.getByRole("heading", { name: "back" })).toBeVisible({ timeout: 5000 });
  await searchBox.fill("");
  await page.waitForTimeout(300);

  const backRow = (await readLogRows(page)).find((row) => row.normalised === "back");
  expect(backRow?.senses).toBe(4);
  expect(backRow?.translation).toContain("dorso");
  expect(backRow?.translation?.length).toBeLessThanOrEqual(120);

  // A one-sense headword whose glosses alone run to 154 raw characters: the
  // cut still lands at exactly 120, unmoved by the sense cap above it.
  await searchBox.fill("the road to hell is paved with good intentions");
  await expect(page.getByRole("heading", { name: "the road to hell is paved with good intentions" })).toBeVisible({
    timeout: 5000,
  });
  await searchBox.fill("");
  await page.waitForTimeout(300);

  const idiomRow = (await readLogRows(page)).find(
    (row) => row.normalised === "the road to hell is paved with good intentions",
  );
  expect(idiomRow?.senses).toBe(1);
  expect(idiomRow?.translation).toHaveLength(120);

  // "anyway" carries one sense whose raw glosses run to 195 characters, and
  // the 120-char cut lands right after "comoquiera, " — a separator, not a
  // letter. The stored row must not carry that dangling ", " onward.
  await searchBox.fill("anyway");
  await expect(page.getByRole("heading", { name: "anyway" })).toBeVisible({ timeout: 5000 });
  await searchBox.fill("");
  await page.waitForTimeout(300);

  const anywayRow = (await readLogRows(page)).find((row) => row.normalised === "anyway");
  expect(anywayRow?.senses).toBe(1);
  expect(anywayRow?.translation).toBe(
    "en fin, pero bueno, pues nada, de todas formas, de todos modos, de todas maneras, a pesar de todo, aun así, comoquiera",
  );
  expect(anywayRow?.translation).not.toMatch(/[,\s]$/);
  expect(anywayRow?.translation?.length).toBeLessThanOrEqual(120);
});

test("a killed tab still commits the query it had settled on, and a fast one still groups by prefix", async ({
  page,
  context,
}) => {
  await deleteTranslator(page);
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });

  // Past the 800ms settle, short of the 5000ms forced flush: only the
  // `pagehide` path below, not a timer, can be what lands this row.
  await searchBox.fill("lemon");
  await page.waitForTimeout(2000);
  await page.close();

  const reopened = await context.newPage();
  await reopened.goto("/");
  const rowsAfterClose = await readLogRows(reopened);
  expect(rowsAfterClose.some((row) => row.normalised === "lemon")).toBe(true);

  // The regression the fix must not open: four keystrokes chained well
  // under the settle window, killed mid-chain, must still land as one row.
  const chainedBox = reopened.getByRole("textbox", { name: messages.search.label });
  for (const step of ["b", "bo", "boo", "book"]) {
    await chainedBox.fill(step);
    await reopened.waitForTimeout(150);
  }
  await reopened.close();

  const finalPage = await context.newPage();
  await finalPage.goto("/");
  const rowsAfterChain = await readLogRows(finalPage);
  expect(rowsAfterChain.filter((row) => row.normalised.startsWith("b"))).toHaveLength(1);
  expect(rowsAfterChain.find((row) => row.normalised === "book")).toBeTruthy();
});

// The killed-tab test above proves only `page.close()`: a document torn
// down by a reload, a URL navigation or a history traversal is a different
// death, one `pagehide`'s own IndexedDB write can lose even after it starts
// (docs/TRAPS.md). Each of the three gets its own test, never one shared
// one, so a regression in a single path still fails on its own.

test("a reload still commits the query it had settled on", async ({ page }) => {
  await deleteTranslator(page);
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  // Past the 800ms settle, short of the 5000ms forced flush: only the
  // reload path below, not a timer, can be what lands this row.
  await searchBox.fill("lemon");
  await page.waitForTimeout(2000);
  await page.reload();

  const rows = await readLogRows(page);
  expect(rows.some((row) => row.normalised === "lemon")).toBe(true);
});

test("a URL navigation to another route still commits the query it had settled on", async ({ page }) => {
  await deleteTranslator(page);
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("lemon");
  await page.waitForTimeout(2000);
  await page.goto("/cuenta");

  const rows = await readLogRows(page);
  expect(rows.some((row) => row.normalised === "lemon")).toBe(true);
});

test("going back in the history still commits the query it had settled on", async ({ page }) => {
  await deleteTranslator(page);
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("lemon");
  await page.waitForTimeout(2000);
  await page.goto("/cuenta");
  await page.goBack();
  // `goBack()` itself resolves once the browser commits the navigation;
  // the app's own client router still re-renders `/` a task after that,
  // which is a second, brief execution-context churn `readLogRows` below
  // must not race.
  await page.waitForURL((url) => url.pathname === "/");

  const rows = await readLogRows(page);
  expect(rows.some((row) => row.normalised === "lemon")).toBe(true);
});

test("a reload still groups four keystrokes chained under the settle window into one row", async ({ page }) => {
  await deleteTranslator(page);
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  // The regression the relay must not open: four keystrokes chained well
  // under the settle window, killed by a reload mid-chain, must still land
  // as the one row the last of them named, never four.
  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  for (const step of ["b", "bo", "boo", "book"]) {
    await searchBox.fill(step);
    await page.waitForTimeout(150);
  }
  await page.reload();

  const rows = await readLogRows(page);
  expect(rows.filter((row) => row.normalised.startsWith("b"))).toHaveLength(1);
  expect(rows.find((row) => row.normalised === "book")).toBeTruthy();
});

test("a word typed slowly enough to have crossed the retired 5s ceiling still lands as one row", async ({
  page,
}) => {
  await deleteTranslator(page);
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  // The reported reproduction, unchanged: "weight" typed one letter at a
  // time with 2200ms between keystrokes is the exact gap that used to split
  // the chain in two ("wei", then "weight") once `record.ts`'s retired
  // `MAX_PENDING_MS` fired mid-word. The chain now closes only where the
  // box empties, this screen unmounts, the tab hides or the page unloads —
  // never on a clock — so six keystrokes spanning 13s+ still owe one row.
  const word = "weight";
  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  for (let length = 1; length <= word.length; length++) {
    await searchBox.fill(word.slice(0, length));
    await page.waitForTimeout(2200);
  }
  await searchBox.fill("");
  await page.waitForTimeout(300);

  const rows = await readLogRows(page);
  expect(rows.filter((row) => row.normalised.startsWith("w"))).toHaveLength(1);
  expect(rows.find((row) => row.normalised === "weight")).toBeTruthy();
});
