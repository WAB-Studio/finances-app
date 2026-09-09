import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/es.json";

// `sendSignInLink` (app/actions/account.ts) is a Server Action: the browser
// calls it over a POST to the current page with a `next-action` header, and
// gets back a Flight-encoded return value — not a plain fetch a route handler
// answers. Faking that second line is what lets this suite drive a 429 (and
// a generic failure) without ever asking Supabase for a real one, which
// would spend the address's real send quota (RL-22's own action already
// logs and classifies the real thing; this proves what the reader sees for
// each of the three outcomes `SignedOutForm` can render).
async function mockSendSignInLinkResult(page: Page, result: { ok: true } | { ok: false; error: string }): Promise<void> {
  await page.route("**/cuenta", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    const body = [
      '0:{"a":"$@1","f":"","q":"","i":false,"b":"e2e0000000000000000"}',
      `1:${JSON.stringify(result)}`,
      "",
    ].join("\n");
    await route.fulfill({ status: 200, contentType: "text/x-component", body });
  });
}

async function submit(page: Page, email: string): Promise<void> {
  await page.goto("/cuenta");
  await page.getByRole("textbox", { name: messages.account.emailLabel }).fill(email);
  await page.getByRole("button", { name: messages.account.copy.noSessionAction }).click();
}

test("a 429 asking for the link says to wait, not the generic failure", async ({ page }) => {
  await mockSendSignInLinkResult(page, { ok: false, error: "rateLimited" });
  await submit(page, "reader@example.com");

  await expect(page.getByText(messages.account.errors.rateLimited)).toBeVisible();
  await expect(page.getByText(messages.account.errors.sendFailed)).toHaveCount(0);
});

test("a non-429 failure still says the generic 'could not send', not the rate-limit copy", async ({ page }) => {
  await mockSendSignInLinkResult(page, { ok: false, error: "sendFailed" });
  await submit(page, "reader@example.com");

  await expect(page.getByText(messages.account.errors.sendFailed)).toBeVisible();
  await expect(page.getByText(messages.account.errors.rateLimited)).toHaveCount(0);
});

test("an invalid email keeps its own copy, no mock involved", async ({ page }) => {
  // No route mock here: `sendSignInLink`'s zod check rejects before any
  // Supabase call, so this exercises the real action.
  await submit(page, "not-an-email");

  await expect(page.getByText(messages.account.errors.emailInvalid)).toBeVisible();
  await expect(page.getByText(messages.account.errors.rateLimited)).toHaveCount(0);
});
