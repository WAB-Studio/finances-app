import type { LucideIcon } from "lucide-react";
import {
  ArrowRightLeft,
  ChartLine,
  Database,
  House,
  Inbox,
  ScrollText,
  Tag,
  Tags,
  Target,
  Users,
  Wallet,
  Webhook,
} from "lucide-react";

/**
 * Every destination the shell can reach, written once. Each surface below picks
 * an order out of it; none of them owns a path or an icon. A screen shipped
 * without an entry here is a screen no surface offers, which is how `/movements`
 * and `/reports` stayed unreachable on a laptop.
 *
 * The key is also its own message key under the `nav` namespace.
 */
const CATALOGUE = {
  home: { href: "/", icon: House },
  movements: { href: "/movements", icon: ArrowRightLeft },
  planning: { href: "/planning", icon: Target },
  reports: { href: "/reports", icon: ChartLine },
  inbox: { href: "/inbox", icon: Inbox },
  members: { href: "/settings/members", icon: Users },
  accounts: { href: "/settings/accounts", icon: Wallet },
  categories: { href: "/settings/categories", icon: Tags },
  labels: { href: "/settings/labels", icon: Tag },
  webhooks: { href: "/settings/webhooks", icon: Webhook },
  data: { href: "/settings/data", icon: Database },
  audit: { href: "/settings/audit", icon: ScrollText },
} as const satisfies Record<string, { href: string; icon: LucideIcon }>;

export type DestinationKey = keyof typeof CATALOGUE;

export type Destination = {
  key: DestinationKey;
  href: string;
  icon: LucideIcon;
};

// The phone's bottom bar: the frequent three, around the raised action.
export const TAB_KEYS = ["home", "movements", "planning"] as const;

// The sidebar's own list, in the order `private/design-desktop/SPEC-A3.md` fixes.
export const PRIMARY_KEYS = [
  "home",
  "movements",
  "planning",
  "reports",
  "inbox",
] as const;

// What the sidebar keeps below its separator, beside the settings panel's trigger.
export const SIDEBAR_SECONDARY_KEYS = ["accounts"] as const;

// The settings panel, the only surface that reaches the rest of the app.
export const SETTINGS_KEYS = [
  "inbox",
  "members",
  "accounts",
  "categories",
  "labels",
  "webhooks",
  "data",
  "audit",
] as const;

// One group per user with no switching (RF-55), so every destination is a fixed
// path. Members only exist inside a group, so that entry drops without one.
export function destinations(
  keys: readonly DestinationKey[],
  hasGroup: boolean,
): Destination[] {
  return keys
    .filter((key) => key !== "members" || hasGroup)
    .map((key) => ({ key, ...CATALOGUE[key] }));
}

// A movement's detail page still lights Movimientos; only the root matches itself.
export function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
