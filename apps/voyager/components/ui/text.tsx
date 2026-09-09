import { Text as ThemesText, type TextProps } from "@radix-ui/themes";

import styles from "./text.module.css";

// The one door onto Radix Themes' Text, so a headword's translation or
// definition can opt into Newsreader without a screen writing its own class
// (docs/voyager/DESIGN.md "Type").
type SerifProps = {
  // Sets the family to Newsreader; the size and weight stay whatever `size`
  // and `weight` already say.
  serif?: boolean;
  // "translation" is the exact 21px / 1.5 a translation line runs, no Radix
  // step covers it. "ipa" is the 13px muted line a pronunciation runs,
  // whether it names a sense group or sits beside one sense's own
  // translation (docs/voyager/DESIGN.md "Type").
  variant?: "translation" | "ipa";
  // The muted tone every caption, status line and secondary link takes
  // (docs/voyager/DESIGN.md "Tokens"), so a screen never reaches for Radix's
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
    variant === "ipa" ? styles.ipa : undefined,
    muted || variant === "ipa" ? styles.muted : undefined,
    className,
  ].filter(Boolean);
  return classes.length > 0 ? classes.join(" ") : undefined;
}

export function Text({ serif, variant, muted, className, ...props }: TextProps & SerifProps) {
  return <ThemesText {...props} className={withSerif(serif, variant, muted, className)} />;
}
