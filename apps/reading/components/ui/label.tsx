import { Text, type TextProps } from "@radix-ui/themes";

import styles from "./label.module.css";

// A part-of-speech label's exact type (docs/reading/DESIGN.md "Type"): the
// sense it sits on is ruled with a hairline, never boxed, so this stays text.
export function PosLabel({ className, ...props }: TextProps) {
  return (
    <Text
      as="span"
      {...props}
      className={className ? `${styles.label} ${className}` : styles.label}
    />
  );
}
