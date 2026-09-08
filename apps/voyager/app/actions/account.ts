"use server";

import { createSupabaseServerClient } from "@repo/supabase-auth";
import { redirect } from "next/navigation";
import { z } from "zod";

import { env } from "@/lib/env";

const supabaseConfig = {
  url: env.NEXT_PUBLIC_SUPABASE_URL,
  publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
};

const emailSchema = z.email();

export type SendSignInLinkResult =
  | { ok: true }
  | { ok: false; error: "emailInvalid" | "sendFailed" };

/**
 * Asks for the sign-in link (RL-22). No `data` on the call: it would land in
 * `raw_user_meta_data`, which the user can rewrite and which surfaces in the
 * JWT — there is no `app_users` row here for state to live in instead.
 */
export async function sendSignInLink(email: string): Promise<SendSignInLinkResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: "emailInvalid" };

  const supabase = await createSupabaseServerClient(supabaseConfig);

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/confirm`,
    },
  });

  if (error) {
    console.error("sign-in link request failed", error);
    // 429 / over_email_send_rate_limit lands on the same key as any other
    // failure to send: there is no copy in messages/es.json that names the
    // rate limit apart from a generic "could not send".
    return { ok: false, error: "sendFailed" };
  }

  // Identical whether or not that address already has an account: the answer
  // must not tell a stranger who is registered.
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient(supabaseConfig);

  const { error } = await supabase.auth.signOut();
  // Logged, not surfaced: the session is gone from this browser either way.
  if (error) console.error("sign-out failed", error);

  redirect("/registro");
}
