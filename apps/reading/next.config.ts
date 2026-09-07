import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
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
