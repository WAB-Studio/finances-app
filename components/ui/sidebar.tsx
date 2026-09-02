import type { ReactNode } from "react";
import { Flex, type FlexProps, Separator } from "@radix-ui/themes";

import styles from "./sidebar.module.css";

/**
 * The desktop shell's left column (`private/design-desktop/SPEC-A3.md`): 248px of
 * surface against the page, sticky so its foot stays reachable however long the
 * screen beside it runs. `display` is the caller's, because the bottom bar owns
 * navigation below `md` and this must not render there.
 */
export function Sidebar({
  label,
  display,
  children,
}: {
  label: string;
  display?: FlexProps["display"];
  children?: ReactNode;
}) {
  return (
    <Flex asChild direction="column" display={display} className={styles.sidebar}>
      <nav aria-label={label}>{children}</nav>
    </Flex>
  );
}

// The rule between the sidebar's two groups of destinations, inset from the rows.
export function SidebarSeparator() {
  return <Separator size="4" className={styles.separator} />;
}
