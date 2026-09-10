import { Box as ThemesBox, type BoxProps } from "@radix-ui/themes";

import styles from "./box.module.css";

// The one door onto Radix Themes' Box. `rail` is the `PalabraConFlexion`
// board's own offer block — a 2px border-inline-start and an indent, 16px on
// desktop and 12px on mobile — the shape that says "this is offered beneath
// the entry above it," never a card or a border box.
export function Box({ className, rail, ...props }: BoxProps & { rail?: boolean }) {
  const base = rail ? styles.rail : undefined;
  const merged = [base, className].filter(Boolean).join(" ") || undefined;
  return <ThemesBox {...props} className={merged} />;
}
