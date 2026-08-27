import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { FundSwitcher } from "@/components/fund/fund-switcher";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
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
      <header className="flex items-center gap-2 border-b px-3 py-2 sm:px-6">
        <FundSwitcher funds={funds} />
        <div className="flex shrink-0 items-center gap-2">
          <LanguageSwitcher />
          <ThemeSwitcher />
          <SignOutButton />
        </div>
      </header>
      {props.children}
    </>
  );
}
