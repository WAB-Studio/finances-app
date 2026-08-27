import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { listUserFunds } from "@/db/queries/funds";
import { requireUser } from "@/db/session";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { readLastFundId } from "@/lib/fund/last-fund";

// Renders nothing: every path through here ends in a redirect.
export default async function HomePage(props: PageProps<"/[locale]">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  await requireUser();

  const funds = await listUserFunds();
  if (funds.length === 0) redirect({ href: "/onboarding", locale });

  // The cookie is a landing hint, not a grant: fall back when it names a fund the user left.
  const lastFundId = await readLastFundId();
  const target = funds.find((fund) => fund.id === lastFundId) ?? funds[0];

  redirect({ href: `/f/${target.id}`, locale });
}
