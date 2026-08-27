"use client";

import type { ReactNode } from "react";
import { Dialog, Flex } from "@radix-ui/themes";

import styles from "./nav-panel.module.css";

// The sliding panel every destination opens from. Dialog.Root supplies the
// scrim, the Escape/outside-click dismissal and the trapped focus; this file
// only pins Dialog.Content to the left edge and slides it in.
export function NavPanel({
  open,
  onOpenChange,
  title,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  trigger: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger>{trigger}</Dialog.Trigger>
      <Dialog.Content className={styles.content}>
        <Flex direction="column" gap="4">
          <Dialog.Title>{title}</Dialog.Title>
          {children}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
