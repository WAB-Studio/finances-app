import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { EmptyState, Flex, Heading, Text } from "@/components/ui";
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
    <Flex asChild direction="column" flexGrow="1" gap="2" p="6">
      <main>
        <Text size="2" color="gray">
          {t("common.greeting", { email: user.email })}
        </Text>
        <Heading size="6">{fund.name}</Heading>
        <EmptyState
          title={t("dashboard.emptyTitle")}
          description={t("dashboard.emptyDescription")}
        />
      </main>
    </Flex>
  );
}
