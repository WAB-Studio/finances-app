import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";

import { RegisterServiceWorker } from "@/components/register-service-worker";
import { AppTheme, Flex } from "@/components/ui";
import "@radix-ui/themes/styles.css";
import "./theme.css";

// Lets env(safe-area-inset-*) resolve instead of 0 on a notched phone.
export const viewport: Viewport = {
  viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");

  return {
    title: t("title"),
    description: t("description"),
    // What lands the app on an iPhone home screen (RL-16): iOS reads none of the
    // manifest, so the launch title comes from here and the icon from the
    // `apple-icon` file convention.
    appleWebApp: {
      capable: true,
      // Short enough for the home screen to write it under the icon whole.
      title: t("shortTitle"),
      statusBarStyle: "default",
    },
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <NextIntlClientProvider>
          <AppTheme>
            <Flex direction="column" minHeight="100dvh">
              {children}
            </Flex>
          </AppTheme>
          <RegisterServiceWorker />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
