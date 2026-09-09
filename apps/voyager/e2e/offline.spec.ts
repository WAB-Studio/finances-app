import { expect, test } from "@playwright/test";

import messages from "../messages/es.json";

test("the app opens with no connection, from its own cache, never the browser's", async ({ page, context }) => {
  // Chromium's built-in `Translator` hangs `availability()` forever
  // (docs/TRAPS.md).
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });

  await page.goto("/");
  // `activate` calls `self.clients.claim()`, so this page becomes controlled
  // without a second navigation — but only once the worker is actually active.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.reload();

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await expect(searchBox).toBeVisible();

  // RL-16: the box, not a network error page — Chromium's own offline page
  // never carries this input.
  await expect(searchBox).toBeEditable();

  // The 8.2 MB payload has its own store; the shell's cache must never hold
  // a second copy of it.
  const dictionaryCacheEntries = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      urls.push(...requests.map((request) => request.url));
    }
    return urls.filter((url) => url.includes("/dictionary/"));
  });
  expect(dictionaryCacheEntries).toEqual([]);
});

// Reads every cache the worker owns, never a hardcoded cache name: the
// version string in sw.js is free to change without this test coupling to it.
async function isCached(page: import("@playwright/test").Page, path: string) {
  return page.evaluate(async (p) => {
    const names = await caches.keys();
    for (const name of names) {
      const cache = await caches.open(name);
      if (await cache.match(new URL(p, location.origin).toString())) return true;
    }
    return false;
  }, path);
}

// `/fuente` was this second route until module 10 (RL-33) retired it; the
// claim here was always about the service worker's per-route cache key, not
// about that route itself. `/registro/zzqqxv` replaces it: a real page no
// other lane's assignment holds right now, its word never searched, so it
// always draws the same empty state (e2e/palabra-historial.spec.ts drives
// the same page the same way).
test("a hard load of /registro/zzqqxv does not overwrite the cached / shell", async ({ page, context }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });

  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // A hard load of the other route, still online — this used to be the
  // navigation that stomped the single "/" cache entry.
  await page.goto("/registro/zzqqxv");
  await expect.poll(() => isCached(page, "/registro/zzqqxv")).toBe(true);

  await context.setOffline(true);

  // Offline "/": the search box, not the word page the last hard load left
  // in the browser's history.
  await page.goto("/");
  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await expect(searchBox).toBeVisible();
  await expect(searchBox).toBeEditable();

  // Offline "/registro/zzqqxv": its own cached page, still reachable — a
  // per-route cache key must not have traded one route's offline support for
  // the other's.
  await page.goto("/registro/zzqqxv");
  await expect(page.getByRole("heading", { name: "zzqqxv" })).toBeVisible();
  await expect(page.getByText(messages.log.word.emptyBody.replace("{word}", "zzqqxv"))).toBeVisible();
});
