import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";

import { MembersScreen } from "@/components/members/members-screen";
import { Page } from "@/components/ui";
import { getFundForUser } from "@/db/queries/funds";
import { listMembers, listMembersActiveAccounts } from "@/db/queries/members";
import { requireUser } from "@/db/session";
import { routing } from "@/i18n/routing";

export async function generateMetadata(
  props: PageProps<"/[locale]/f/[fundId]/settings/members">,
): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "members" });

  return { title: t("title") };
}

export default async function MembersPage(
  props: PageProps<"/[locale]/f/[fundId]/settings/members">,
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
  const [fund, user, members, memberAccounts] = await Promise.all([
    getFundForUser(fundId),
    requireUser(),
    listMembers(fundId, { archived }),
    listMembersActiveAccounts(fundId),
  ]);
  if (!fund) notFound();

  return (
    <Page>
      <MembersScreen
        fundId={fundId}
        members={members}
        currentUserId={user.id}
        archived={archived}
        memberAccounts={memberAccounts}
      />
    </Page>
  );
}
