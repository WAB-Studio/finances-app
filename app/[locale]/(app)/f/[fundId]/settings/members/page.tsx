import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";

import { MembersScreen } from "@/components/members/members-screen";
import { getFundForUser } from "@/db/queries/funds";
import { listMemberActiveAccounts, listMembers } from "@/db/queries/members";
import { requireUser } from "@/db/session";
import { routing } from "@/i18n/routing";

type Params = { locale: string; fundId: string };
type SearchParams = Record<string, string | string[] | undefined>;

// A repeated parameter arrives as an array; only a single value ever names a tab.
function firstValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function generateMetadata(props: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { fundId } = await props.params;
  const fund = await getFundForUser(fundId);
  if (!fund) notFound();

  const t = await getTranslations("members");
  return { title: t("title") };
}

export default async function MembersPage(props: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale, fundId } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  if (!z.uuid().safeParse(fundId).success) notFound();

  const fund = await getFundForUser(fundId);
  if (!fund) notFound();

  const user = await requireUser();

  const searchParams = await props.searchParams;
  const archived = firstValue(searchParams.archived) === "true";

  const members = await listMembers(fundId, { archived });

  // One entry per member with an active account: the archive dialog needs the
  // list ready before it opens, not fetched once the user picks a row.
  const memberAccounts = Object.fromEntries(
    await Promise.all(
      members
        .filter((member) => member.activeAccountCount > 0)
        .map(async (member) => [
          member.id,
          await listMemberActiveAccounts(fundId, member.id),
        ]),
    ),
  );

  return (
    <MembersScreen
      fundId={fundId}
      members={members}
      currentUserId={user.id}
      archived={archived}
      memberAccounts={memberAccounts}
    />
  );
}
