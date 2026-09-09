import { expect, test } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";

// docs/voyager/DESIGN.md "Viewport": the bar every board draws.
test("the bottom bar carries Buscar and Registro, and each reaches its route", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });

  await page.goto("/");
  await page.waitForTimeout(500);

  const nav = page.getByRole("navigation", { name: messages.nav.label });
  const buscar = nav.getByRole("link", { name: messages.nav.search });
  const registro = nav.getByRole("link", { name: messages.nav.log });

  // Both items render, nowhere else in the page duplicates their name — the
  // search box itself also answers to "Buscar", so this counts the nav alone.
  await expect(buscar).toBeVisible();
  await expect(registro).toBeVisible();

  // RNL-03's 44px floor, DESIGN.md's own widening of it for this bar —
  // measured on the rendered box, not read off a class name.
  for (const item of [buscar, registro]) {
    const box = await item.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
  }

  // On `/`, Buscar is the current section.
  await expect(buscar).toHaveAttribute("aria-current", "page");
  await expect(registro).not.toHaveAttribute("aria-current", "page");

  await registro.click();
  await expect(page).toHaveURL(/\/registro$/);
  await expect(page.getByRole("navigation", { name: messages.nav.label }).getByRole("link", { name: messages.nav.log })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByRole("navigation", { name: messages.nav.label }).getByRole("link", { name: messages.nav.search }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("navigation", { name: messages.nav.label }).getByRole("link", { name: messages.nav.search })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // RNL-03: the bar itself never forces horizontal scroll at the phone
  // viewport this project runs.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBe(clientWidth);
});

// `/fuente` was this non-section page until module 10 (RL-33) retired it.
// `/registro/[palabra]` replaces it: a real route the bar's own `items`
// never lists (only the bare `/registro` marks Registro current, `pathname
// === route`), and no other lane's assignment holds it right now.
test("the bar carries neither section as current on a page that isn't one", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });

  await page.goto("/registro/zzqqxv");
  await page.waitForTimeout(300);

  const nav = page.getByRole("navigation", { name: messages.nav.label });
  // A word page is not a section (DESIGN.md "Viewport"): the bar still
  // renders, reachable from it, but neither item is the current one.
  await expect(nav.getByRole("link", { name: messages.nav.search })).not.toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: messages.nav.log })).not.toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: messages.nav.log }).click();
  await expect(page).toHaveURL(/\/registro$/);
});

test("Buscar carries the query past a trip through Registro, unretyped", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/?q=book");
  await assetResponse;
  // buildIndex still has to run over 64,258 entries after the fetch settles
  // (e2e/url.spec.ts's own margin), plus the effect that reads the address
  // bar into the nav's own memory.
  await page.waitForTimeout(1000);

  const nav = () => page.getByRole("navigation", { name: messages.nav.label });
  await nav().getByRole("link", { name: messages.nav.log }).click();
  await expect(page).toHaveURL(/\/registro$/);

  await nav().getByRole("link", { name: messages.nav.search }).click();
  await expect(page).toHaveURL(/\?q=book$/);
  await expect(page.getByRole("textbox", { name: messages.search.label })).toHaveValue("book");
});

test("all three routes still draw the bar at 360px, with no horizontal overflow", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });

  for (const route of ["/", "/registro", "/cuenta"]) {
    await page.goto(route);
    await page.waitForTimeout(300);

    const nav = page.getByRole("navigation", { name: messages.nav.label });
    const box = await nav.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    // The bar, not the sidebar: it sits in the viewport's lower half.
    expect(box!.y).toBeGreaterThan(viewport!.height / 2);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBe(clientWidth);
  }
});

test("Buscar reaches a bare / with nothing to remember", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });

  await page.goto("/registro");
  await page.waitForTimeout(300);

  const buscar = page.getByRole("navigation", { name: messages.nav.label }).getByRole("link", { name: messages.nav.search });
  await expect(buscar).toHaveAttribute("href", "/");
});
