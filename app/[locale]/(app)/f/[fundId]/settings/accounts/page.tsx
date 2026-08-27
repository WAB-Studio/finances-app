import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AccountsScreen } from "@/components/accounts/accounts-screen";
import { Flex } from "@/components/ui";
import { getFundForUser } from "@/db/queries/funds";
import { listAccounts, listAssignableMembers } from "@/db/queries/accounts";
import { routing } from "@/i18n/routing";

// `.next/types` cannot know this route yet in every slot, so its params are
// written out rather than pulled from the generated `PageProps` helper.
type Params = { locale: string; fundId: string };
type SearchParams = { tab?: string | string[] };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "accounts" });

  return { title: t("title") };
}

export default async function AccountsPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale, fundId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  // An invalid uuid must never reach Postgres, which answers `22P02`.
  if (!z.uuid().safeParse(fundId).success) notFound();

  const fund = await getFundForUser(fundId);
  if (!fund) notFound();

  const { tab } = await searchParams;
  const archived = tab === "archived";

  const [accounts, members] = await Promise.all([
    listAccounts(fundId, { archived }),
    listAssignableMembers(fundId),
  ]);

  return (
    <Flex asChild direction="column" flexGrow="1" p="6">
      <main>
        <AccountsScreen
          fundId={fundId}
          accounts={accounts}
          members={members}
          archived={archived}
        />
      </main>
    </Flex>
  );
}
