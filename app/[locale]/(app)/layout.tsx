import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AppNav } from "@/components/fund/app-nav";
import { AppTabs } from "@/components/fund/app-tabs";
import { Box, Flex, Separator, Text } from "@/components/ui";
import { getUserGroup } from "@/db/queries/groups";
import { requireUser } from "@/db/session";
import { routing } from "@/i18n/routing";

/**
 * The signed-in shell. The route group carries the guard, so every route added
 * under it inherits it without a second check. There is no fund to switch (RF-55):
 * the caller's optional group is resolved once here and named in the header.
 */
export default async function AppLayout(props: LayoutProps<"/[locale]">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  // The proxy already redirected an anonymous visitor; this is what enforces it.
  const [, group, t] = await Promise.all([
    requireUser(),
    getUserGroup(),
    getTranslations("common"),
  ]);

  return (
    <>
      <Flex
        asChild
        align="center"
        gap="2"
        px={{ initial: "3", sm: "6" }}
        py="2"
      >
        <header>
          {/* The bottom bar carries navigation on narrow; the hamburger is the
              desktop pattern, so it appears only from `md` up. */}
          <Box display={{ initial: "none", md: "block" }}>
            <AppNav groupName={group?.name ?? null} hasGroup={group !== null} />
          </Box>
          <Text weight="bold" truncate>
            {group?.name ?? t("appName")}
          </Text>
        </header>
      </Flex>
      <Separator size="4" />
      {props.children}
      <Box display={{ initial: "block", md: "none" }}>
        <AppTabs hasGroup={group !== null} />
      </Box>
    </>
  );
}
