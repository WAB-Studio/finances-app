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

const items = [
  { href: "/", key: "search" } as const,
  { href: "/registro", key: "log" } as const,
];

// docs/voyager/DESIGN.md "Viewport": the two sections the bar carries today
// — Cuenta joins once `/cuenta` exists (`## Settled`). Never an action, a
// filter or a count: `Fuente` rides as a link on the screens that carry the
// box, not a third item here.
export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <nav className={styles.nav} aria-label={t("label")}>
      {items.map(({ href, key }) => {
        const selected = pathname === href;
        return (
          <Link
            key={href}
            asChild
            underline="none"
            className={`${styles.item} ${selected ? styles.selected : styles.unselected}`}
          >
            <NextLink href={href} aria-current={selected ? "page" : undefined}>
              <TapTarget direction="column" align="center" justify="center" gap="1" size={44}>
                {key === "search" ? <SearchGlyph /> : <LogGlyph />}
                <span className={styles.label}>{t(key)}</span>
              </TapTarget>
            </NextLink>
          </Link>
        );
      })}
    </nav>
  );
}
