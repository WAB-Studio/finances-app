"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@radix-ui/themes";

import { TapTarget } from "./tap-target";
import styles from "./bottom-nav.module.css";

// docs/voyager/DESIGN.md "Viewport": stroke-width 1.75, round caps and
// joins, fill none, 20px — read from the published boards, not guessed.
const GLYPH_PROPS = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function SearchGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function LogGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden="true">
      <path d="M5 6h14M5 12h14M5 18h9" />
    </svg>
  );
}

function AccountGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c1.4-4 4-6 7.5-6s6.1 2 7.5 6" />
    </svg>
  );
}

const GLYPHS = {
  search: SearchGlyph,
  log: LogGlyph,
  account: AccountGlyph,
} as const;

const items = [
  { href: "/", key: "search" } as const,
  { href: "/registro", key: "log" } as const,
  { href: "/cuenta", key: "account" } as const,
];

// docs/voyager/DESIGN.md "Viewport": the three sections the bar carries
// (`## Settled`: it shipped with two, Cuenta joined with the account
// slice). Never an action, a filter or a count: `Fuente` rides as a link on
// the screens that carry the box, not a fourth item here.
export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <nav className={styles.nav} aria-label={t("label")}>
      {items.map(({ href, key }) => {
        const selected = pathname === href;
        const Glyph = GLYPHS[key];
        return (
          <Link
            key={href}
            asChild
            underline="none"
            className={`${styles.item} ${selected ? styles.selected : styles.unselected}`}
          >
            <NextLink href={href} aria-current={selected ? "page" : undefined}>
              <TapTarget direction="column" align="center" justify="center" gap="1" size={44}>
                <Glyph />
                <span className={styles.label}>{t(key)}</span>
              </TapTarget>
            </NextLink>
          </Link>
        );
      })}
    </nav>
  );
}
