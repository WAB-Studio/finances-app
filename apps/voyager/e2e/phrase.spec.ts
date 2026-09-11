import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";

// `search-screen.tsx`'s own constant, not exported: the debounce a sentence
// waits out before it is worth asking about (RNL-05, rule 1).
const PHRASE_DEBOUNCE_MS = 600;

async function waitForDictionary(page: Page): Promise<void> {
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  // The debounce assertions below read a clock; a `has()` call still queued
  // behind index-building would stretch a keystroke's own timing, not the
  // sentence path's. Settle the dictionary first.
  await page.waitForTimeout(1000);
}

async function stubTranslateRoute(page: Page, text: string): Promise<{ count: () => number }> {
  let count = 0;
  await page.route("**/api/translate", async (route) => {
    count++;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text, origin: "network" }) });
  });
  return { count: () => count };
}

// One answer per source sentence, each held for its own artificial delay:
// this is what lets two translate requests genuinely overlap in time, which
// `stubTranslateRoute`'s zero-latency fulfil never gives a chance to happen.
async function stubTranslateRouteWithLatency(
  page: Page,
  answers: Record<string, { text: string; delayMs: number }>,
): Promise<{ count: () => number }> {
  let count = 0;
  await page.route("**/api/translate", async (route) => {
    count++;
    const { text: source } = route.request().postDataJSON() as { text: string };
    const answer = answers[source];
    if (answer.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, answer.delayMs));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: answer.text, origin: "network" }) });
  });
  return { count: () => count };
}

test("the sentence path debounces, dedupes, and never raises the word UI", async ({ page }) => {
  // Chromium's built-in `Translator` hangs `availability()` forever
  // (docs/TRAPS.md); deleting it routes every sentence over the network,
  // which is the path this test drives.
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
  const translated = await stubTranslateRoute(page, "Me fui de mi casa ayer");
  await waitForDictionary(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  const phraseText = "I left my house yesterday";

  // One `fill` fires one change, the sentence's last keystroke and its only
  // one — the same shape a person's own pause leaves once typing settles.
  await searchBox.fill(phraseText);

  // RL-07: autocomplete never raises on a sentence.
  await expect(page.getByText(messages.word.suggestions)).toHaveCount(0);

  await page.waitForTimeout(PHRASE_DEBOUNCE_MS - 100);
  expect(translated.count(), "nothing is asked before the debounce settles").toBe(0);

  await page.waitForTimeout(300);
  expect(translated.count(), "exactly one request once it does").toBe(1);

  await expect(page.getByText(messages.phrase.originNetwork)).toBeVisible();

  const originLabel = page.getByText(messages.phrase.originNetwork);
  const style = await originLabel.evaluate((el) => {
    const computed = getComputedStyle(el);
    return {
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      letterSpacing: computed.letterSpacing,
      textTransform: computed.textTransform,
    };
  });
  expect(style.fontSize).toBe("11px");
  expect(style.fontWeight).toBe("600");
  expect(style.textTransform).toBe("uppercase");
  // 0.12em of an 11px label resolves to 1.32px; a browser rounds it to the
  // nearest subpixel it renders.
  expect(Math.abs(Number.parseFloat(style.letterSpacing) - 1.32)).toBeLessThan(0.05);

  // RNL-05, rule 3: the same text, revisited, costs nothing further.
  await searchBox.fill("");
  await searchBox.fill(phraseText);
  await page.waitForTimeout(PHRASE_DEBOUNCE_MS + 300);
  expect(translated.count(), "a cached phrase never reaches the debounce, let alone the network").toBe(1);

  // Two tokens no longer sits below the floor (module 30): "I left" reaches
  // the translator exactly like the full sentence above, one request of
  // its own — it is a distinct phrase, so RNL-05's cache owes it nothing.
  await searchBox.fill("");
  await searchBox.fill("I left");
  await page.waitForTimeout(PHRASE_DEBOUNCE_MS + 300);
  expect(translated.count(), "a fresh two-token phrase reaches the translator on its own").toBe(2);
  await expect(page.getByText("Me fui de mi casa ayer")).toBeVisible();

  // "give up" is a headword in its own right (RL-03): answered as a word,
  // and the whole-string lookup means the sentence path is never asked.
  await searchBox.fill("");
  await searchBox.fill("give up");
  await expect(page.getByRole("heading", { name: "give up" })).toBeVisible();
  await expect(page.getByText(messages.word.translations).first()).toBeVisible();
  expect(translated.count(), "the word path never reaches the translate route (RL-09)").toBe(2);
});

test("a translator that can be installed answers over the network until a person asks for it", async ({ page }) => {
  await page.addInitScript(() => {
    let createCalls = 0;
    (window as unknown as { __translatorCreateCalls?: () => number }).__translatorCreateCalls = () => createCalls;
    (window as unknown as { Translator?: unknown }).Translator = {
      availability: async () => "downloadable",
      create: async () => {
        createCalls++;
        return { translate: async (text: string) => `[traducido] ${text}` };
      },
    };
  });
  const translated = await stubTranslateRoute(page, "Traducción por red");
  await waitForDictionary(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("I left my house yesterday");
  await expect(page.getByText(messages.phrase.originNetwork)).toBeVisible({ timeout: 5000 });
  expect(translated.count(), "downloadable, not available, so the first sentence still goes over the network (RL-11)").toBe(1);

  const enableButton = page.getByRole("button", { name: messages.phrase.enableDevice });
  await expect(enableButton).toHaveCount(1);

  const createCallsBeforeClick = await page.evaluate(
    () => (window as unknown as { __translatorCreateCalls: () => number }).__translatorCreateCalls(),
  );
  expect(createCallsBeforeClick, "no gesture yet, so no download was ever started").toBe(0);

  await enableButton.click();
  await expect(page.getByRole("button", { name: messages.phrase.enableDevice })).toHaveCount(0);
  const createCallsAfterClick = await page.evaluate(
    () => (window as unknown as { __translatorCreateCalls: () => number }).__translatorCreateCalls(),
  );
  expect(createCallsAfterClick, "the control is what starts the download (RL-11)").toBe(1);
});

test("a stale phrase response never lands once the query has moved on (RNL-05, rule 4)", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });

  const staleText = "I left my house yesterday";
  const staleAnswer = "Me fui de mi casa ayer";
  const freshText = "We drove to the coast together";
  const freshAnswer = "Condujimos juntos hasta la costa";

  // The abandoned sentence answers long after the one that supersedes it —
  // long enough that, unaborted, it would still arrive and overwrite the
  // fresh answer already on screen.
  const translated = await stubTranslateRouteWithLatency(page, {
    [staleText]: { text: staleAnswer, delayMs: 1400 },
    [freshText]: { text: freshAnswer, delayMs: 0 },
  });
  await waitForDictionary(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });

  await searchBox.fill(staleText);
  // Past the debounce: the slow request is genuinely in flight now, not
  // merely scheduled.
  await page.waitForTimeout(PHRASE_DEBOUNCE_MS + 200);
  expect(translated.count(), "the slow request already left").toBe(1);
  await expect(page.getByText(staleAnswer)).toHaveCount(0);

  // A new sentence, typed while the first is still in flight, is what
  // rule 4 exists to answer for.
  await searchBox.fill(freshText);
  await page.waitForTimeout(PHRASE_DEBOUNCE_MS + 300);
  expect(translated.count(), "the fresh query issues its own request").toBe(2);
  await expect(page.getByText(freshAnswer)).toBeVisible();
  await expect(page.getByText(staleAnswer)).toHaveCount(0);

  // The slow response is still on its way; give it time to land and prove
  // it never displaces what is already shown.
  await page.waitForTimeout(700);
  await expect(page.getByText(staleAnswer)).toHaveCount(0);
  await expect(page.getByText(freshAnswer)).toBeVisible();
});
