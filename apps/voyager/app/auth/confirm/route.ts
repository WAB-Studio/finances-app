import { createSupabaseServerClient } from "@repo/supabase-auth";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";

const supabaseConfig = {
  url: env.NEXT_PUBLIC_SUPABASE_URL,
  publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
};

// `magiclink` and `signup` are what `signInWithOtp` sends depending on
// whether the address already had an account; `email` covers a custom
// template that names the OTP type directly.
const confirmSchema = z.object({
  token_hash: z.string().min(1),
  type: z.enum(["magiclink", "signup", "email"]),
});

function invalidLink(request: NextRequest, headers: Headers): NextResponse {
  const url = new URL("/cuenta", request.url);
  url.searchParams.set("error", "linkInvalid");

  const response = NextResponse.redirect(url);
  headers.forEach((value, name) => response.headers.set(name, value));
  return response;
}

/**
 * Lands the magic link (RL-22). No row to seed: there is no `app_users` here
 * and `reading.lookups` has no header row for a fresh reader to own.
 */
export async function GET(request: NextRequest) {
  const query = confirmSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  // The no-store directives `setAll` hands back have to ride on the redirect.
  const authHeaders = new Headers();
  if (!query.success) return invalidLink(request, authHeaders);

  const supabase = await createSupabaseServerClient(supabaseConfig, authHeaders);
  const { data, error } = await supabase.auth.verifyOtp({
    type: query.data.type,
    token_hash: query.data.token_hash,
  });

  if (error || !data.user) {
    console.error("magic link verification failed", error);
    return invalidLink(request, authHeaders);
  }

  const response = NextResponse.redirect(new URL("/cuenta", request.url));
  authHeaders.forEach((value, name) => response.headers.set(name, value));
  return response;
}
