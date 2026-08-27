import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AppNav } from "@/components/fund/app-nav";
import { FundSwitcher } from "@/components/fund/fund-switcher";
import { Flex, Separator } from "@/components/ui";
import { listUserFunds } from "@/db/queries/funds";
import { requireUser } from "@/db/session";
import { routing } from "@/i18n/routing";

/**
 * The signed-in shell. The route group carries the guard, so every fund route
 * added under it inherits it without a second check.
 */
export default async function AppLayout(props: LayoutProps<"/[locale]">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  // The proxy already redirected an anonymous visitor; this is what enforces it.
  await requireUser();

  const funds = await listUserFunds();

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
          <AppNav funds={funds} />
          <FundSwitcher funds={funds} />
        </header>
      </Flex>
      <Separator size="4" />
      {props.children}
    </>
  );
}
