import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";

// The link tag in <head> is emitted from this file alone; iOS reads none of it
// (RootLayout's `appleWebApp` metadata covers iOS instead) but every other
// platform that offers "add to home screen" reads this.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations("metadata");

  return {
    name: t("title"),
    short_name: t("shortTitle"),
    description: t("description"),
    start_url: "/",
    display: "standalone",
    // Matches app/theme.css: the document's own light background and the
    // indigo accent set on <AppTheme>.
    background_color: "#ffffff",
    theme_color: "#3e63dd",
    lang: "es",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
