import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { EmptyState, Flex, Heading, Page, Text } from "@/components/ui";
import { getUserGroup } from "@/db/queries/groups";
import { requireUser } from "@/db/session";
import { routing } from "@/i18n/routing";

export async function generateMetadata(
  props: PageProps<"/[locale]">,
): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const group = await getUserGroup();
  if (group) return { title: group.name };

  const t = await getTranslations({ locale, namespace: "common" });
  return { title: t("appName") };
}

// The signed-in landing. A user may run personal-only (RF-55), so an absent
// group is expected, not a redirect to create one.
export default async function HomePage(props: PageProps<"/[locale]">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  const [user, group, t] = await Promise.all([
    requireUser(),
    getUserGroup(),
    getTranslations(),
  ]);

  return (
    <Page>
      <Flex direction="column" gap="2">
        <Text size="2" color="gray">
          {t("common.greeting", { email: user.email })}
        </Text>
        <Heading size="6">{group?.name ?? t("common.appName")}</Heading>
        <EmptyState
          title={t("dashboard.emptyTitle")}
          description={t("dashboard.emptyDescription")}
        />
      </Flex>
    </Page>
  );
}
