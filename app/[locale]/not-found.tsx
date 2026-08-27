import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("errors.notFoundTitle")}
      </h1>
      <p className="text-muted-foreground max-w-prose">
        {t("errors.notFoundDescription")}
      </p>
      <Link href="/" className="underline underline-offset-4">
        {t("common.backHome")}
      </Link>
    </main>
  );
}
