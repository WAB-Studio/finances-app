"use client";

import type { ReactNode } from "react";
import { AlertDialog, Button, Flex, Spinner } from "@radix-ui/themes";

// The only file allowed to reach for Radix Themes' AlertDialog.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  pending = false,
  tone = "danger",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  tone?: "danger" | "neutral";
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Content>
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description>{description}</AlertDialog.Description>
        <Flex gap="3" justify="end" mt="4">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" disabled={pending}>
              {cancelLabel}
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button
              color={tone === "danger" ? "red" : undefined}
              disabled={pending}
              onClick={(event) => {
                // Keeps the dialog under the caller's control instead of AlertDialog's default auto-close.
                event.preventDefault();
                onConfirm();
              }}
            >
              {pending && <Spinner />}
              {confirmLabel}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
