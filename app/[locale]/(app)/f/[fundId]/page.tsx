import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { getFundForUser } from "@/db/queries/funds";
import { requireUser } from "@/db/session";
import { routing } from "@/i18n/routing";

export async function generateMetadata(
  props: PageProps<"/[locale]/f/[fundId]">,
): Promise<Metadata> {
  const { fundId } = await props.params;
  const fund = await getFundForUser(fundId);
  if (!fund) notFound();

  return { title: fund.name };
}

export default async function FundPage(
  props: PageProps<"/[locale]/f/[fundId]">,
) {
  const { locale, fundId } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  const fund = await getFundForUser(fundId);
  if (!fund) notFound();

  const user = await requireUser();
  const t = await getTranslations();

  return (
    <main className="flex flex-1 flex-col gap-2 p-6">
      <p className="text-muted-foreground text-sm">
        {t("common.greeting", { email: user.email })}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{fund.name}</h1>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-lg font-medium">{t("dashboard.emptyTitle")}</p>
        <p className="text-muted-foreground max-w-prose">
          {t("dashboard.emptyDescription")}
        </p>
      </div>
    </main>
  );
}
