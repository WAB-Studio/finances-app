"use client";

import { LanguagesIcon, Loader2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { setLocaleAction } from "@/app/actions/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { usePathname } from "@/i18n/navigation";
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
  // Never cleared: the document is leaving, and the control must not come back
  // to life in the gap between the action resolving and the new page painting.
  const [leaving, setLeaving] = useState(false);

  const { execute, isPending } = useAction(setLocaleAction, {
    // A document navigation, never a client one: crossing `[locale]` remounts the
    // theme provider, and React cannot run its pre-paint script in the browser.
    onSuccess({ data }) {
      setLeaving(true);
      window.location.assign(
        new URL(`/${data.locale}${pathname}`, window.location.origin),
      );
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
      disabled={isPending || leaving}
    >
      <SelectTrigger aria-label={t("label")} className={triggerClassName}>
        {isPending || leaving ? (
          <Loader2Icon className="size-4 animate-spin" aria-hidden />
        ) : (
          <LanguagesIcon className="size-4" />
        )}
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
