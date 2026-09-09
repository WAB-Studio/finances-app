import { expect, test } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";

// The rich-text tag `account-info.tsx` binds to a link: the credit names the
// licence and only the licence's own name sits inside `<cc>`.
const licenceLinkText = messages.account.info.licenceCredit.match(/<cc>(.*?)<\/cc>/)?.[1];
if (!licenceLinkText) throw new Error("messages.account.info.licenceCredit carries no <cc> tag");

// Module 6 dropped `SourceNote`, the search screen's own link to `/fuente`
// (`components/search/source-note.tsx`), and nothing else in the app ever
// linked there. The credit's new home is `/cuenta`'s information tab
// (RL-33, successor of RL-15) — this spec now drives that destination.
test("RL-33: the credit, its source url and its edition are reachable from /cuenta with no session", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });

  // No sign-in anywhere in this test: `/cuenta` renders signed out, and that
  // is what RL-33 leans on to keep the licence reachable by anyone.
  await page.goto("/cuenta");
  await expect(page.getByRole("heading", { name: messages.account.title })).toBeVisible();

  await page.getByRole("link", { name: messages.account.info.tabs.info }).click();

  // The dictionary's name doubles as the link to its source.
  const sourceLink = page.getByRole("link", { name: messages.account.info.dictionaryName });
  await expect(sourceLink).toBeVisible();
  await expect(sourceLink).toHaveAttribute("href", manifest.source.url);

  await expect(page.getByText(manifest.source.edition)).toBeVisible();

  const licenceLink = page.getByRole("link", { name: licenceLinkText });
  await expect(licenceLink).toBeVisible();
  await expect(licenceLink).toHaveAttribute("href", manifest.source.licenceUrl);
});
