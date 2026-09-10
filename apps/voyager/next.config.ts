import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Inlined by DefinePlugin into every bundle, server included, so
  // `app/layout.tsx`'s own check on it folds to a literal `false` and the
  // branch it guards drops out of a build where the variable is unset.
  env: {
    VOYAGER_E2E_HOOKS: process.env.VOYAGER_E2E_HOOKS ?? "",
  },
  images: {
    // RL-36's photo is re-served from a Supabase Storage bucket, whichever
    // project the deploy points at — the hostname is per-project, `**`
    // covers it without naming one. `next/image` rejects any other `src` at
    // request time, not just at build time.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  async headers() {
    return [
      {
        // `public/` is served with `max-age=0` by default, so every open would
        // re-validate 8.2 MB — the opposite of an app that answers offline. The
        // asset's filename carries its edition, so a changed dictionary is a
        // changed URL and this copy is never stale.
        source: "/dictionary/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // The worker is how a new shell reaches a device that already has one;
        // cached, it would keep serving the old shell forever.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
