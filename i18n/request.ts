import { hasLocale, type Messages } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { CURRENCY, DEFAULT_LOCALE, TIME_ZONE } from "@/lib/locales";
import type en from "../messages/en.json";
import { routing } from "./routing";

// Spanish is the source of truth; `skipLibCheck` would ignore this in `global.d.ts`.
type Catalogue<T extends Messages> = T;
export type EnglishCatalogue = Catalogue<typeof en>;

export default getRequestConfig(async ({ requestLocale }) => {
  // The segment doubles as a catch-all, so anything unknown falls back instead of throwing.
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Fixed, not the visitor's: the fund books every movement in one zone.
    timeZone: TIME_ZONE,
    formats: {
      number: {
        // COP has no cent denomination in circulation, so amounts round to the peso.
        currency: {
          style: "currency",
          currency: CURRENCY,
          maximumFractionDigits: 0,
        },
      },
    },
  };
});
