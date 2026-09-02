import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { GroupSettingsScreen } from "@/components/fund/group-settings-screen";
import { Page } from "@/components/ui";
import { getUserGroup, getUserGroupRole } from "@/db/queries/groups";
import { requireUser } from "@/db/session";
import { routing } from "@/i18n/routing";

export async function generateMetadata(
  props: PageProps<"/[locale]/settings/group">,
): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "group" });

  return { title: t("title") };
}

export default async function GroupSettingsPage(
  props: PageProps<"/[locale]/settings/group">,
) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  const [, group, role] = await Promise.all([
    requireUser(),
    getUserGroup(),
    getUserGroupRole(),
  ]);
  // There is nothing to configure without a group (RF-55); the shell layout
  // already refused this route, and this is what refuses it without the header.
  if (!group) notFound();

  return (
    <Page>
      <GroupSettingsScreen
        groupName={group.name}
        cashMode={group.cashMode}
        isLeader={role === "leader"}
      />
    </Page>
  );
}
