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

// The one wait every other spec on this route stubs away: the real route,
// not `page.route`. `dog` is cached `found` (a row and a bucket object
// already sit in `reading.word_photos`), so this never reaches Openverse
// and writes nothing new — the six specs that mock `/api/word/photo` never
// prove that a `found` row actually draws pixels, only that their own
// stub's shape does.
async function searchAndSettle(page: Page, word: string): Promise<void> {
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  // `buildIndex` still has to run over 64,258 entries after the fetch
  // settles (word.spec.ts's own margin).
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill(word);
  await expect(page.getByRole("heading", { name: word, exact: true })).toBeVisible({ timeout: 5000 });
}

test("a concrete noun's cached photo draws real pixels, not just an <img> tag", async ({ page }) => {
  await deleteTranslator(page);

  const photoRequest = page.waitForResponse(
    (response) => response.url().includes("/api/word/photo") && response.request().method() === "POST",
  );
  await searchAndSettle(page, "dog");

  // The POST resolves 200 from cache — no Openverse call, no new row.
  const response = await photoRequest;
  expect(response.status()).toBe(200);

  const alt = messages.word.photoAlt.replace("{headword}", "dog");
  const img = page.getByRole("img", { name: alt });
  await expect(img).toBeVisible();

  // Present in the DOM is not drawn: `next/image`'s `<img>` exists the
  // instant React commits it, before the browser has fetched a single byte
  // from the GET route below. `naturalWidth` only turns nonzero once the
  // decoded image actually has pixels — the exact gap this route's defect
  // lived in for three modules.
  await page.waitForFunction(
    (selector) => {
      const el = document.querySelector<HTMLImageElement>(selector);
      return el !== null && el.complete && el.naturalWidth > 0;
    },
    `img[alt="${alt}"]`,
    { timeout: 5000 },
  );

  const measured = await img.evaluate((el: HTMLImageElement) => ({
    naturalWidth: el.naturalWidth,
    complete: el.complete,
  }));
  console.log(`dog's photo: naturalWidth ${measured.naturalWidth}px, complete ${measured.complete}`);
  expect(measured.complete).toBe(true);
  expect(measured.naturalWidth).toBeGreaterThan(0);
});

test("an abstract noun's photo request answers 204, and no <img> draws — not even an empty one", async ({
  page,
}) => {
  await deleteTranslator(page);

  const photoRequest = page.waitForResponse((response) => response.url().includes("/api/word/photo"));
  // `grudge` fails `isPhotographableHeadword` — abstract, never scored
  // concrete — so the route's own guard (route.ts:90) answers before it
  // opens a connection to Postgres or Openverse: no row, no object.
  await searchAndSettle(page, "grudge");

  const response = await photoRequest;
  expect(response.status()).toBe(204);

  // `WordPhoto` returns `null` on `{ kind: "absent" }` — no square, no
  // placeholder frame, nothing `next/image` ever mounts.
  await expect(page.locator("img")).toHaveCount(0);
});
