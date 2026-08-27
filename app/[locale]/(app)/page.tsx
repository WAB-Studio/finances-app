import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { requireUser } from "@/db/session";
import { routing } from "@/i18n/routing";

export default async function HomePage(props: PageProps<"/[locale]">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  const user = await requireUser();
  const t = await getTranslations("common");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("greeting", { email: user.email })}
      </h1>
      <p className="text-muted-foreground max-w-prose">{t("setupPending")}</p>
    </main>
  );
}
