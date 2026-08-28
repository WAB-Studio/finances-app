import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AccountsScreen } from "@/components/accounts/accounts-screen";
import { Page } from "@/components/ui";
import { getFundForUser } from "@/db/queries/funds";
import { listAccounts, listAssignableMembers } from "@/db/queries/accounts";
import { routing } from "@/i18n/routing";

export async function generateMetadata(
  props: PageProps<"/[locale]/f/[fundId]/settings/accounts">,
): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "accounts" });

  return { title: t("title") };
}

export default async function AccountsPage(
  props: PageProps<"/[locale]/f/[fundId]/settings/accounts">,
) {
  const { locale, fundId } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  // An invalid uuid must never reach Postgres, which answers `22P02`.
  if (!z.uuid().safeParse(fundId).success) notFound();

  const { tab } = await props.searchParams;
  const archived = tab === "archived";

  // The fund check rides along instead of gating: the policies filter the rows
  // below anyway, so a fund the user cannot see comes back empty and then 404s.
  const [fund, accounts, members] = await Promise.all([
    getFundForUser(fundId),
    listAccounts(fundId, { archived }),
    listAssignableMembers(fundId),
  ]);
  if (!fund) notFound();

  return (
    <Page>
      <AccountsScreen
        fundId={fundId}
        accounts={accounts}
        members={members}
        archived={archived}
      />
    </Page>
  );
}
