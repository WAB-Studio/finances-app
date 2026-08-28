"use client";

import type { ComponentProps } from "react";
import { SegmentedControl } from "@radix-ui/themes";

import styles from "./stacked-segmented-control.module.css";

// A SegmentedControl that stacks its options below `sm`. Radix Themes' own
// stylesheet sets `min-width: max-content` on the root, so a two-option
// control can never shrink narrower than both labels on one line; a
// shortened label reads worse than an option that wraps to its own row.
// Takes no `className`, so no caller restyles it away from that guarantee.
// `size` is fixed too: the stacked stylesheet states a height, and only size 3
// keeps it on the tap-target floor the rest of the app's controls sit on.
function Root(props: ComponentProps<typeof SegmentedControl.Root>) {
  return <SegmentedControl.Root {...props} size="3" className={styles.root} />;
}

function Item(props: ComponentProps<typeof SegmentedControl.Item>) {
  return <SegmentedControl.Item {...props} className={styles.item} />;
}

export const StackedSegmentedControl = { Root, Item };
