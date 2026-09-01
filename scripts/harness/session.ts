// An authentic Supabase session for the harness, and the cookie the app reads it
// from. Nothing here is a stub: the access token is signed by the project, so the
// proxy, `requireUser()` and every access policy see a real `auth.uid()`.
//
// THE CACHE IS NOT AN OPTIMISATION. Supabase rate-limits the OTP endpoint per
// project — the built-in mailer allows a couple of sends an hour — so a mint per
// run would lock the harness out within minutes. Every run refreshes the stored
// session first and only mints when that fails. Do not "simplify" this into a
// mint per run.
//
// The address is synthetic, and the discovery that made that possible: Supabase
// DOES issue an OTP for an undeliverable `.invalid` domain — `POST /auth/v1/otp`
// answers 200 and the `auth.one_time_tokens` row lands — but only for a fully
// shaped `auth.users` row. A row with `email_confirmed_at` null answers 422
// `otp_disabled`, and one whose token text columns are null answers 500
// "Database error finding user". So `ensureHarnessAuthUser` fills them, and the
// real user's mailbox is never used.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { fixtureSql } from "./fixtures";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// The project ref is the first hostname label of the project URL, and the cookie
// `@supabase/ssr` writes is named after it.
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`;

// `@supabase/ssr`'s own threshold: one cookie until the encoded value passes it,
// then `${name}.0`, `${name}.1`, … over the same string.
const MAX_CHUNK_SIZE = 3180;

// Gitignored, and shared with layer 3 — a browser run and an HTTP run in the same
// hour cost one mint between them.
const SESSION_FILE = resolve(process.cwd(), "private/harness-session.json");

export const HARNESS_EMAIL = "harness@example.invalid";

export const HARNESS_BASE_URL =
  process.env.HARNESS_BASE_URL ?? "http://localhost:3000";

export type HarnessSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: "bearer";
  user: { id: string; email: string } & Record<string, unknown>;
};

let current: HarnessSession | null = null;

/**
 * The run's session: the stored one refreshed, or a freshly minted one. Memoised
 * per process, so a screen's worth of requests costs no round trip to the auth
 * server.
 */
export async function harnessSession(): Promise<HarnessSession> {
  if (current) return current;

  const stored = readStored();
  // A file left by another identity is not this harness's session.
  const refreshed =
    stored && stored.user?.email === HARNESS_EMAIL
      ? await refreshSession(stored.refresh_token)
      : null;

  current = refreshed ?? (await mintSession());
  // `private/` is gitignored, so a fresh clone reaches this write without it.
  mkdirSync(dirname(SESSION_FILE), { recursive: true });
  writeFileSync(SESSION_FILE, `${JSON.stringify(current, null, 2)}\n`, "utf8");

  return current;
}

// Whether this process reached the auth server's OTP endpoint, which is what the
// transcript reports to say a run reused its cached session.
let minted = false;

export function mintedThisRun(): boolean {
  return minted;
}

export async function harnessUserId(): Promise<string> {
  return (await harnessSession()).user.id;
}

/**
 * The `Cookie` header the app's server client parses: one chunk, split only past
 * `MAX_CHUNK_SIZE`, over the base64 of the session JSON.
 */
export async function cookieHeader(): Promise<string> {
  const session = await harnessSession();
  const encoded = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64")}`;

  if (encoded.length <= MAX_CHUNK_SIZE) return `${COOKIE_NAME}=${encoded}`;

  const chunks: string[] = [];
  for (let at = 0; at < encoded.length; at += MAX_CHUNK_SIZE) {
    chunks.push(encoded.slice(at, at + MAX_CHUNK_SIZE));
  }

  return chunks.map((chunk, index) => `${COOKIE_NAME}.${index}=${chunk}`).join("; ");
}

/**
 * The app's own magic link for the harness user, which a browser visits to be
 * logged in by `/auth/confirm` — the same route a real link lands on. Reuses an
 * unconsumed token when one is waiting: `verifyOtp` deletes the row it burns, so
 * a row still present was never used, and reusing it costs no OTP send.
 */
export async function magicLinkUrl(): Promise<string> {
  const userId = await ensureHarnessAuthUser();

  const hash = (await newestTokenHash(userId)) ?? (await requestOtp(userId));

  return `${HARNESS_BASE_URL}/auth/confirm?token_hash=${hash}&type=magiclink`;
}

function readStored(): HarnessSession | null {
  if (!existsSync(SESSION_FILE)) return null;

  try {
    return JSON.parse(readFileSync(SESSION_FILE, "utf8")) as HarnessSession;
  } catch {
    return null;
  }
}

async function refreshSession(
  refreshToken: string,
): Promise<HarnessSession | null> {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
  );
  if (!response.ok) return null;

  const body = (await response.json()) as Partial<HarnessSession>;
  if (!body.access_token || !body.refresh_token || !body.user) return null;

  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_in: body.expires_in ?? 3600,
    expires_at: body.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: body.user,
  };
}

async function mintSession(): Promise<HarnessSession> {
  const userId = await ensureHarnessAuthUser();
  const hash = (await newestTokenHash(userId)) ?? (await requestOtp(userId));

  // 303, with the tokens in the URL fragment rather than the query.
  const verified = await fetch(
    `${SUPABASE_URL}/auth/v1/verify?type=magiclink&token=${hash}`,
    { method: "GET", redirect: "manual" },
  );
  const fragment = new URLSearchParams(
    (verified.headers.get("location") ?? "").split("#")[1] ?? "",
  );
  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  if (!accessToken || !refreshToken) {
    throw new Error(
      `magic link verification answered ${verified.status} without tokens`,
    );
  }

  // The session JSON carries the user the app's client expects to find in it.
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!userResponse.ok) {
    throw new Error(`GET /auth/v1/user answered ${userResponse.status}`);
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: Number(fragment.get("expires_in") ?? 3600),
    expires_at: Number(fragment.get("expires_at") ?? 0),
    token_type: "bearer",
    user: (await userResponse.json()) as HarnessSession["user"],
  };
}

async function requestOtp(userId: string): Promise<string> {
  minted = true;

  let response = await postOtp();

  // The rate limit is a short floor between sends — the answer names the seconds
  // left — so a second run inside it waits rather than failing the whole layer.
  if (response.status === 429) {
    const body = await response.text();
    const seconds = Number(/after (\d+) seconds/.exec(body)?.[1] ?? 0);
    await new Promise((done) => setTimeout(done, (seconds + 1) * 1000));
    response = await postOtp();
  }

  if (!response.ok) {
    throw new Error(
      `POST /auth/v1/otp answered ${response.status} — ${(await response.text()).slice(0, 200)}`,
    );
  }

  const hash = await newestTokenHash(userId);
  if (!hash) throw new Error("the OTP request left no one_time_tokens row");

  return hash;
}

function postOtp(): Promise<Response> {
  return fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    // The harness never signs a user up over HTTP; the row is already there.
    body: JSON.stringify({ email: HARNESS_EMAIL, create_user: false }),
  });
}

// Over the direct connection, because no API hands a token hash back. Old rows
// are skipped: a magic link outlives its usefulness long before it expires.
async function newestTokenHash(userId: string): Promise<string | null> {
  const [row] = await fixtureSql<{ token_hash: string }[]>`
    select token_hash
    from auth.one_time_tokens
    where user_id = ${userId}
      and created_at > now() - interval '30 minutes'
    order by created_at desc
    limit 1`;

  return row?.token_hash ?? null;
}

/**
 * The harness's own identity, created once and never dropped — the cached session
 * is worthless against a user that a cleanup removed. Every column GoTrue scans
 * is filled; the nulls it cannot read are what the 500 above came from.
 */
async function ensureHarnessAuthUser(): Promise<string> {
  const [existing] = await fixtureSql<{ id: string }[]>`
    select id from auth.users where email = ${HARNESS_EMAIL}`;
  if (existing) return existing.id;

  const id = randomUUID();

  await fixtureSql`
    insert into auth.users (
      id, instance_id, aud, role, email, email_confirmed_at,
      encrypted_password, confirmation_token, recovery_token,
      email_change, email_change_token_current, email_change_token_new,
      email_change_confirm_status, phone_change, phone_change_token,
      reauthentication_token, raw_app_meta_data, raw_user_meta_data,
      is_sso_user, is_anonymous, created_at, updated_at)
    values (
      ${id}, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', ${HARNESS_EMAIL}, now(),
      '', '', '',
      '', '', '',
      0, '', '',
      '', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      false, false, now(), now())`;
  await fixtureSql`insert into app_users (id, locale) values (${id}, 'es')`;

  return id;
}
