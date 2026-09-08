import { expect, test } from "@playwright/test";

import messages from "../messages/es.json";

// docs/voyager/DESIGN.md "Viewport": the bar every board draws, and the only
// door onto `/registro` that isn't hidden behind `/fuente`.
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

test("the bar carries neither section as current on the credits page it links from", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });

  await page.goto("/fuente");
  await page.waitForTimeout(300);

  const nav = page.getByRole("navigation", { name: messages.nav.label });
  // Fuente is not a section (DESIGN.md "Viewport"): the bar still renders,
  // reachable from the credits page, but neither item is the current one.
  await expect(nav.getByRole("link", { name: messages.nav.search })).not.toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: messages.nav.log })).not.toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: messages.nav.log }).click();
  await expect(page).toHaveURL(/\/registro$/);
});
