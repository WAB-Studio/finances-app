import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";

import { getFundForUser } from "@/db/queries/funds";
import { routing } from "@/i18n/routing";

// No chrome of its own: the header lives in `(app)/layout.tsx`, above this segment.
export default async function FundLayout(
  props: LayoutProps<"/[locale]/f/[fundId]">,
) {
  const { locale, fundId } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  // An invalid uuid must never reach Postgres, which answers `22P02`.
  if (!z.uuid().safeParse(fundId).success) notFound();

  const fund = await getFundForUser(fundId);
  if (!fund) notFound();

  return props.children;
}
