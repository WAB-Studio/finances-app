/**
 * Layer 2 of the harness: every route over HTTP, against the running dev server,
 * under an authentic Supabase session. Layer 1 drives the query functions in
 * process; this drives the proxy, the layouts, the metadata and the route
 * handlers as a browser would, and asserts on what the wire actually carries.
 *
 * Redirects are FOLLOWED in the render suite, so a route that lands elsewhere is
 * reported by the path it landed on rather than hidden behind a 3xx. The guard
 * suite follows nothing: the redirect itself is what it asserts.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import messages from "@/messages/es.json";

import { assert, report, skip } from "./harness/assert";
import { cleanup, fixtureSql, track } from "./harness/fixtures";
import {
  HARNESS_BASE_URL,
  HARNESS_EMAIL,
  cookieHeader,
  harnessSession,
  mintedThisRun,
} from "./harness/session";

const LOCALE = "es";
const APP_GROUP_DIR = resolve(process.cwd(), "app/[locale]/(app)");

let counter = 0;

function next(name: string): string {
  counter += 1;
  return `H${counter}. ${name}`;
}

// The document title a page is expected to carry, read from the same message
// file the page reads. Hardcoding the Spanish here would rot on the first edit.
function title(key: string): string {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown>)[part],
      messages,
    );
  if (typeof value !== "string") throw new Error(`no message at ${key}`);

  return value;
}

function documentTitle(body: string): string {
  return /<title[^>]*>([^<]*)<\/title>/.exec(body)?.[1] ?? "(no title)";
}

// Next marks every refusal `<html id="__next_error__">`, the app's own not-found
// screen included. A 200 carrying it is a page that threw; a 404 that lacks it
// never reached the refusal it claims.
function isErrorShell(body: string): boolean {
  return body.includes("__next_error__");
}

type Rendered = {
  status: number;
  landedOn: string;
  title: string;
  errorShell: boolean;
};

async function get(path: string, cookie?: string): Promise<Rendered> {
  const response = await fetch(`${HARNESS_BASE_URL}${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
  const body = await response.text();

  return {
    status: response.status,
    landedOn: new URL(response.url).pathname,
    title: documentTitle(body),
    errorShell: isErrorShell(body),
  };
}

type AppRoute = { path: string; page: boolean };

/**
 * Every route file under `app/[locale]/(app)/`, as a path. Walked rather than
 * listed, so a route added tomorrow is guarded by this run without an edit here.
 * A dynamic segment takes the fixture's id.
 */
function appGroupRoutes(transactionId: string): AppRoute[] {
  const paths: AppRoute[] = [];

  function walk(directory: string, segments: string[]): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // A route group is a folder, never a URL segment.
        const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
        const segment = entry.name.startsWith("[")
          ? transactionId
          : entry.name;

        walk(join(directory, entry.name), isGroup ? segments : [...segments, segment]);
      } else if (entry.name === "page.tsx" || entry.name === "route.ts") {
        paths.push({
          path: `/${LOCALE}${segments.map((one) => `/${one}`).join("")}`,
          page: entry.name === "page.tsx",
        });
      }
    }
  }

  walk(APP_GROUP_DIR, []);

  return paths.sort((a, b) => a.path.localeCompare(b.path));
}

type RenderCase = {
  path: string;
  status: number;
  title: string;
  // Where the follow ended, when the route answers a redirect of its own.
  landsOn?: string;
  why?: string;
};

function renderCases(transactionId: string): RenderCase[] {
  return [
    { path: `/${LOCALE}`, status: 200, title: title("common.appName") },
    { path: `/${LOCALE}/inbox`, status: 200, title: title("ingest.title") },
    {
      path: `/${LOCALE}/movements`,
      status: 200,
      title: title("transactions.listTitle"),
    },
    {
      path: `/${LOCALE}/movements/${transactionId}`,
      status: 200,
      title: title("transactions.detailTitle"),
    },
    { path: `/${LOCALE}/reports`, status: 200, title: title("reports.title") },
    { path: `/${LOCALE}/planning`, status: 200, title: title("planning.title") },
    {
      path: `/${LOCALE}/planning/budgets`,
      status: 200,
      title: title("budgets.title"),
    },
    {
      path: `/${LOCALE}/planning/debts`,
      status: 200,
      title: title("debts.title"),
    },
    {
      path: `/${LOCALE}/planning/goals`,
      status: 200,
      title: title("goals.title"),
    },
    {
      path: `/${LOCALE}/planning/payments`,
      status: 200,
      title: title("plannedPayments.title"),
    },
    {
      path: `/${LOCALE}/planning/recurring`,
      status: 200,
      title: title("recurringRules.title"),
    },
    {
      path: `/${LOCALE}/settings/accounts`,
      status: 200,
      title: title("accounts.title"),
    },
    {
      path: `/${LOCALE}/settings/categories`,
      status: 200,
      title: title("categories.title"),
    },
    {
      path: `/${LOCALE}/settings/labels`,
      status: 200,
      title: title("labels.title"),
    },
    {
      path: `/${LOCALE}/settings/audit`,
      status: 200,
      title: title("audit.title"),
    },
    {
      path: `/${LOCALE}/settings/data`,
      status: 200,
      title: title("data.screen.title"),
    },
    {
      path: `/${LOCALE}/settings/webhooks`,
      status: 200,
      title: title("webhooks.title"),
    },
    // 404 by design: `page.tsx` calls `notFound()` for a caller with no group
    // (RF-55), and the harness user leads none. Asserting 200 would make this
    // transcript lie about the screen.
    {
      path: `/${LOCALE}/settings/members`,
      status: 404,
      title: title("metadata.title"),
      why: "RF-55: no group, so the page calls notFound()",
    },
    // The proxy sends a signed-in caller away from the login, and `bienvenida`
    // sends one with no claimed invite home. Both answer 200 at the dashboard,
    // which is what the follow reports.
    {
      path: `/${LOCALE}/login`,
      status: 200,
      title: title("common.appName"),
      landsOn: `/${LOCALE}`,
      why: "the proxy redirects a signed-in caller off the login",
    },
    {
      path: `/${LOCALE}/bienvenida`,
      status: 200,
      title: title("common.appName"),
      landsOn: `/${LOCALE}`,
      why: "no claimed membership, so the page sends the visitor home",
    },
    {
      path: `/${LOCALE}/onboarding`,
      status: 200,
      title: title("metadata.onboardingTitle"),
    },
    {
      path: `/${LOCALE}/onboarding/accounts`,
      status: 200,
      title: title("metadata.onboardingTitle"),
      landsOn: `/${LOCALE}/onboarding`,
      why: "step two presumes the fund from step one",
    },
    {
      path: `/${LOCALE}/onboarding/invite`,
      status: 200,
      title: title("metadata.onboardingTitle"),
      landsOn: `/${LOCALE}/onboarding`,
      why: "step three presumes the fund from step one",
    },
  ];
}

type HttpScope = {
  userId: string;
  accountId: string;
  categoryId: string;
  transactionId: string;
};

/**
 * The rows the screens read. No group is created: RF-55 makes the members screen
 * a 404 for a caller without one, and that 404 is an assertion below.
 */
async function seedHttpScope(userId: string): Promise<HttpScope> {
  const scope: HttpScope = {
    userId,
    accountId: randomUUID(),
    categoryId: randomUUID(),
    transactionId: randomUUID(),
  };
  const claims = JSON.stringify({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
  });

  await fixtureSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;

    await tx`
      insert into accounts (id, owner_user_id, name, kind, subtype, initial_balance_cents, initial_balance_on)
      values (${scope.accountId}, ${userId}, 'Harness HTTP bank', 'asset', 'bancaria', 5000000, current_date)`;

    await tx`
      insert into categories (id, owner_user_id, name, kind, color)
      values (${scope.categoryId}, ${userId}, 'Harness HTTP groceries', 'expense', '#4C8C4A')`;

    // Owner and creator are trigger-stamped from the claims above.
    await tx`
      insert into transactions (id, from_account_id, amount_cents, occurred_at, description)
      values (${scope.transactionId}, ${scope.accountId}, 123400, current_date, 'Harness HTTP movement')`;

    // An income or expense carries at least one split, and the sum has to match
    // the amount; a constraint trigger refuses the movement otherwise (RF-69).
    await tx`
      insert into transaction_splits (transaction_id, category_id, amount_cents)
      values (${scope.transactionId}, ${scope.categoryId}, 123400)`;
  });

  track("accounts", scope.accountId);
  track("categories", scope.categoryId);
  track("transactions", scope.transactionId);

  return scope;
}

// Deliveries the webhook suite lands, dropped by hand: `ingest_deliveries` is
// append-only for the app and carries no cleanup entry in `fixtures.ts`.
const landedDeliveries: string[] = [];

async function guardSuite(routes: AppRoute[]): Promise<void> {
  for (const { path } of routes) {
    const response = await fetch(`${HARNESS_BASE_URL}${path}`, {
      redirect: "manual",
    });
    // A relative Location is as valid as an absolute one, so it is resolved
    // rather than parsed on its own.
    const location = response.headers.get("location");
    const target = location ? new URL(location, HARNESS_BASE_URL) : null;
    const carried = target?.searchParams.get("next");

    assert(
      next(`${path} without a session redirects to the login`),
      response.status === 307 &&
        target?.pathname === `/${LOCALE}/login` &&
        carried === path,
      `it answered ${response.status} to ${target?.pathname ?? "(no location)"} carrying next=${carried ?? "(none)"}`,
    );
  }

  const login = await get(`/${LOCALE}/login`);
  assert(
    next("the login itself answers without a session"),
    login.status === 200 && !login.errorShell,
    `it answered ${login.status} titled ${JSON.stringify(login.title)}`,
  );
}

async function renderSuite(cases: RenderCase[], cookie: string): Promise<void> {
  for (const expected of cases) {
    const seen = await get(expected.path, cookie);
    const landedOn = expected.landsOn ?? expected.path;
    // A refusal comes in the shell; a render never does.
    const bodyIsRight =
      expected.status === 404 ? seen.errorShell : !seen.errorShell;

    assert(
      next(`${expected.path} renders${expected.why ? ` — ${expected.why}` : ""}`),
      seen.status === expected.status &&
        seen.landedOn === landedOn &&
        seen.title === expected.title &&
        bodyIsRight,
      `it answered ${seen.status} at ${seen.landedOn} titled ${JSON.stringify(seen.title)} over ${
        seen.errorShell ? "Next's refusal shell" : "its own screen"
      }`,
    );
  }
}

// A page under the route group that no case names would go unrendered and unseen.
// Route handlers are excluded: they answer a download, not a document.
function coverageSuite(cases: RenderCase[], routes: AppRoute[]): void {
  const named = new Set(cases.map((one) => one.path));
  const missing = routes
    .filter((route) => route.page && !named.has(route.path))
    .map((route) => route.path);

  assert(
    next("every page under the route group is named by a render case"),
    missing.length === 0,
    missing.length === 0
      ? `${routes.length} routes walked, ${named.size} cases`
      : `unnamed: ${missing.join(", ")}`,
  );
}

async function localeSuite(cookie: string): Promise<void> {
  const seen = await get("/xx/inbox", cookie);

  assert(
    next("an unknown locale segment is not a route"),
    seen.status === 404,
    `it answered ${seen.status} at ${seen.landedOn}`,
  );
}

/**
 * The ingest endpoint end to end: a credential the harness mints, one delivery,
 * the same text again landing nothing new, and a token that resolves to nothing.
 * The route answers 200 to both the first delivery and its repeat — the repeat is
 * told apart by `duplicate`, never by a status.
 */
async function webhookSuite(userId: string): Promise<void> {
  const credentialId = randomUUID();
  const token = `whk_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const claims = JSON.stringify({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
  });

  await fixtureSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx`
      insert into webhook_credentials (id, owner_user_id, name, token_hash)
      values (${credentialId}, ${userId}, 'Harness HTTP credential', ${tokenHash})`;
  });
  track("webhook_credentials", credentialId);

  const text = `Bancolombia: Compraste COP12.345,00 en HARNESS HTTP ${randomUUID().slice(0, 8)}`;

  async function post(bearer: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${HARNESS_BASE_URL}/api/webhooks/ingest`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }

  const first = await post(token);
  if (typeof first.body.deliveryId === "string") {
    landedDeliveries.push(first.body.deliveryId);
  }
  assert(
    next("a delivery lands through the ingest endpoint"),
    first.status === 200 &&
      first.body.duplicate === false &&
      first.body.status === "pending" &&
      typeof first.body.deliveryId === "string",
    `it answered ${first.status} — ${JSON.stringify(first.body)}`,
  );

  const repeat = await post(token);
  assert(
    next("the same text again lands nothing new"),
    repeat.status === 200 &&
      repeat.body.duplicate === true &&
      repeat.body.deliveryId === first.body.deliveryId,
    `it answered ${repeat.status} — ${JSON.stringify(repeat.body)}`,
  );

  const [{ count }] = await fixtureSql<{ count: string }[]>`
    select count(*)::text as count
    from ingest_deliveries
    where owner_user_id = ${userId} and credential_id = ${credentialId}`;
  assert(
    next("the repeat left one row, not two"),
    count === "1",
    `the credential holds ${count} deliveries`,
  );

  const unknown = await post(`whk_${randomBytes(32).toString("base64url")}`);
  assert(
    next("a token that resolves to nothing is refused"),
    unknown.status === 401 && unknown.body.error === "unauthorized",
    `it answered ${unknown.status} — ${JSON.stringify(unknown.body)}`,
  );

  await fixtureSql`
    update webhook_credentials set revoked_at = now() where id = ${credentialId}`;

  const revoked = await post(token);
  assert(
    next("the revoked credential is refused with the same generic answer"),
    revoked.status === 401 && revoked.body.error === "unauthorized",
    `it answered ${revoked.status} — ${JSON.stringify(revoked.body)}`,
  );
}

async function timingSuite(cases: RenderCase[], cookie: string): Promise<void> {
  for (const one of cases) {
    const started = Date.now();
    await get(one.path, cookie);
    console.log(`REPORT  ${one.path} answered hot in ${Date.now() - started} ms.`);
  }

  const samples: number[] = [];
  for (let run = 0; run < 5; run += 1) {
    const started = Date.now();
    await get(`/${LOCALE}`, cookie);
    samples.push(Date.now() - started);
  }
  samples.sort((a, b) => a - b);
  const median = samples[2];

  console.log(
    `REPORT  the dashboard's median over five hot requests is ${median} ms (${samples.join(", ")}).`,
  );
  skip(
    next("the dashboard meets the RNF-09 budget"),
    `unmeasurable here: ${median} ms on an empty ledger against a 2000 ms budget that assumes a year of movements, on next dev, which compiles on demand`,
  );
}

async function main(): Promise<void> {
  const session = await harnessSession();
  const userId = session.user.id;
  console.log(
    `REPORT  harness user ${userId} <${HARNESS_EMAIL}>, session ${
      mintedThisRun() ? "minted this run" : "reused from private/harness-session.json"
    }.`,
  );
  console.log(`REPORT  driving ${HARNESS_BASE_URL}.`);

  const scope = await seedHttpScope(userId);
  const cookie = await cookieHeader();
  const routes = appGroupRoutes(scope.transactionId);
  const cases = renderCases(scope.transactionId);
  console.log("");

  await guardSuite(routes);
  console.log("");
  coverageSuite(cases, routes);
  await renderSuite(cases, cookie);
  console.log("");
  await localeSuite(cookie);
  await webhookSuite(userId);
  console.log("");
  await timingSuite(cases, cookie);
}

// Wrapped in an async IIFE (not top-level await) so the runner can transpile this
// to CJS and run it on any Node version, not only Node 22's native strip.
void (async () => {
  try {
    await main();
  } catch (error) {
    assert(
      next("the run completed"),
      false,
      `it aborted — ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    try {
      if (landedDeliveries.length > 0) {
        await fixtureSql`delete from ingest_deliveries where id in ${fixtureSql(landedDeliveries)}`;
      }
      await cleanup();
    } catch (error) {
      assert(
        next("the fixtures were dropped"),
        false,
        `cleanup failed — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  report();
})();
