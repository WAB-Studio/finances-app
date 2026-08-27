"use client";

import { LanguagesIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { setLocaleAction } from "@/app/actions/locale";
import { Select, Spinner, ToolbarSelect } from "@/components/ui";
import { usePathname } from "@/i18n/navigation";
import { isLocale, LOCALES } from "@/lib/locales";

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
    // A document navigation, never a client one: only a full load re-runs the pre-paint theme script.
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

  const pending = isPending || leaving;

  return (
    <ToolbarSelect
      value={locale}
      onValueChange={onValueChange}
      disabled={pending}
      label={t("label")}
      icon={pending ? <Spinner /> : <LanguagesIcon size={16} />}
      text={t(`endonym.${locale}`)}
    >
      {LOCALES.map((option) => (
        <Select.Item key={option} value={option}>
          {t(`endonym.${option}`)}
        </Select.Item>
      ))}
    </ToolbarSelect>
  );
}
