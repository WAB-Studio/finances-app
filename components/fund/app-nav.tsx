"use client";

import type { LucideIcon } from "lucide-react";
import {
  Database,
  LayoutDashboard,
  Menu,
  ScrollText,
  Tag,
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
import { Flex, IconButton, Link, NavPanel, TapTarget } from "@/components/ui";
import { Link as LocaleLink, usePathname } from "@/i18n/navigation";

type DestinationKey =
  | "dashboard"
  | "planning"
  | "members"
  | "accounts"
  | "categories"
  | "labels"
  | "data"
  | "audit";

// One group per user with no switching (RF-55), so every destination is a fixed
// path. Members only exist inside a group, so that link appears only with one.
function destinations(
  hasGroup: boolean,
): { key: DestinationKey; href: string; icon: LucideIcon }[] {
  return [
    { key: "dashboard", href: "/", icon: LayoutDashboard },
    { key: "planning", href: "/planning", icon: Target },
    ...(hasGroup
      ? [{ key: "members" as const, href: "/settings/members", icon: Users }]
      : []),
    { key: "accounts", href: "/settings/accounts", icon: Wallet },
    { key: "categories", href: "/settings/categories", icon: Tags },
    { key: "labels", href: "/settings/labels", icon: Tag },
    { key: "data", href: "/settings/data", icon: Database },
    { key: "audit", href: "/settings/audit", icon: ScrollText },
  ];
}

export function AppNav({
  groupName,
  hasGroup,
}: {
  groupName: string | null;
  hasGroup: boolean;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [renderedPathname, setRenderedPathname] = useState(pathname);

  // Covers the browser back gesture too: no click in this component precedes it.
  if (pathname !== renderedPathname) {
    setRenderedPathname(pathname);
    setOpen(false);
  }

  const trigger = (
    <IconButton type="button" variant="ghost" aria-label={t("openLabel")}>
      <Menu size={20} />
    </IconButton>
  );

  return (
    <NavPanel
      open={open}
      onOpenChange={setOpen}
      title={groupName ?? t("title")}
      closeLabel={t("close")}
      trigger={trigger}
    >
      <Flex direction="column" gap="1">
        {destinations(hasGroup).map(({ key, href, icon: Icon }) => {
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
}
