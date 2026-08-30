import { Wallet } from "lucide-react";
import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { Button, EmptyState, Flex, Link, Page, TapTarget } from "@/components/ui";
import { getUserGroup } from "@/db/queries/groups";
import { requireUser } from "@/db/session";
import { Link as LocaleLink } from "@/i18n/navigation";
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

  // requireUser stays the auth guard; its result is unused while the dashboard
  // shows only the create-first-account guide (RF-65 balances deferred).
  const [, group, t] = await Promise.all([
    requireUser(),
    getUserGroup(),
    getTranslations(),
  ]);

  return (
    <Page>
      <EmptyState
        icon={<Wallet size={44} strokeWidth={1.6} />}
        title={t("dashboard.emptyTitle")}
        description={t("dashboard.emptyDescription")}
        action={
          <Flex direction="column" align="center" gap="3" mt="2">
            <Button asChild size="3">
              <LocaleLink href="/settings/accounts">
                {t("dashboard.createAccount")}
              </LocaleLink>
            </Button>
            {!group && (
              <Link asChild>
                <LocaleLink href="/onboarding">
                  <TapTarget align="center" justify="center" px="2">
                    {t("dashboard.createFund")}
                  </TapTarget>
                </LocaleLink>
              </Link>
            )}
          </Flex>
        }
      />
    </Page>
  );
}
