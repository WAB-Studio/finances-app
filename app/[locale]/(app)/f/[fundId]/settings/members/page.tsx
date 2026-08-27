import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";

import { MembersScreen } from "@/components/members/members-screen";
import { Flex } from "@/components/ui";
import { getFundForUser } from "@/db/queries/funds";
import { listMemberActiveAccounts, listMembers } from "@/db/queries/members";
import { requireUser } from "@/db/session";
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

  const t = await getTranslations({ locale, namespace: "members" });

  return { title: t("title") };
}

export default async function MembersPage({
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

  const user = await requireUser();

  const { tab } = await searchParams;
  const archived = tab === "archived";

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
    <Flex asChild direction="column" flexGrow="1" p="6">
      <main>
        <MembersScreen
          fundId={fundId}
          members={members}
          currentUserId={user.id}
          archived={archived}
          memberAccounts={memberAccounts}
        />
      </main>
    </Flex>
  );
}
