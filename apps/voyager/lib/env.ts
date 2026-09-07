import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Server-only: nothing here reaches the client bundle. Both variables are
// optional so the app builds and runs against MyMemory's anonymous tier with
// no secret configured at all (RL-09).
export const env = createEnv({
  server: {
    // Registering this address with MyMemory raises its free daily quota.
    TRANSLATE_MYMEMORY_EMAIL: z.string().email().optional(),
    // A paid MyMemory key, only if volume ever outgrows the free tier.
    TRANSLATE_MYMEMORY_KEY: z.string().min(1).optional(),
  },
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
});
