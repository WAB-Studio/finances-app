import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";
import { PHRASE_DEBOUNCE_MS } from "../lib/query/settle";

// CI's `voyager-e2e` job (`.github/workflows/ci.yml`) sets none of the five
// `SUPABASE_STORAGE_*` variables `isStorageConfigured` checks — deliberately,
// per `docs/TRAPS.md`: handing that key to every CI run would let any push
// write to the user's own production bucket. Without it the GET route below
// can never serve a bucket object, in CI or in a lane started with the same
// override, so a test that needs real pixels from the real route can never
// go green there. Case 3 supplies its own bytes instead of the bucket's.
const baseURL = process.env.VOYAGER_BASE_URL ?? "http://localhost:3100";

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md); the mount effect must never reach it in this suite.
async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

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

// A real, decodable PNG, drawn by the browser itself rather than typed in as
// a data URI: a copied literal that fails to decode would leave case 3 green
// while drawing nothing, which is the exact defect this file exists to
// catch. 32x17 on purpose — no real Openverse thumbnail lands on that pair,
// so a later assertion against it can only pass on these seeded bytes.
const SEED_WIDTH = 32;
const SEED_HEIGHT = 17;

async function drawSeedPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#3366ff";
      ctx.fillRect(0, 0, width, height);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { width: SEED_WIDTH, height: SEED_HEIGHT },
  );
  return Buffer.from(base64, "base64");
}

// Decodes the seeded bytes through a throwaway `<img>`, never the one the
// test later asserts on — proof the bytes are a real image before they are
// wired into the route, not proof the route drew whatever it was handed.
async function assertPngDecodes(page: Page, bytes: Buffer): Promise<void> {
  const measured = await page.evaluate(async (base64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    return { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
  }, bytes.toString("base64"));
  expect(measured.naturalWidth).toBe(SEED_WIDTH);
  expect(measured.naturalHeight).toBe(SEED_HEIGHT);
}

test("an abstract noun's photo request answers 204, and no <img> draws — not even an empty one", async ({
  page,
  allowRealWordRoute,
}) => {
  await deleteTranslator(page);
  // This test's whole claim is about the real route's own guard (route.ts:90),
  // not a stand-in for it — `./fixtures`'s default would give the same 204
  // for a different reason and prove nothing.
  await allowRealWordRoute("photo", "asserts the real guard rejects an abstract noun before Postgres or Openverse");

  const photoRequest = page.waitForResponse((response) => response.url().includes("/api/word/photo"));
  // `grudge` fails `isPhotographableHeadword` — abstract, never scored
  // concrete — so the route's own guard (route.ts:90) answers before it
  // opens a connection to Postgres or Openverse: no row, no object. Needs
  // no storage and no cache, so this is the one case CI runs unmodified.
  await searchAndSettle(page, "grudge");

  const response = await photoRequest;
  expect(response.status()).toBe(204);

  // `WordPhoto` returns `null` on `{ kind: "absent" }` — no square, no
  // placeholder frame, nothing `next/image` ever mounts.
  await expect(page.locator("img")).toHaveCount(0);
});

test("a concrete noun's photo request passes the guard, against the real route", async ({
  page,
  allowRealWordRoute,
}) => {
  await deleteTranslator(page);
  // Same reason as the abstract-noun case above: the claim is about the
  // real guard letting a concrete noun through, which a stub cannot stand
  // in for.
  await allowRealWordRoute("photo", "asserts the real guard passes a concrete, cached noun through to a 200");

  const photoRequest = page.waitForResponse(
    (response) => response.url().includes("/api/word/photo") && response.request().method() === "POST",
  );
  // Real route, real Postgres, no interception: `dog` is a photographable
  // headword with a `found` row already sitting in the shared database (both
  // lanes and CI point `DATABASE_URL` at the same one), so the POST answers
  // from cache without reaching Openverse or the bucket either way.
  //
  // What this proves: the guard let `dog` through — a headword `grudge`'s
  // shape never reaches. What this does NOT prove: that the bytes behind the
  // URL are real pixels, since serving them needs the bucket and CI has no
  // bucket credentials (see the file comment above). Case 3 covers that
  // seam instead, without touching the bucket at all.
  //
  // This distinction only holds while `dog`'s row stays cached: an uncached
  // headword with no storage configured also answers 204 (route.ts's own
  // `isStorageConfigured` check, ahead of Openverse), the same status a
  // guard rejection gives. Purge `dog` from `reading.word_photos` and this
  // assertion can no longer tell "the guard passed" from "the bucket is
  // missing" — it would need a storage-backed run to mean anything again.
  await searchAndSettle(page, "dog");

  const response = await photoRequest;
  expect(response.status()).not.toBe(204);
});

test("a concrete noun's cached photo draws real pixels, seeded rather than fetched from the bucket", async ({
  page,
  allowRealWordRoute,
}) => {
  await deleteTranslator(page);
  // The POST must reach the real route (see the page.route comment below,
  // on the GET) so the URL it hands back, `next/image` and this component
  // wire together for real; only the bucket's own bytes are substituted.
  await allowRealWordRoute("photo", "keeps the POST real so the wiring around it is real; only the GET is seeded");

  const seed = await drawSeedPng(page);
  await assertPngDecodes(page, seed);

  // Scoped to this test's own origin, not `**/api/word/photo?*`: a pattern
  // that matched any host would still catch route.ts's old, broken absolute
  // URL and paper over the exact regression this test exists to reproduce
  // (see the negative control in the report). The POST is left real, so the
  // relative URL, `next/image` and this component wire together for real —
  // only the bucket's bytes are substituted.
  await page.route(`${baseURL}/api/word/photo?*`, (route) => {
    void route.fulfill({ status: 200, contentType: "image/png", body: seed });
  });

  const photoRequest = page.waitForResponse(
    (response) => response.url().includes("/api/word/photo") && response.request().method() === "POST",
  );
  await searchAndSettle(page, "dog");
  expect((await photoRequest).status()).toBe(200);

  const alt = messages.word.photoAlt.replace("{headword}", "dog");
  const img = page.getByRole("img", { name: alt });
  await expect(img).toBeVisible();

  // Present in the DOM is not drawn: `next/image`'s `<img>` exists the
  // instant React commits it, before the browser has fetched a single byte
  // from the GET route below. `naturalWidth` only turns nonzero once the
  // decoded image actually has pixels — the exact gap this route's defect
  // lived in for three modules. The exact seeded dimensions, not just
  // `> 0`, rule out a coincidental real photo slipping past the route.
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
    naturalHeight: el.naturalHeight,
    complete: el.complete,
  }));
  console.log(`dog's seeded photo: ${measured.naturalWidth}x${measured.naturalHeight}px, complete ${measured.complete}`);
  expect(measured.complete).toBe(true);
  expect(measured.naturalWidth).toBe(SEED_WIDTH);
  expect(measured.naturalHeight).toBe(SEED_HEIGHT);
});

// `use-decoration.ts`'s own defect: `fetchPhoto` and `fetchText` used to
// settle behind one `Promise.all`, so the text sat on Postgres, already
// answerable, while a slow photo held it off the screen. Long enough that
// the generated block would have appeared well inside it were it still
// waiting on nothing slower — short enough that the deliberately slow photo
// route below has not fulfilled yet when it is checked.
const SLOW_PHOTO_DELAY_MS = 3000;

const GENERATED_TEXT = {
  definition: "Un mamífero doméstico, fabricado por esta prueba.",
  example: { en: "The dog runs in the park.", es: "El perro corre en el parque." },
};

test("the generated text draws while a slow photo is still pending, waiting on neither", async ({
  page,
  allowRealWordRoute,
  stubWordText,
}) => {
  await deleteTranslator(page);
  await stubWordText(GENERATED_TEXT);
  // The delayed 204 below is this spec's own, never the real route — opting
  // in only silences the watchdog for a response it cannot tag itself.
  await allowRealWordRoute("photo", "the delayed 204 is fulfilled by this spec's own route below, never real Openverse");

  await page.route(`${baseURL}/api/word/photo`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, SLOW_PHOTO_DELAY_MS));
    await route.fulfill({ status: 204 });
  });
  const photoRequest = page.waitForResponse((response) => response.url().includes("/api/word/photo"));

  await searchAndSettle(page, "dog");

  // The photo's own 3s delay has not elapsed: the text arriving here is
  // proof it never waited for the photo, not a race won by chance.
  await expect(page.getByText(messages.word.definitionGenerated)).toBeVisible({
    timeout: SLOW_PHOTO_DELAY_MS - 500,
  });
  await expect(page.getByText(GENERATED_TEXT.example.en)).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);

  expect((await photoRequest).status()).toBe(204);
});

const DOG_TEXT = {
  definition: "Definición de dog: nunca debe aparecer bajo cat.",
  example: { en: "The dog barks loudly.", es: "El perro ladra fuerte." },
};
const CAT_TEXT = {
  definition: "Definición de cat.",
  example: { en: "The cat sleeps all day.", es: "El gato duerme todo el día." },
};

test("a headword replaced mid-flight never lands its decoration on the word that replaced it", async ({
  page,
  allowRealWordRoute,
}) => {
  await deleteTranslator(page);
  // Headword-specific bodies and delays, wired by this test alone — the
  // default stub answers the same body for every headword, which cannot
  // tell "dog's answer" from "cat's answer" apart.
  await allowRealWordRoute("text", "this spec answers per headword itself, below, never the real route");

  await page.route(`${baseURL}/api/word/text`, async (route) => {
    const body = route.request().postDataJSON() as { headword: string };
    const isDog = body.headword === "dog";
    if (isDog) {
      // Long enough to still be in flight when "cat" replaces it below.
      await new Promise((resolve) => setTimeout(resolve, SLOW_PHOTO_DELAY_MS));
    }
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(isDog ? DOG_TEXT : CAT_TEXT),
      });
    } catch {
      // `dog`'s own AbortController already cancelled the fetch client-side
      // by the time this fires; there is nothing left to answer.
    }
  });

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("dog");
  await expect(page.getByRole("heading", { name: "dog", exact: true })).toBeVisible({ timeout: 5000 });

  // Past the debounce, so `dog`'s own fetch has actually been sent — the
  // abort this proves is one of an in-flight request, not one still only
  // queued behind the timer.
  await page.waitForTimeout(PHRASE_DEBOUNCE_MS + 300);

  await searchBox.fill("cat");
  await expect(page.getByRole("heading", { name: "cat", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(CAT_TEXT.example.en)).toBeVisible({ timeout: PHRASE_DEBOUNCE_MS + 2000 });

  // Long enough that `dog`'s 3s answer, had it not been abandoned, would
  // already have landed.
  await page.waitForTimeout(SLOW_PHOTO_DELAY_MS);
  await expect(page.getByText(CAT_TEXT.example.en)).toBeVisible();
  await expect(page.getByText(DOG_TEXT.example.en)).toHaveCount(0);
});
