import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test } from "./fixtures";
import postgres from "postgres";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";
import { closeRun, openRun } from "@repo/harness-registry";

// `check:e2e` runs the bare Playwright CLI, no `--env-file`: the direct
// Postgres access the session-leak test below needs is not there unless
// this loads it itself (mirrors `e2e/registro.spec.ts`'s own guard).
try {
  process.loadEnvFile(path.join(__dirname, "../.env.local"));
} catch {
  // No .env.local: fall back to whatever the shell already set.
}

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

// Mirrors `e2e/registro.spec.ts`'s own two functions: a fresh `auth.users`
// row with a landed recovery token, the only pair GoTrue's `verifyOtp`
// accepts. Kept local, not imported — a spec's module scope is not the
// place for another file's helpers, and that file has no exports of its own.
async function mintReaderIdentity(
  sql: postgres.Sql,
  runId: string,
): Promise<{ id: string; email: string; hash: string }> {
  const id = randomUUID();
  const email = `harness-reader-${id}@example.invalid`;

  await sql.begin(async (tx) => {
    await tx`
      insert into auth.users (
        id, instance_id, aud, role, email, email_confirmed_at,
        encrypted_password, confirmation_token, recovery_token,
        email_change, email_change_token_current, email_change_token_new,
        email_change_confirm_status, phone_change, phone_change_token,
        reauthentication_token, raw_app_meta_data, raw_user_meta_data,
        is_sso_user, is_anonymous, created_at, updated_at)
      values (
        ${id}, '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', ${email}, now(),
        '', '', '',
        '', '', '',
        0, '', '',
        '', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        false, false, now(), now())`;
    await tx`
      insert into harness.identities (user_id, run_id, email, disposition)
      values (${id}, ${runId}, ${email}, 'ephemeral')`;
  });

  const hash = randomBytes(32).toString("hex");
  await sql`
    update auth.users
    set recovery_token = ${hash}, recovery_sent_at = now(), updated_at = now()
    where id = ${id}`;
  await sql`
    insert into auth.one_time_tokens
      (id, user_id, token_type, token_hash, relates_to, created_at, updated_at)
    values
      (${randomUUID()}, ${id}, 'recovery_token', ${hash}, ${email}, now(), now())`;

  return { id, email, hash };
}

async function dropReaderIdentity(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from harness.identities where user_id = ${id}`;
  await sql`delete from auth.users where id = ${id}`;
}

// The route's `Set-Cookie` lands on this very redirect, and `page.request`
// shares the browser context's cookie jar, so the context is signed in the
// moment this resolves — no page ever has to visit the link itself. Never
// the `/cuenta` form: that sends a real email from the user's own Gmail.
async function signInAs(page: import("@playwright/test").Page, hash: string): Promise<void> {
  const response = await page.request.get(`/auth/confirm?token_hash=${hash}&type=magiclink`, {
    maxRedirects: 0,
  });
  const location = response.headers()["location"];
  expect(location?.includes("error="), `redirected to ${location ?? "nowhere"}`).toBe(false);
}

// Drives the leak the coordinator found: `sw.js`'s `NO_OVERWRITE_ROUTES` is
// what stops a live, signed-in render of "/registro" from ever landing in
// Cache Storage — without it, `navigate` overwrites the install-time
// (signed-out) copy the moment a reader visits while signed in, and that
// copy outlives the session it was drawn for.
test("offline, /registro never resurrects the account wipe a signed-in visit once cached", async ({
  page,
  context,
}) => {
  test.setTimeout(45_000);
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });

  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  const runId = await openRun("e2e", sql);
  const reader = await mintReaderIdentity(sql, runId);

  try {
    // Waits for the dictionary asset, same as `e2e/registro.spec.ts`'s own
    // searches: without it the Worker is not ready yet and the fill/clear
    // below never lands a row.
    const assetResponse = page.waitForResponse(
      (response) => response.url().includes(manifest.asset.path) && response.ok(),
    );
    await page.goto("/");
    await assetResponse;
    await page.waitForTimeout(1000);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    // A row this device recorded itself, so `ClearPanel`'s own count gate
    // has something to show once the confirm panel opens.
    const searchBox = page.getByRole("textbox", { name: messages.search.label });
    await searchBox.fill("apple");
    await searchBox.fill("");
    await page.waitForTimeout(300);

    await signInAs(page, reader.hash);

    // Online, signed in: this is the render that must never overwrite the
    // cache — wait for the worker to settle the navigation before reading it.
    await page.goto("/registro");
    await expect(page.getByRole("button", { name: messages.log.clear.trigger })).toBeVisible();
    await expect.poll(() => isCached(page, "/registro")).toBe(true);

    // The session gone, same as a sign-out or an expired cookie — the local
    // record above stays, so `ClearPanel` still has a count to draw from.
    await context.clearCookies();

    await context.setOffline(true);
    await page.goto("/registro");

    await page.getByRole("button", { name: messages.log.clear.trigger }).click();
    await expect(page.getByRole("button", { name: messages.log.clear.accountAction })).toHaveCount(0);
  } finally {
    await context.setOffline(false);
    await dropReaderIdentity(sql, reader.id);
    await closeRun(sql);
    await sql.end();
  }
});
