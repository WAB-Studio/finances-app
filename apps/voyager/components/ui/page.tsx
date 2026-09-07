import type { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";

import styles from "./page.module.css";

// The thumb-zone reserve every screen shares, ahead of the box that will sit in
// it: only the safe-area inset below `p="6"` is new here.
export function Page({ children }: { children?: ReactNode }) {
  return (
    <Flex asChild direction="column" flexGrow="1" p="6" className={styles.page}>
      <main>{children}</main>
    </Flex>
  );
}
