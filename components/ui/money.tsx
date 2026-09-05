import type { CSSProperties } from "react";
import { useLocale } from "next-intl";

import {
  BASE_CURRENCY,
  type CurrencyCode,
  minorUnitExponent,
} from "@/lib/currency";
import { FORMAT_LOCALE, type Locale } from "@/lib/locales";
import { centsToPesos } from "@/lib/money";

// The ledger's minus is U+2212, never the hyphen a keyboard types (SPEC-A3).
const MINUS = "−";

// U+2248, the mark a figure the issuer has not billed yet carries (RF-123).
const APPROXIMATELY = "≈";

// Built per language and currency, kept because a screen draws fifty figures
// and constructing a formatter costs more than the figure it writes.
const FORMATTERS = new Map<string, Intl.NumberFormat>();

function currencyFormatter(
  locale: Locale,
  currency: CurrencyCode,
  exponent: number,
): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  const cached = FORMATTERS.get(key);
  if (cached) return cached;

  // Not `useFormatter`: a named format carries no locale, and the figure is
  // drawn for the region the language belongs to, not for the bare language.
  const formatter = new Intl.NumberFormat(FORMAT_LOCALE[locale], {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });

  FORMATTERS.set(key, formatter);
  return formatter;
}

export type MoneyTone = "expense" | "income" | "transfer" | "plain";

const TONE_COLOR: Record<MoneyTone, string | undefined> = {
  income: "var(--accent-11)",
  expense: "var(--gray-12)",
  transfer: "var(--gray-11)",
  // Inherits the surrounding ink, so a tile or a heading keeps its own colour.
  plain: undefined,
};

const SIZE_STYLE = {
  row: { fontSize: "13.5px", fontWeight: 600 },
  figure: { fontSize: "23px", fontWeight: 700, letterSpacing: "-0.025em" },
  // The one figure a detail screen is built around (SPEC-A3).
  hero: { fontSize: "40px", fontWeight: 700, letterSpacing: "-0.03em" },
  // Takes the surrounding type, for a heading or a chip that already sets it and
  // re-sizes itself across breakpoints.
  inherit: {},
} satisfies Record<string, CSSProperties>;

type MoneyStyle = {
  // Absent falls back to the settlement currency. A later slice makes it
  // required, once the fifty call sites below carry the currency of their row.
  currency?: CurrencyCode;
  tone?: MoneyTone;
  size?: "row" | "figure" | "hero" | "inherit";
  signed?: boolean;
  // Marks the figure as what a person expects to be billed, not what was
  // billed (RF-123). No screen writes that mark itself.
  estimate?: boolean;
};

export type MoneyProps = MoneyStyle &
  // `cents` is the COP-only spelling, marked to retire with the wrappers in
  // `lib/money`: a hundredth of a peso, where `minor` is the peso itself.
  ({ minor: number; cents?: never } | { cents: number; minor?: never });

/**
 * The one place an amount turns into a figure (RF-48, RF-121, RNF-05). Minor
 * units in, the currency's own figure out — no screen divides by the minor
 * unit, none names a currency and none writes its own sign.
 */
export function Money(props: MoneyProps) {
  const {
    currency = BASE_CURRENCY,
    tone = "plain",
    size = "row",
    signed = true,
    estimate = false,
  } = props;
  const locale = useLocale();

  const amountMinor =
    props.minor === undefined ? centsToPesos(props.cents) : props.minor;

  // A movement's sign comes from the accounts it touches, which is what its tone
  // says; a plain figure has no tone to read it from, so a signed one carries the
  // sign it stores — a balance below zero is an overdraft, not an amount. A zero
  // total reads without a sign whatever its tone.
  const sign =
    !signed || amountMinor === 0
      ? ""
      : tone === "income"
        ? "+"
        : tone === "expense"
          ? MINUS
          : amountMinor < 0
            ? MINUS
            : "";

  // Presentation, and the only division here: the stored integer never leaves
  // the minor unit, the formatter takes the major one.
  const exponent = minorUnitExponent(currency);
  const figure = Math.abs(amountMinor) / 10 ** exponent;

  return (
    <span
      style={{
        ...SIZE_STYLE[size],
        color: TONE_COLOR[tone],
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {estimate ? `${APPROXIMATELY} ` : ""}
      {sign}
      {currencyFormatter(locale, currency, exponent).format(figure)}
    </span>
  );
}
