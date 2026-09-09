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
// RL-18 withdraws on the answer, never on a timer, so this constant is the
// tests' own clock — long enough to prove no timer fires — not the
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

  // `left` is its own headword, so it is answered as itself and never as a
  // guess at `leave`: a hit ends the guessing (`lookup.ts`).
  await searchBox.fill("left");
  await expect(page.getByRole("heading", { name: "left" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("heading", { name: "leave" })).toHaveCount(0);

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

test("RL-18: the offer retires the moment an answer stands under it", async ({ page }) => {
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

  // RNL-05: the answer lands on the keystroke, and it is the answer — not a
  // timer — that takes the offer away.
  await expect(heading).toBeVisible({ timeout: SUGGESTIONS_SETTLE_MS - 400 });
  await expect(suggestionsLabel).toHaveCount(0);

  await page.waitForTimeout(SUGGESTIONS_SETTLE_MS + 200);
  await expect(suggestionsLabel).toHaveCount(0);
  await expect(heading).toBeVisible();

  // Cut back to a prefix that answers nothing and the offer returns, and
  // stays — this is the pause that used to leave the page blank.
  await searchBox.fill("throughou");
  await expect(suggestionsLabel).toBeVisible();
  await page.waitForTimeout(SUGGESTIONS_SETTLE_MS + 200);
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

// Counts a `<button>` whose text names the fold, bounded by document order
// to two headings — never the whole page — so a second headword's own
// senses (an inflected form's `viaInflection` group) never inflate the
// count of the one being measured.
async function countFoldsBetween(
  page: Page,
  afterHeading: string,
  beforeHeading: string | null,
  label: string,
): Promise<number> {
  return page.evaluate(
    ({ afterHeading, beforeHeading, label }) => {
      const headings = Array.from(document.querySelectorAll("h1"));
      const after = headings.find((h) => h.textContent === afterHeading);
      const before = beforeHeading ? headings.find((h) => h.textContent === beforeHeading) : undefined;
      if (!after) return -1;
      return Array.from(document.querySelectorAll("button"))
        .filter((b) => b.textContent?.includes(label))
        .filter((b) => Boolean(after.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING))
        .filter((b) => !before || Boolean(b.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING))
        .length;
    },
    { afterHeading, beforeHeading, label },
  );
}

test("a headword with no definition at all shows no fold control and no dangling line", async ({ page }) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  // "umbrella": one sense, no definition in the source, and no inflection
  // candidate the dictionary carries — nothing on the page but its own
  // headword and translations.
  await searchBox.fill("umbrella");
  await expect(page.getByRole("heading", { name: "umbrella", exact: true })).toBeVisible({ timeout: 5000 });

  await expect(page.getByText(messages.word.definitionEnglish)).toHaveCount(0);
  await expect(page.getByRole("button", { name: messages.word.definitionEnglish })).toHaveCount(0);
});

test("`left` (one of the 34 entries whose definition is a bare '.') never folds onto that period", async ({
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
  await searchBox.fill("left");
  await expect(page.getByRole("heading", { name: "left", exact: true })).toBeVisible({ timeout: 5000 });
  // A hit ends the guessing, so `leave` is no longer drawn under it and
  // `left`'s own group runs to the end of the page.
  await expect(page.getByRole("heading", { name: "leave", exact: true })).toHaveCount(0);

  // Four senses of "left" carry a definition in the source: adj (null,
  // never had one), adv ("On the left side."), n ("The left side or
  // direction.") and v ("."). Only the two real ones fold; the bare period
  // is filtered to no definition, same as adj's null.
  const folds = await countFoldsBetween(page, "left", null, messages.word.definitionEnglish);
  expect(folds).toBe(2);
});

test("the English definition opens on tap and folds back on the next one, reachable by keyboard", async ({
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
  await searchBox.fill("her");
  await expect(page.getByRole("heading", { name: "her", exact: true })).toBeVisible({ timeout: 5000 });

  const englishText = "The form of she used after a preposition, as the object of a verb";
  const fold = page.getByRole("button", { name: messages.word.definitionEnglish }).first();

  // Closed on open: the control names itself, the English prose does not
  // show, and it says its own state to the accessibility tree.
  await expect(fold).toBeVisible();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText(englishText)).toHaveCount(0);

  // 360px, closed: nothing spills sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  // A tap opens it — the keyboard reaches the same control, no `div` with
  // an `onClick` would answer `Tab` or `Enter`.
  await fold.focus();
  await fold.press("Enter");
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(englishText)).toBeVisible();

  // 360px, open: the unfolded prose still fits inside the column.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  // A second tap folds it back away.
  await fold.press("Enter");
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText(englishText)).toHaveCount(0);
});

// `bed` is a headword the dictionary carries. It also matched two inflection
// candidates — "a form of `b`" and "a form of `be`", the first translating to
// "n." — and both were drawn under the real answer. A hit is answered, never
// guessed at.
test("a word the dictionary carries is never also split into inflection guesses", async ({ page }) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });

  await searchBox.fill("bed");
  await expect(page.getByRole("heading", { name: "bed" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('es una forma de', { exact: false })).toHaveCount(0);

  // A miss still earns its guess: `zzqxbeds` is nothing, and the machinery
  // that finds a lemma is untouched for the case it exists to serve.
  await searchBox.fill("running");
  await expect(page.getByRole("heading", { name: "run" })).toBeVisible({ timeout: 5000 });
});
