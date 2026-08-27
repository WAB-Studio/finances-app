import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { env } from "@/lib/env";

/**
 * Auth only. The Data API is off for this project, so `.from`, `.rpc` and
 * storage would fail at runtime; every row reaches a screen through Drizzle.
 *
 * `responseHeaders` is the sink for the no-store directives that must ride
 * along with a refreshed session. Next exposes no writable response headers to
 * a Server Component or Server Action, so only the proxy and Route Handlers —
 * which hold a real response — can supply one.
 */
export async function createSupabaseServerClient(responseHeaders?: Headers) {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet, headers) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
            // Without these a CDN may cache the `Set-Cookie` response and hand
            // one user's session to another.
            for (const [name, value] of Object.entries(headers)) {
              responseHeaders?.set(name, value);
            }
          } catch {
            // Rendering a Server Component: the session is refreshed by the
            // proxy on the next request instead.
          }
        },
      },
    },
  );
}
