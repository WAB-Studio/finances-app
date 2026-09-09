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

// The pause these tests hold past a keystroke before checking the offer:
// long enough that the old, retired withdrawal timer would have fired.
// RL-18 no longer withdraws on any timer — the list stays until the text
// itself changes — so this constant is the tests' own clock, not the
// component's.
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
  await expect(page.getByRole("heading", { name: "leave" })).toBeVisible({ timeout: 5000 });

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

test("RL-18: a paused prefix keeps its offer, coexisting with the word answer", async ({ page }) => {
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

  // RNL-05: the answer and the offer both land on the same keystroke.
  await expect(heading).toBeVisible({ timeout: SUGGESTIONS_SETTLE_MS - 400 });
  await expect(suggestionsLabel).toBeVisible({ timeout: SUGGESTIONS_SETTLE_MS - 400 });

  // Decided by the user 2026-09-09: the offer stays put past the pause,
  // the price of also being a real word, taken knowingly.
  await page.waitForTimeout(SUGGESTIONS_SETTLE_MS + 200);
  await expect(suggestionsLabel).toBeVisible();
  await expect(heading).toBeVisible();

  // A fresh keystroke still updates the offer straight away.
  await searchBox.fill("throughou");
  await expect(suggestionsLabel).toBeVisible();
});

test("a mid-word prefix stays silent past the settle, and a real miss still says so", async ({ page }) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  const notFound = page.getByText(messages.search.notFound);

  // "ru" is not a headword on its own, but it prefixes real ones ("run",
  // "rub"...): the offer stays up past the settle, and the miss text stays
  // out regardless — the suppression reads the suggestion data, not
  // whether the list is still on screen.
  await searchBox.fill("ru");
  await page.waitForTimeout(SUGGESTIONS_SETTLE_MS + 200);
  await expect(page.getByText(messages.word.suggestions)).toBeVisible();
  await expect(notFound).toHaveCount(0);

  // A string past every real headword — no suppression left to hide behind.
  await searchBox.fill("zzqx");
  await page.waitForTimeout(SUGGESTIONS_SETTLE_MS + 200);
  await expect(notFound).toBeVisible();

  // Finishing the word answers as always, past any suppression.
  await searchBox.fill("run");
  await expect(page.getByRole("heading", { name: "run" })).toBeVisible({ timeout: 5000 });
  await expect(notFound).toHaveCount(0);
});

test("RNL-03: an 85-character headword with no space to break on never scrolls the page sideways", async ({
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
  // The dictionary's own longest headword, no space anywhere in it, paired
  // with the longest IPA it carries — the exact case that broke the page.
  const headword = "Taumatawhakatangihangakoauauotamateaturipukakapikimaungahoronukupokaiwhenuakitanatahu";
  await searchBox.fill(headword);
  await expect(page.getByRole("heading", { name: headword })).toBeVisible({ timeout: 5000 });

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBe(clientWidth);
});

test("a paused prefix never leaves the page blank", async ({ page }) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });

  // "ru" answers nothing on its own — the old withdrawal timer left this
  // exact pause with nothing at all on screen.
  await searchBox.fill("ru");
  await page.waitForTimeout(1500);
  const textLength = await page.evaluate(() => document.querySelector("main")?.innerText.length ?? 0);
  expect(textLength).toBeGreaterThan(0);
});
