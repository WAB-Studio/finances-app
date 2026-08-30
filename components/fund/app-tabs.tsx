"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowRightLeft,
  House,
  Plus,
  SlidersHorizontal,
  Tags,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import {
  BottomNav,
  type BottomNavTab,
  BottomNavTrigger,
  Flex,
  IconButton,
  Link,
  NavPanel,
  TapTarget,
} from "@/components/ui";
import { Link as LocaleLink, usePathname } from "@/i18n/navigation";

type SettingKey = "members" | "accounts" | "categories";

// The settings sheet mirrors AppNav's destinations minus the dashboard, which the
// Inicio tab already owns. Members only exist inside a group.
function settings(
  hasGroup: boolean,
): { key: SettingKey; href: string; icon: LucideIcon }[] {
  return [
    ...(hasGroup
      ? [{ key: "members" as const, href: "/settings/members", icon: Users }]
      : []),
    { key: "accounts", href: "/settings/accounts", icon: Wallet },
    { key: "categories", href: "/settings/categories", icon: Tags },
  ];
}

export function AppTabs({ hasGroup }: { hasGroup: boolean }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [renderedPathname, setRenderedPathname] = useState(pathname);

  // Closes the sheet on any navigation, the browser back gesture included.
  if (pathname !== renderedPathname) {
    setRenderedPathname(pathname);
    setOpen(false);
  }

  // Movs and Planeación wait for their own slices, so they show but do not lead
  // anywhere yet.
  const tabs: BottomNavTab[] = [
    {
      key: "home",
      href: "/",
      active: pathname === "/",
      icon: <House size={22} />,
      label: t("home"),
    },
    {
      key: "movements",
      disabled: true,
      icon: <ArrowRightLeft size={22} />,
      label: t("movements"),
    },
    {
      key: "planning",
      disabled: true,
      icon: <Target size={22} />,
      label: t("planning"),
    },
  ];

  // Quick entry (RF-22) ships in a later slice; the raised action stands in for
  // it so the bar's shape is settled.
  const centerAction = (
    <IconButton
      type="button"
      size="4"
      radius="full"
      aria-label={t("quickEntry")}
    >
      <Plus size={26} />
    </IconButton>
  );

  const moreTrigger = (
    <NavPanel
      open={open}
      onOpenChange={setOpen}
      title={t("settings")}
      closeLabel={t("close")}
      trigger={
        <BottomNavTrigger icon={<SlidersHorizontal size={22} />} label={t("settings")} />
      }
    >
      <Flex direction="column" gap="1">
        {settings(hasGroup).map(({ key, href, icon: Icon }) => {
          const current = pathname === href;
          return (
            <Link
              key={key}
              asChild
              color={current ? undefined : "gray"}
              weight={current ? "bold" : undefined}
              highContrast={current}
            >
              <LocaleLink
                href={href}
                aria-current={current ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <TapTarget align="center" gap="2">
                  <Icon size={18} />
                  {t(key)}
                </TapTarget>
              </LocaleLink>
            </Link>
          );
        })}
      </Flex>
      <Flex direction="column" gap="2">
        <LanguageSwitcher width="100%" />
        <ThemeSwitcher width="100%" />
        <SignOutButton />
      </Flex>
    </NavPanel>
  );

  return (
    <BottomNav tabs={tabs} centerAction={centerAction} moreTrigger={moreTrigger} />
  );
}
