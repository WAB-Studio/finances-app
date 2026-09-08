import "server-only";

import { cache } from "react";

import { createSupabaseServerClient, type SupabaseConfig } from "./client";

export type SessionUser = { id: string; email: string };

// The verified JWT payload. It never leaves this module: callers get the two
// fields below, so no policy decision can ever be made from a claim we control.
// Deduplicated per request. `cache()` keys on its arguments, so this takes the
// config's two strings rather than the config object: two calls that pass the
// same url and key — the normal case, one config per app — hit the same entry
// even when each call built a fresh config literal.
const getVerifiedClaims = cache(async function getVerifiedClaims(
  url: string,
  publishableKey: string,
) {
  const supabase = await createSupabaseServerClient({ url, publishableKey });
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data) return null;
  // An anonymous sign-in also carries the `authenticated` role.
  if (data.claims.is_anonymous) return null;

  const { sub, email } = data.claims;
  if (!sub || !email) return null;

  return { claims: data.claims, user: { id: sub, email } satisfies SessionUser };
});

export async function verifiedClaims(config: SupabaseConfig): Promise<{
  claims: Record<string, unknown>;
  user: SessionUser;
} | null> {
  return getVerifiedClaims(config.url, config.publishableKey);
}

export async function sessionUser(config: SupabaseConfig): Promise<SessionUser | null> {
  return (await verifiedClaims(config))?.user ?? null;
}
