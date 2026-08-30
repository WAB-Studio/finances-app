import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import { notFound } from "next/navigation";

import { ThemeScript } from "@/components/theme-script";
import { AppTheme, Flex, Toaster } from "@/components/ui";
import { routing } from "@/i18n/routing";
import "@radix-ui/themes/styles.css";
import "../theme.css";

const sans = Instrument_Sans({
  // The name `AppTheme` reads for its sans stack.
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Lets env(safe-area-inset-*) resolve instead of 0 on a notched phone.
export const viewport: Viewport = {
  viewportFit: "cover",
};

export async function generateMetadata(
  props: LayoutProps<"/[locale]">,
): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Metadata resolves before the layout runs, so the locale travels explicitly.
  const t = await getTranslations({ locale, namespace: "metadata" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function LocaleLayout(props: LayoutProps<"/[locale]">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Opts the tree into static rendering; without it every page turns dynamic.
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${sans.variable} ${geistMono.variable}`}
      // The inline script below writes the theme class here before hydration.
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body>
        <NextIntlClientProvider>
          <AppTheme>
            <Flex direction="column" height="100dvh">
              <Flex direction="column" flexGrow="1">
                {props.children}
              </Flex>
              <Toaster />
            </Flex>
          </AppTheme>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
