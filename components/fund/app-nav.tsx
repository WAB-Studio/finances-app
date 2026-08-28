"use client";

import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Menu, Tags, Users, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Flex, IconButton, Link, NavPanel } from "@/components/ui";
import type { FundSummary } from "@/db/queries/funds";
import { Link as LocaleLink, usePathname } from "@/i18n/navigation";
import { activeFundId } from "@/lib/fund/active-fund-id";

type DestinationKey = "dashboard" | "members" | "accounts" | "categories";

function destinations(
  fundId: string,
): { key: DestinationKey; href: string; icon: LucideIcon }[] {
  return [
    { key: "dashboard", href: `/f/${fundId}`, icon: LayoutDashboard },
    {
      key: "members",
      href: `/f/${fundId}/settings/members`,
      icon: Users,
    },
    {
      key: "accounts",
      href: `/f/${fundId}/settings/accounts`,
      icon: Wallet,
    },
    {
      key: "categories",
      href: `/f/${fundId}/settings/categories`,
      icon: Tags,
    },
  ];
}

export function AppNav({ funds }: { funds: FundSummary[] }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [renderedPathname, setRenderedPathname] = useState(pathname);

  // Covers the browser back gesture too: no click in this component precedes it.
  if (pathname !== renderedPathname) {
    setRenderedPathname(pathname);
    setOpen(false);
  }

  const fundId = activeFundId(pathname);
  const activeFund = funds.find((fund) => fund.id === fundId);

  const trigger = (
    <IconButton type="button" variant="ghost" size="4" aria-label={t("openLabel")}>
      <Menu size={20} />
    </IconButton>
  );

  return (
    <NavPanel
      open={open}
      onOpenChange={setOpen}
      title={activeFund?.name ?? t("title")}
      closeLabel={t("close")}
      trigger={trigger}
    >
      {fundId && (
        <Flex direction="column" gap="1">
          {destinations(fundId).map(({ key, href, icon: Icon }) => {
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
                  <Flex as="span" align="center" gap="2" minHeight="40px">
                    <Icon size={18} />
                    {t(key)}
                  </Flex>
                </LocaleLink>
              </Link>
            );
          })}
        </Flex>
      )}
      <Flex direction="column" gap="2">
        <LanguageSwitcher width="100%" />
        <ThemeSwitcher width="100%" />
        <SignOutButton />
      </Flex>
    </NavPanel>
  );
}
