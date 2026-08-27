import "server-only";

import { sql } from "drizzle-orm";
import { getLocale } from "next-intl/server";

import { db } from "@/db/client";
import { redirect } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string };

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The verified JWT payload. It never leaves this module: callers get the two
// fields below, so no policy decision can ever be made from a claim we control.
async function getVerifiedClaims() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data) return null;
  // An anonymous sign-in also carries the `authenticated` role.
  if (data.claims.is_anonymous) return null;

  const { sub, email } = data.claims;
  if (!sub || !email) return null;

  return { claims: data.claims, user: { id: sub, email } satisfies SessionUser };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  return (await getVerifiedClaims())?.user ?? null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (user) return user;

  // Returns `never`; the return keeps control-flow analysis on the caller side.
  return redirect({ href: "/login", locale: await getLocale() });
}

/**
 * The only path from the server to fund data. Opens a transaction that runs as
 * `authenticated` — a role that neither owns `app_users` nor holds BYPASSRLS —
 * so the policies decide every row, not the query.
 *
 * Throwing here is the guard. A caller pairs `getSessionUser()` with this only
 * when it needs `user.id` in a statement, or when `null` already means "the
 * policies did not show you this"; anywhere else the check buys nothing.
 */
export async function withUserDb<T>(
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const session = await getVerifiedClaims();
  // No fallback to an unrestricted connection: without a session there is no query.
  if (!session) throw new Error("withUserDb called without a verified session");

  const claims = JSON.stringify(session.claims);

  return db.transaction(async (tx) => {
    // Claims first, while still `postgres`; the reverse order leaves a window
    // where the connection is `authenticated` with the previous request's claims.
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${claims}, true)`,
    );
    await tx.execute(sql`select set_config('statement_timeout', '8000', true)`);
    // `true` is `is_local`: the pooler hands this connection on at commit.
    await tx.execute(sql`select set_config('role', 'authenticated', true)`);

    return fn(tx);
  });
}
