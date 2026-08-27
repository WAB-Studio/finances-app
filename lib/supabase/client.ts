import { createBrowserClient } from "@supabase/ssr";

import { env } from "@/lib/env";

// Auth only, same as the server client: sign in, sign out, refresh. The browser
// never queries the database (RNF-03), so `.from` and `.rpc` have no place here.
// `createBrowserClient` already memoises per set of arguments; no second layer.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
