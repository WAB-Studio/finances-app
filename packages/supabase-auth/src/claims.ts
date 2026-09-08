import "server-only";

import { cache } from "react";

export type SessionUser = { id: string; email: string };

// The one shape this module needs from a Supabase client: verified claims.
// Narrow to `auth.getClaims()` alone, so a stub that never builds a real
// `SupabaseClient` — the harness's, in particular — keeps satisfying it.
export type SupabaseClientLike = {
  auth: {
    getClaims: () => Promise<
      | { data: { claims: Record<string, unknown> }; error: null }
      | { data: null; error: unknown }
    >;
  };
};

// A factory, not a built client. `getVerifiedClaims` below is wrapped in
// `cache()`, which keys on its arguments: a client would be a fresh reference
// on every call and would defeat that cache silently, paying its own
// `getClaims()` per consumer. A module-level function is a stable reference,
// so `cache()` keeps deduplicating per request.
export type ClientFactory = () => Promise<SupabaseClientLike>;

// The verified JWT payload. It never leaves this module: callers get the two
// fields below, so no policy decision can ever be made from a claim we control.
const getVerifiedClaims = cache(async function getVerifiedClaims(
  createClient: ClientFactory,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data) return null;
  const claims = data.claims;
  // An anonymous sign-in also carries the `authenticated` role.
  if (claims.is_anonymous) return null;

  const { sub, email } = claims;
  if (typeof sub !== "string" || typeof email !== "string") return null;

  return { claims, user: { id: sub, email } satisfies SessionUser };
});

export async function verifiedClaims(createClient: ClientFactory): Promise<{
  claims: Record<string, unknown>;
  user: SessionUser;
} | null> {
  return getVerifiedClaims(createClient);
}

export async function sessionUser(createClient: ClientFactory): Promise<SessionUser | null> {
  return (await verifiedClaims(createClient))?.user ?? null;
}
