import { Heading, type HeadingProps } from "@radix-ui/themes";

import styles from "./headword.module.css";

// The one door onto a headword's exact type: 34px / 500 / -0.02em, none of it
// a Radix step (docs/voyager/DESIGN.md "Type").
export function Headword({ className, ...props }: HeadingProps) {
  return (
    <Heading
      {...props}
      className={className ? `${styles.headword} ${className}` : styles.headword}
    />
  );
}
