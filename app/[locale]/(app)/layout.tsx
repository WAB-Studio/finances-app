import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
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

  const t = await getTranslations("common");

  return (
    <>
      <header className="flex items-center gap-2 border-b px-3 py-2 sm:px-6">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          {t("appName")}
        </span>
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
