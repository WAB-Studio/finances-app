import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";

import { EmptyState, Flex, Heading, Page, Text } from "@/components/ui";
import { getFundForUser } from "@/db/queries/funds";
import { requireUser } from "@/db/session";
import { routing } from "@/i18n/routing";

export async function generateMetadata(
  props: PageProps<"/[locale]/f/[fundId]">,
): Promise<Metadata> {
  const { fundId } = await props.params;

  // An invalid uuid must never reach Postgres, which answers `22P02`.
  if (!z.uuid().safeParse(fundId).success) notFound();

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

  // An invalid uuid must never reach Postgres, which answers `22P02`.
  if (!z.uuid().safeParse(fundId).success) notFound();

  const [fund, user] = await Promise.all([
    getFundForUser(fundId),
    requireUser(),
  ]);
  if (!fund) notFound();

  const t = await getTranslations();

  return (
    <Page>
      <Flex direction="column" gap="2">
        <Text size="2" color="gray">
          {t("common.greeting", { email: user.email })}
        </Text>
        <Heading size="6">{fund.name}</Heading>
        <EmptyState
          title={t("dashboard.emptyTitle")}
          description={t("dashboard.emptyDescription")}
        />
      </Flex>
    </Page>
  );
}
