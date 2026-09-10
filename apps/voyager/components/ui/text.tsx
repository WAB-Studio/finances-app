import { Text as ThemesText, type TextProps } from "@radix-ui/themes";

import styles from "./text.module.css";

// The one door onto Radix Themes' Text, so a headword's translation or
// definition can opt into Newsreader without a screen writing its own class
// (docs/voyager/DESIGN.md "Type").
type SerifProps = {
  // Sets the family to Newsreader; the size and weight stay whatever `size`
  // and `weight` already say.
  serif?: boolean;
  // `translation`: 21px / 1.5, a translation line. `breakTitle`/`breakBody`:
  // `RegistroVaciarConfirmar`'s own break — 15px/600 and 15px/1.6 — neither
  // a Radix step covers. `caption`: its two destructive options' own lines
  // underneath, 13px/1.5.
  variant?: "translation" | "breakTitle" | "breakBody" | "caption";
  // The muted tone every caption, status line and secondary link takes
  // (docs/voyager/DESIGN.md "Tokens"), so a screen never reaches for Radix's
  // own `color="gray"`. `"quietest"` is the second, dimmer muted role the
  // same table names — first needed by `RegistroVaciarConfirmar`'s captions.
  muted?: boolean | "quietest";
};

function withSerif(
  serif: boolean | undefined,
  variant: SerifProps["variant"],
  muted: SerifProps["muted"],
  className: string | undefined,
): string | undefined {
  const classes = [
    serif || variant === "translation" ? styles.serif : undefined,
    variant === "translation" ? styles.translation : undefined,
    variant === "breakTitle" ? styles.breakTitle : undefined,
    variant === "breakBody" ? styles.breakBody : undefined,
    variant === "caption" ? styles.caption : undefined,
    muted === true ? styles.muted : undefined,
    muted === "quietest" ? styles.mutedQuietest : undefined,
    className,
  ].filter(Boolean);
  return classes.length > 0 ? classes.join(" ") : undefined;
}

export function Text({ serif, variant, muted, className, ...props }: TextProps & SerifProps) {
  return <ThemesText {...props} className={withSerif(serif, variant, muted, className)} />;
}
