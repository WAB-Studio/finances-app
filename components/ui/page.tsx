import type { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";

import styles from "./page.module.css";

// The thumb-zone reserve every app page shares, ahead of the action that
// will sit in it: only the safe-area inset below `p="6"` is new here.
// `flush` yields the horizontal gutter from `md` up to a screen whose own bands
// carry it — a desktop header, filter bar and table each hold their 32px.
export function Page({
  children,
  gutter = "default",
}: {
  children?: ReactNode;
  gutter?: "default" | "flush";
}) {
  return (
    <Flex
      asChild
      direction="column"
      flexGrow="1"
      p="6"
      className={styles.page}
      data-gutter={gutter}
    >
      <main>{children}</main>
    </Flex>
  );
}
