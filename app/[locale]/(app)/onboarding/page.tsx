import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CreateFundForm } from "@/components/fund/create-fund-form";
import { Box, Card, Flex, Heading } from "@/components/ui";
import { requireUser } from "@/db/session";
import { routing } from "@/i18n/routing";

export async function generateMetadata(
  props: PageProps<"/[locale]/onboarding">,
): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "metadata" });

  return {
    title: t("onboardingTitle"),
    description: t("onboardingDescription"),
  };
}

// Also reached by someone who already has a fund: it is how a second one gets created.
export default async function OnboardingPage(
  props: PageProps<"/[locale]/onboarding">,
) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  await requireUser();

  const t = await getTranslations("onboarding");

  return (
    <Flex asChild flexGrow="1" align="center" justify="center" p="4">
      <main>
        <Box width="100%" maxWidth="24rem">
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5">{t("title")}</Heading>
              <CreateFundForm />
            </Flex>
          </Card>
        </Box>
      </main>
    </Flex>
  );
}
