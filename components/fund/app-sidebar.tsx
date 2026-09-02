"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronDown, ChevronRight, Plus, Settings } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  GROUP_SETTINGS_HREF,
  PRIMARY_KEYS,
  SIDEBAR_SECONDARY_KEYS,
  destinations,
  isCurrent,
} from "@/components/fund/destinations";
import { SettingsPanel } from "@/components/fund/settings-panel";
import { useQuickEntry } from "@/components/transactions/quick-entry-provider";
import {
  Avatar,
  Badge,
  Button,
  Flex,
  IconButton,
  NavList,
  type NavListItem,
  Sidebar,
  SidebarSeparator,
  Text,
  VisuallyHidden,
} from "@/components/ui";
import { Link as LocaleLink, usePathname } from "@/i18n/navigation";

// Ajustes reaches every destination the panel lists, so the catalogue — which
// holds only what a surface offers directly — does not name it.
const SETTINGS_HREF = "/settings";

// The stroke thickens on the current destination, which is the only weight the
// row's icon carries; the pill behind it does the rest.
function icon(Icon: LucideIcon, current: boolean) {
  return <Icon size={19} strokeWidth={current ? 2 : 1.8} />;
}

// The chevron of a row that opens something. `atEnd` sends it past the label,
// which is where the person's row carries it.
function chevron(Icon: LucideIcon, atEnd = false) {
  return (
    <Icon
      size={16}
      strokeWidth={2}
      style={{ flexShrink: 0, marginLeft: atEnd ? "auto" : undefined }}
    />
  );
}

/**
 * The desktop shell (`private/design-desktop/SPEC-A3.md`): every primary screen one
 * click away from every other, Ajustes among them, and quick entry (RF-22)
 * without leaving the screen. The person's own row keeps the settings panel, which
 * is their menu and not an index of destinations. Below `md` it does not render —
 * the bottom bar owns navigation there.
 */
export function AppSidebar({
  fundName,
  hasGroup,
  personName,
  role,
  pendingCount,
}: {
  fundName: string;
  hasGroup: boolean;
  personName: string;
  role: "leader" | "member" | null;
  pendingCount: number;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { openQuick } = useQuickEntry();

  // The queue's waiting count, spoken rather than left as a bare number.
  const pendingBadge = pendingCount > 0 && (
    <Badge
      color="amber"
      variant="soft"
      radius="full"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      <span aria-hidden>{pendingCount}</span>
      <VisuallyHidden>{t("pending", { count: pendingCount })}</VisuallyHidden>
    </Badge>
  );

  // Ajustes is a screen of its own on a laptop, so its row is a destination like
  // the ones above it. Every settings path opens with the same segment, so only
  // an exact match lights this row and not Cuentas or Datos.
  const settings: NavListItem = {
    key: "settings",
    href: SETTINGS_HREF,
    icon: icon(Settings, pathname === SETTINGS_HREF),
    label: t("settings"),
    current: pathname === SETTINGS_HREF,
  };

  function items(keys: Parameters<typeof destinations>[0]): NavListItem[] {
    return destinations(keys, hasGroup).map(({ key, href, icon: Icon }) => {
      const current = isCurrent(pathname, href);
      return {
        key,
        href,
        icon: icon(Icon, current),
        label: t(key),
        current,
        badge: key === "inbox" ? pendingBadge || undefined : undefined,
      };
    });
  }

  return (
    <Sidebar label={t("title")} display={{ initial: "none", md: "flex" }}>
      <Flex align="center" style={{ gap: 8, padding: "4px 10px 20px" }}>
        <Text
          truncate
          style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" }}
        >
          {fundName}
        </Text>
        {/* `/settings/group` refuses a caller without one, so the chevron drops
            with it: the list already drops Miembros the same way. */}
        {hasGroup && (
          <IconButton
            asChild
            size="1"
            variant="ghost"
            color="gray"
            aria-label={t("fundSettings")}
          >
            <LocaleLink href={GROUP_SETTINGS_HREF}>
              {chevron(ChevronDown)}
            </LocaleLink>
          </IconButton>
        )}
      </Flex>

      <NavList variant="sidebar" items={items(PRIMARY_KEYS)} />
      <SidebarSeparator />
      <NavList
        variant="sidebar"
        items={[...items(SIDEBAR_SECONDARY_KEYS), settings]}
      />

      <Flex direction="column" style={{ marginTop: "auto", gap: 14 }}>
        <Button
          type="button"
          size="3"
          onClick={openQuick}
          style={{
            height: "auto",
            gap: 9,
            padding: 12,
            borderRadius: 12,
            fontSize: "14.5px",
            fontWeight: 600,
          }}
        >
          <Plus size={18} strokeWidth={2.2} />
          {t("record")}
        </Button>
        {/* The whole row is the trigger, so the panel behind Ajustes is also a
            click away from the person it belongs to. */}
        <SettingsPanel
          hasGroup={hasGroup}
          trigger={
            <Button
              type="button"
              variant="ghost"
              color="gray"
              highContrast
              style={{
                width: "100%",
                height: "auto",
                justifyContent: "flex-start",
                gap: 9,
                margin: 0,
                padding: 4,
                borderRadius: 10,
              }}
            >
              {/* The initial repeats the name beside it; a reader announces the
                  row once. */}
              <Avatar
                aria-hidden
                size="1"
                radius="full"
                fallback={personName.slice(0, 1).toUpperCase()}
                style={{ width: 30, height: 30, flexShrink: 0 }}
              />
              <Flex direction="column" align="start" minWidth="0">
                <Text
                  truncate
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {personName}
                </Text>
                {role && (
                  <Text color="gray" truncate style={{ fontSize: "11.5px" }}>
                    {t(role === "leader" ? "roleLeader" : "roleMember")}
                  </Text>
                )}
              </Flex>
              {chevron(ChevronRight, true)}
            </Button>
          }
        />
      </Flex>
    </Sidebar>
  );
}
