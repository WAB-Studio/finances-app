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
async function readLogRows(page: Page): Promise<Array<{ normalised: string; outcome: string; dictionaryReady: boolean }>> {
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

test("every lookup is recorded, a fat log costs nothing, and a lost log costs nothing either", async ({
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

  // A word the dictionary carries nothing for.
  await searchBox.fill("zzqxplorph");
  await searchBox.fill("");
  await page.waitForTimeout(300);

  const afterMiss = await readLogRows(page);
  const missRow = afterMiss.find((row) => row.normalised === "zzqxplorph");
  expect(missRow?.outcome).toBe("miss");

  // A query typed while the install is still running: a second page shares
  // the same origin's storage, so its row lands beside the first two.
  const installingPage = await context.newPage();
  await deleteTranslator(installingPage);
  await installingPage.route(`**${manifest.asset.path}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
  await installingPage.goto("/");
  const installingBox = installingPage.getByRole("textbox", { name: messages.search.label });
  await installingBox.fill("midinstall");
  // The keystroke's own `dictionaryReady` flag is read synchronously, at
  // type time — long before this settles, however long the install takes.
  // Waiting for the (not-found) answer to render proves the worker actually
  // reached this query, queued behind the delayed install, before the box
  // is cleared to force the row's flush.
  await expect(installingPage.getByText(messages.search.notFound)).toBeVisible({ timeout: 8000 });
  await installingBox.fill("");
  await installingPage.waitForTimeout(300);
  await installingPage.close();

  const afterInstalling = await readLogRows(page);
  const installingRow = afterInstalling.find((row) => row.normalised === "midinstall");
  expect(installingRow?.dictionaryReady).toBe(false);

  // The guard that matters: 10,000 rows already in the log, and the worker's
  // own round trip is unmoved — it never reads this database at all.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("reading-log");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("lookups", "readwrite");
          const store = tx.objectStore("lookups");
          for (let i = 0; i < 10_000; i++) {
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
  );

  const seededCount = (await readLogRows(page)).length;
  expect(seededCount).toBe(10_003);

  const durations = await measureWorkerRoundTrips(page, 200, "throughout");
  const p95 = percentile(durations, 95);
  console.log(`RNL-01 worker round trip, 200 lookups, log at 10,003 rows — p95 ${p95.toFixed(3)} ms`);
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
