import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md); the mount effect must never reach it in this suite.
async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

// `search-screen.tsx`'s own constant, not exported: the debounce a sentence
// waits out before it is worth asking about (RNL-05, rule 1). The no-entry
// path below the floor and above the ceiling never waits on this at all.
const PHRASE_DEBOUNCE_MS = 600;

async function openReady(page: Page): Promise<void> {
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  // The fetch settling is not the worker posting "ready": buildIndex still
  // has to run over 64,258 entries. Give it room before the first keystroke.
  await page.waitForTimeout(1000);
}

// `BottomNav` carries a heading of its own (`bottom-nav.tsx:148`), outside
// `<main>`, on every screen — scoping to `main` is what keeps that title out
// of a count this spec means for the answer alone.
function mainHeadings(page: Page) {
  return page.locator("main").getByRole("heading");
}

// A lazily-loaded font past the fold is a rendering detail, not a lookup —
// `url.spec.ts:132` excludes it for the same reason, offline or not: it is
// served from the browser's own cache and still raises a `request` event.
function strayRequests(urls: string[]): string[] {
  return urls.filter((url) => !url.includes("/_next/static/"));
}

test("a two-token miss draws both headwords, offline, with no request", async ({ page, context }) => {
  await deleteTranslator(page);
  await openReady(page);

  // RL-16/RNL-01: the answer to a word never touches the network — cutting
  // it here proves the claim rather than assuming it.
  await context.setOffline(true);

  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("hello world");

  await expect(mainHeadings(page).filter({ hasText: "hello" })).toBeVisible();
  await expect(mainHeadings(page).filter({ hasText: "world" })).toBeVisible();
  await expect(mainHeadings(page)).toHaveCount(2);

  const expectedTitle = messages.search.noEntry.title.replace("{query}", "hello world");
  await expect(page.getByText(expectedTitle)).toBeVisible();

  await page.waitForTimeout(PHRASE_DEBOUNCE_MS + 300);
  const stray = strayRequests(requestUrls);
  console.log(`requests while offline and typing "hello world", static assets excluded: ${stray.length}`);
  expect(stray).toEqual([]);
});

// "zzqx" is absent from `eng-spa-2025.11.23.json` as a headword, and no
// inflection rule in `lib/dictionary/inflect.ts` strips a suffix off it —
// there is nothing left for `lookupWord` to find under any of its rules.
test("a two-token miss where the dictionary lacks one word draws that word's own miss, and the other's answer", async ({
  page,
}) => {
  await deleteTranslator(page);
  await openReady(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("hello zzqx");

  await expect(mainHeadings(page).filter({ hasText: "hello" })).toBeVisible();
  await expect(mainHeadings(page)).toHaveCount(1);
  await expect(page.getByText(messages.search.noEntry.wordMiss)).toBeVisible();
});

test("a 61-token string draws one line and no heading, and asks the dictionary nothing", async ({ page }) => {
  await deleteTranslator(page);
  await openReady(page);

  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));

  const tooLongText = Array.from({ length: 61 }, (_, index) => `palabra${index}`).join(" ");
  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill(tooLongText);

  const expectedTooLong = messages.search.noEntry.tooLong.replace("{count}", "61");
  await expect(page.getByText(expectedTooLong)).toBeVisible();
  await expect(mainHeadings(page)).toHaveCount(0);

  await page.waitForTimeout(PHRASE_DEBOUNCE_MS + 300);
  const stray = strayRequests(requestUrls);
  console.log(`requests past the ceiling, static assets excluded: ${stray.length}`);
  expect(stray).toEqual([]);
});

test("the cat sits still debounces to exactly one translate request, 600ms after the last keystroke", async ({
  page,
}) => {
  await deleteTranslator(page);
  let translateCount = 0;
  await page.route("**/api/translate", async (route) => {
    translateCount++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: "El gato se sienta", origin: "network" }),
    });
  });
  await openReady(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("the cat sits");

  await page.waitForTimeout(PHRASE_DEBOUNCE_MS - 100);
  expect(translateCount, "nothing is asked before the debounce settles").toBe(0);

  await page.waitForTimeout(300);
  expect(translateCount, "exactly one request once it does").toBe(1);
  await expect(page.getByText("El gato se sienta")).toBeVisible();
});

// `/fuente` itself is gone (module 10 was its last tenant), so this no
// longer guards a live route. It still guards the search screen's own
// markup: `SourceNote` or anything like it must never remount here, whether
// or not a route by that name exists to receive the click.
test("the search screen carries no link to /fuente", async ({ page }) => {
  await deleteTranslator(page);
  await openReady(page);

  await expect(page.locator('a[href="/fuente"]')).toHaveCount(0);
});

// RL-37. Nine distinct headwords plus "zzqx", which the dictionary lacks —
// no word repeats, so `mainHeadings` never double-counts one that folds into
// the "more" line and one that's shown at the same time. The route is
// intercepted rather than left to MyMemory's own quota, mirroring exactly
// what `app/api/translate/route.ts` answers once `translateWithProvider`
// throws: a 502 with no `translatedText` a client ever reads.
test("a phrase whose translation fails falls to the per-word breakdown, capped at eight blocks with the rest in one line", async ({
  page,
}) => {
  await deleteTranslator(page);
  let translateCount = 0;
  await page.route("**/api/translate", async (route) => {
    translateCount++;
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "provider" }) });
  });
  await openReady(page);

  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));

  const phraseText = "dog cat zzqx bird fish mouse horse cow pig";
  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill(phraseText);

  // The debounce, the failed request, and the on-device breakdown all have
  // to land before any of this is worth reading.
  await page.waitForTimeout(PHRASE_DEBOUNCE_MS + 300);
  expect(translateCount, "the translation is attempted once, and fails").toBe(1);

  const expectedTitle = messages.search.noEntry.titleTranslationFailed.replace("{query}", phraseText);
  await expect(page.getByText(expectedTitle)).toBeVisible();

  // The first eight tokens each draw a block; "zzqx" is the third and draws
  // the dictionary's own miss line instead of a heading.
  for (const shown of ["dog", "cat", "bird", "fish", "mouse", "horse", "cow"]) {
    await expect(mainHeadings(page).filter({ hasText: shown })).toBeVisible();
  }
  await expect(page.getByText(messages.search.noEntry.wordMiss)).toBeVisible();

  // "pig" is the ninth token: past `MAX_BLOCKS`, it never gets its own
  // block — only the "N more" line below names it indirectly, by count.
  await expect(mainHeadings(page).filter({ hasText: "pig" })).toHaveCount(0);
  await expect(mainHeadings(page)).toHaveCount(7);
  await expect(page.getByText("…y 1 palabra más que no cabe aquí.")).toBeVisible();

  // RL-37: the breakdown itself answers from the device — the one request
  // this test allows is the translation attempt that failed, not a second
  // one per word.
  const stray = strayRequests(requestUrls).filter((url) => !url.includes("/api/translate"));
  console.log(`requests past the failed translate call, static assets and the call itself excluded: ${stray.length}`);
  expect(stray).toEqual([]);
});

// The two-token path this replaces nothing of: below `PHRASE_MIN_TOKENS`,
// `schedulePhrase` still routes straight to `scheduleNoEntry` and never
// reaches `translatePhrase`, so a failing `/api/translate` stub is never
// even called here — proof this string still draws exactly what it drew
// before RL-37 touched the phrase-in-range path.
test("a two-token string still never reaches the translator, and still draws the no-entry title", async ({
  page,
}) => {
  await deleteTranslator(page);
  let translateCount = 0;
  await page.route("**/api/translate", async (route) => {
    translateCount++;
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "provider" }) });
  });
  await openReady(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("dog cat");

  await expect(mainHeadings(page).filter({ hasText: "dog" })).toBeVisible();
  await expect(mainHeadings(page).filter({ hasText: "cat" })).toBeVisible();
  const expectedTitle = messages.search.noEntry.title.replace("{query}", "dog cat");
  await expect(page.getByText(expectedTitle)).toBeVisible();
  await expect(page.getByText(messages.search.noEntry.titleTranslationFailed.replace("{query}", "dog cat"))).toHaveCount(0);

  await page.waitForTimeout(PHRASE_DEBOUNCE_MS + 300);
  expect(translateCount, "a two-token string never reaches the translate route").toBe(0);
});
