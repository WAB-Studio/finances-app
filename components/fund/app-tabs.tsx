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
import { useQuickEntry } from "@/components/transactions/quick-entry-provider";
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
  const { openQuick } = useQuickEntry();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [renderedPathname, setRenderedPathname] = useState(pathname);

  // Closes the sheet on any navigation, the browser back gesture included.
  if (pathname !== renderedPathname) {
    setRenderedPathname(pathname);
    setOpen(false);
  }

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
      href: "/movements",
      active: pathname.startsWith("/movements"),
      icon: <ArrowRightLeft size={22} />,
      label: t("movements"),
    },
    {
      key: "planning",
      href: "/planning",
      active: pathname.startsWith("/planning"),
      icon: <Target size={22} />,
      label: t("planning"),
    },
  ];

  // The raised action opens the expense quick sheet in place (RF-22): one tap, no
  // route change. Income and transfer live behind the sheet's link.
  const centerAction = (
    <IconButton
      type="button"
      size="4"
      radius="full"
      aria-label={t("quickEntry")}
      onClick={openQuick}
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
