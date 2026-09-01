"use client";

import type { LucideIcon } from "lucide-react";
import { Plus, Settings } from "lucide-react";
import { useTranslations } from "next-intl";

import {
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
  NavList,
  type NavListItem,
  NavListTrigger,
  Sidebar,
  SidebarSeparator,
  Text,
  VisuallyHidden,
} from "@/components/ui";
import { usePathname } from "@/i18n/navigation";

// The stroke thickens on the current destination, which is the only weight the
// row's icon carries; the pill behind it does the rest.
function icon(Icon: LucideIcon, current: boolean) {
  return <Icon size={19} strokeWidth={current ? 2 : 1.8} />;
}

/**
 * The desktop shell (`private/design-desktop/SPEC-A3.md`): every primary screen one
 * click away from every other, the settings panel behind one row, and quick entry
 * (RF-22) without leaving the screen. Below `md` it does not render — the bottom
 * bar owns navigation there.
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
      <Flex align="center" style={{ padding: "4px 10px 20px" }}>
        <Text
          truncate
          style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" }}
        >
          {fundName}
        </Text>
      </Flex>

      <NavList variant="sidebar" items={items(PRIMARY_KEYS)} />
      <SidebarSeparator />
      {/* The trigger is a row of the same group, so it shares the group's gap. */}
      <Flex direction="column" style={{ gap: 2 }}>
        <NavList variant="sidebar" items={items(SIDEBAR_SECONDARY_KEYS)} />
        <SettingsPanel
          hasGroup={hasGroup}
          trigger={
            <NavListTrigger
              icon={<Settings size={19} strokeWidth={1.8} />}
              label={t("settings")}
            />
          }
        />
      </Flex>

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
        <Flex align="center" px="1" style={{ gap: 9 }}>
          <Avatar
            size="1"
            radius="full"
            fallback={personName.slice(0, 1).toUpperCase()}
            style={{ width: 30, height: 30 }}
          />
          <Flex direction="column" minWidth="0">
            <Text
              truncate
              style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}
            >
              {personName}
            </Text>
            {role && (
              <Text color="gray" truncate style={{ fontSize: "11.5px" }}>
                {t(role === "leader" ? "roleLeader" : "roleMember")}
              </Text>
            )}
          </Flex>
        </Flex>
      </Flex>
    </Sidebar>
  );
}
