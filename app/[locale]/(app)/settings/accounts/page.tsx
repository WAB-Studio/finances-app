import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AccountsScreen } from "@/components/accounts/accounts-screen";
import { Page } from "@/components/ui";
import { listAccounts } from "@/db/queries/accounts";
import { getUserGroup } from "@/db/queries/groups";
import { routing } from "@/i18n/routing";

export async function generateMetadata(
  props: PageProps<"/[locale]/settings/accounts">,
): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "accounts" });

  return { title: t("title") };
}

export default async function AccountsPage(
  props: PageProps<"/[locale]/settings/accounts">,
) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  const { tab } = await props.searchParams;
  const archived = tab === "archived";

  // The policies scope the rows: a personal-only caller sees only their own
  // accounts, a group member sees the group's too (RF-58).
  const [accounts, group] = await Promise.all([
    listAccounts({ archived }),
    getUserGroup(),
  ]);

  return (
    <Page>
      <AccountsScreen
        accounts={accounts}
        groupName={group?.name ?? null}
        archived={archived}
      />
    </Page>
  );
}
