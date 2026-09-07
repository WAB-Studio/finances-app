import { expect, test } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";

test("the source is one tap away from the box, and names its licence, url and edition", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });

  await page.goto("/");
  await page.getByRole("link", { name: messages.source.open }).click();

  await expect(page).toHaveURL(/\/fuente$/);
  await expect(page.getByRole("heading", { name: messages.source.title })).toBeVisible();

  await expect(page.getByRole("link", { name: messages.source.licenceLink })).toBeVisible();
  await expect(page.getByText(messages.source.licenceName, { exact: true })).toBeVisible();
  await expect(page.getByText(manifest.source.edition, { exact: true })).toBeVisible();

  await expect(page.getByRole("link", { name: messages.source.sourceLink })).toHaveAttribute(
    "href",
    manifest.source.url,
  );
  await expect(page.getByRole("link", { name: messages.source.licenceLink })).toHaveAttribute(
    "href",
    manifest.source.licenceUrl,
  );
});
