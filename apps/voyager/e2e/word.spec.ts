import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";
import type { WorkerRequest, WorkerResponse } from "../lib/dictionary/worker-protocol";

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md); the mount effect must never reach it in this suite.
async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

// Exposes the one `Worker` the hook creates as `window.__dictionaryWorker`,
// so a test can drive it directly and measure the round trip RNL-01 governs
// — the message posted to the answer received — with nothing of React's own
// render or commit inside the number.
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

// `search-screen.tsx`'s own constant, not exported: how long autocomplete
// stays up after the last keystroke before it withdraws (RL-18).
const SUGGESTIONS_SETTLE_MS = 900;

type WorkerRequestShape = Extract<WorkerRequest, { kind: "lookup" }>;
// The one response kind this probe listens for; `status` carries no `id`
// and every other kind belongs to the hook's own outstanding requests.
type WorkerResponseShape = Extract<WorkerResponse, { kind: "answer" }> | { id?: number; kind: string };

// Ids well past anything `useDictionary`'s own counter reaches during one
// page life, so a reply to one of these can never be claimed by the hook's
// resolver map, and a reply to the hook's own requests can never satisfy
// this loop.
let nextProbeId = 10_000_000;

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

test("an installed dictionary answers offline, fast, and within a thumb's reach", async ({ page, context }) => {
  await deleteTranslator(page);
  await exposeDictionaryWorker(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  // The fetch settling is not the worker posting "ready": buildIndex still
  // has to run over 64,258 entries. Give it room before cutting the network.
  await page.waitForTimeout(1000);
  await context.setOffline(true);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });

  await searchBox.fill("throughout");
  await expect(page.getByRole("heading", { name: "throughout" })).toBeVisible({ timeout: 5000 });

  await searchBox.fill("left");
  await expect(page.getByText("leave", { exact: false })).toBeVisible({ timeout: 5000 });

  const durations = await measureWorkerRoundTrips(page, 200, "throughout");
  expect(durations).toHaveLength(200);
  const p95 = percentile(durations, 95);
  console.log(`RNL-01 worker round trip, 200 lookups, log empty — p95 ${p95.toFixed(3)} ms`);
  expect(p95).toBeLessThan(10);

  // RNL-03: no horizontal overflow, and every focusable control clears the
  // 32px floor on its shorter side, at the 360px viewport this project runs.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(360);

  const undersized = await page.evaluate(() => {
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]:not([tabindex="-1"])'),
    );
    return focusable
      .filter((el) => el.checkVisibility())
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { tag: el.tagName, shorter: Math.min(rect.width, rect.height) };
      })
      .filter((entry) => entry.shorter < 32);
  });
  expect(undersized).toEqual([]);
});

test("RL-18: autocomplete withdraws once typing settles, and never delays the word answer", async ({ page }) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  const suggestionsLabel = page.getByText(messages.word.suggestions);
  const heading = page.getByRole("heading", { name: "throughout" });

  await searchBox.fill("throughout");

  // RNL-05: the answer and the offer both land on the same keystroke, well
  // inside the pause the offer itself is about to wait out.
  await expect(heading).toBeVisible({ timeout: SUGGESTIONS_SETTLE_MS - 400 });
  await expect(suggestionsLabel).toBeVisible({ timeout: SUGGESTIONS_SETTLE_MS - 400 });

  // Past the pause, untouched: the offer withdraws, the answer does not.
  await page.waitForTimeout(SUGGESTIONS_SETTLE_MS + 200);
  await expect(suggestionsLabel).toHaveCount(0);
  await expect(heading).toBeVisible();

  // A fresh keystroke brings the offer straight back.
  await searchBox.fill("throughou");
  await expect(suggestionsLabel).toBeVisible();
});
