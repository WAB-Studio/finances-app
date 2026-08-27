"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

const themes = ["light", "dark", "system"] as const;

type Theme = (typeof themes)[number];

const icons = { light: Sun, dark: Moon, system: Monitor };

function isTheme(value: string | undefined): value is Theme {
  return themes.includes(value as Theme);
}

// Fixed width on both branches; the mounted swap must not reflow the header strip.
const triggerClassName = "w-16 justify-between sm:w-36";

const subscribe = () => () => {};

// False through hydration, true afterwards, without a setState the compiler lint rejects.
function useMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function ThemeSwitcher() {
  const t = useTranslations("theme");
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useMounted();

  // `useTheme` reads storage only after hydration, so the real value cannot be rendered on the first pass.
  if (!mounted) {
    return (
      <Select value="" disabled>
        <SelectTrigger aria-label={t("label")} className={triggerClassName}>
          <Monitor className="size-4" />
          <span className="hidden sm:inline">{t("label")}</span>
        </SelectTrigger>
      </Select>
    );
  }

  const current = isTheme(theme) ? theme : "system";
  // `resolvedTheme` decides the icon only; the value keeps `system` as its own option.
  const TriggerIcon =
    current === "system"
      ? icons[resolvedTheme === "dark" ? "dark" : "light"]
      : icons[current];

  return (
    <Select value={current} onValueChange={setTheme}>
      <SelectTrigger aria-label={t("label")} className={triggerClassName}>
        <TriggerIcon className="size-4" />
        <span className="hidden sm:inline">{t(current)}</span>
      </SelectTrigger>
      <SelectContent>
        {themes.map((option) => {
          const Icon = icons[option];

          return (
            <SelectItem key={option} value={option}>
              <Icon className="size-4" />
              {t(option)}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
