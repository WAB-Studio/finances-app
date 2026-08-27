"use client";

import { LanguagesIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useTransition } from "react";
import { toast } from "sonner";

import { setLocaleAction } from "@/app/actions/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALES, type Locale } from "@/lib/locales";

// Matched to the theme switcher: the two sit side by side and must not reflow.
const triggerClassName = "w-16 justify-between sm:w-36";

function isLocale(value: string): value is Locale {
  return LOCALES.includes(value as Locale);
}

export function LanguageSwitcher() {
  const t = useTranslations("language");
  // Root-scoped: the action's error is a full catalogue path.
  const tKey = useTranslations();
  type MessageKey = Parameters<typeof tKey>[0];
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isNavigating, startTransition] = useTransition();

  const { execute, isPending } = useAction(setLocaleAction, {
    // The URL moves only once the preference is stored, so a failed write
    // leaves the visitor on the language they were already reading.
    onSuccess({ data }) {
      startTransition(() => router.replace(pathname, { locale: data.locale }));
    },
    onError({ error }) {
      toast.error(
        tKey((error.serverError ?? "errors.unexpected") as MessageKey),
      );
    },
  });

  function onValueChange(value: string) {
    if (isLocale(value)) execute({ locale: value });
  }

  return (
    <Select
      value={locale}
      onValueChange={onValueChange}
      disabled={isPending || isNavigating}
    >
      <SelectTrigger aria-label={t("label")} className={triggerClassName}>
        <LanguagesIcon className="size-4" />
        <span className="hidden sm:inline">{t(`endonym.${locale}`)}</span>
      </SelectTrigger>
      <SelectContent>
        {LOCALES.map((option) => (
          <SelectItem key={option} value={option}>
            {t(`endonym.${option}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
