import { Text as ThemesText, type TextProps } from "@radix-ui/themes";

import styles from "./text.module.css";

// The one door onto Radix Themes' Text, so a headword's translation or
// definition can opt into Newsreader without a screen writing its own class
// (docs/reading/DESIGN.md "Type").
type SerifProps = {
  // Sets the family to Newsreader; the size and weight stay whatever `size`
  // and `weight` already say.
  serif?: boolean;
  // The exact 21px / 1.5 a translation line runs, no Radix step covers it.
  variant?: "translation";
  // The muted tone every caption, status line and secondary link takes
  // (docs/reading/DESIGN.md "Tokens"), so a screen never reaches for Radix's
  // own `color="gray"`.
  muted?: boolean;
};

function withSerif(
  serif: boolean | undefined,
  variant: SerifProps["variant"],
  muted: boolean | undefined,
  className: string | undefined,
): string | undefined {
  const classes = [
    serif || variant === "translation" ? styles.serif : undefined,
    variant === "translation" ? styles.translation : undefined,
    muted ? styles.muted : undefined,
    className,
  ].filter(Boolean);
  return classes.length > 0 ? classes.join(" ") : undefined;
}

export function Text({ serif, variant, muted, className, ...props }: TextProps & SerifProps) {
  return <ThemesText {...props} className={withSerif(serif, variant, muted, className)} />;
}
