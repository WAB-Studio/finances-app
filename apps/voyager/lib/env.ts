import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// This project has no server-side Supabase key variable and none is to be
// added: the server reaches Postgres through `DATABASE_URL` and Auth through
// the publishable key. A privileged Supabase key here would bypass every RLS
// policy (RNL-10).
export const env = createEnv({
  server: {
    // Registering this address with MyMemory raises its free daily quota.
    // Optional so the app builds and runs against MyMemory's anonymous tier
    // with nothing configured at all (RL-09).
    TRANSLATE_MYMEMORY_EMAIL: z.string().email().optional(),
    // A paid MyMemory key, only if volume ever outgrows the free tier.
    TRANSLATE_MYMEMORY_KEY: z.string().min(1).optional(),
    // Supabase transaction pooler (6543), used by the running app.
    DATABASE_URL: z.url(),
    // Supabase session pooler (5432), used by drizzle-kit only.
    MIGRATION_DATABASE_URL: z.url(),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    // The prefix check rejects a pasted privileged key or a legacy JWT at build time.
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
      .string()
      .startsWith("sb_publishable_"),
    NEXT_PUBLIC_SITE_URL: z.url(),
  },
  // Client variables are inlined at build time, so they must be spelled out.
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
  emptyStringAsUndefined: true,
});
