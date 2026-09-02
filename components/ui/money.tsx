import type { CSSProperties } from "react";
import { useFormatter } from "next-intl";

import { centsToPesos } from "@/lib/money";

// The ledger's minus is U+2212, never the hyphen a keyboard types (SPEC-A3).
const MINUS = "−";

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
  figure: { fontSize: "24px", fontWeight: 700, letterSpacing: "-0.025em" },
} satisfies Record<string, CSSProperties>;

/**
 * The one place an amount turns into a figure (RF-48, RNF-05). Cents in, pesos
 * out through `centsToPesos` and next-intl's currency format — no screen divides
 * by a hundred and none writes its own sign.
 */
export function Money({
  cents,
  tone = "plain",
  size = "row",
  signed = true,
}: {
  cents: number;
  tone?: MoneyTone;
  size?: "row" | "figure";
  signed?: boolean;
}) {
  const format = useFormatter();

  // The magnitude, never the stored sign: the accounts involved decide how an
  // amount reads, and a zero total reads without a sign whatever its tone.
  const sign =
    !signed || cents === 0
      ? ""
      : tone === "income"
        ? "+"
        : tone === "expense"
          ? MINUS
          : "";

  return (
    <span
      style={{
        ...SIZE_STYLE[size],
        color: TONE_COLOR[tone],
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {sign}
      {format.number(centsToPesos(Math.abs(cents)), "currency")}
    </span>
  );
}
