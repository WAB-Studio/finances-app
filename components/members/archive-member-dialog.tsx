"use client";

import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { archiveMemberAction } from "@/app/actions/members";
import {
  Box,
  Button,
  ConfirmDialog,
  Dialog,
  Flex,
  ScrollArea,
  SegmentedControl,
  Spinner,
  Text,
} from "@/components/ui";
import type { MemberRow } from "@/db/queries/members";

type ArchiveAccount = { id: string; name: string; kind: "asset" | "liability" };
type Decision = "archive" | "fund";

// Above this count the list scrolls, so the confirm control never leaves the viewport.
const SCROLL_THRESHOLD = 6;

export function ArchiveMemberDialog({
  fundId,
  member,
  accounts,
  open,
  onOpenChange,
}: {
  fundId: string;
  member: MemberRow;
  accounts: ArchiveAccount[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("members");
  const tAccounts = useTranslations("accounts");
  const tCommon = useTranslations("common");
  const tKey = useTranslations();
  type MessageKey = Parameters<typeof tKey>[0];

  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  // Tracked to catch the open transition during render, not in an effect.
  const [wasOpen, setWasOpen] = useState(open);

  // Every reopening starts blank: a leftover choice would be the app deciding, not the person.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDecisions({});
  }

  const { execute, isPending } = useAction(archiveMemberAction, {
    onSuccess() {
      toast.success(t("archived"));
      onOpenChange(false);
    },
    onError({ error }) {
      toast.error(
        tKey((error.serverError ?? "errors.unexpected") as MessageKey),
      );
    },
  });

  if (accounts.length === 0) {
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t("archiveTitle")}
        description={t("archiveDescription")}
        confirmLabel={tCommon("archive")}
        cancelLabel={tCommon("cancel")}
        pending={isPending}
        tone="neutral"
        onConfirm={() => execute({ fundId, memberId: member.id, accounts: [] })}
      />
    );
  }

  const allAnswered = accounts.every((account) => decisions[account.id]);

  function handleConfirm() {
    execute({
      fundId,
      memberId: member.id,
      accounts: accounts.map((account) => ({
        accountId: account.id,
        decision: decisions[account.id]!,
      })),
    });
  }

  const list = (
    <Flex direction="column" gap="4">
      {accounts.map((account) => (
        <Flex key={account.id} justify="between" align="center" gap="3">
          <Flex direction="column">
            <Text weight="medium">{account.name}</Text>
            <Text size="2" color="gray">
              {tAccounts(
                account.kind === "asset" ? "kindAsset" : "kindLiability",
              )}
            </Text>
          </Flex>
          <SegmentedControl.Root
            value={decisions[account.id] ?? ""}
            onValueChange={(value) =>
              setDecisions((prev) => ({
                ...prev,
                [account.id]: value as Decision,
              }))
            }
          >
            <SegmentedControl.Item value="archive">
              {t("accountToArchive")}
            </SegmentedControl.Item>
            <SegmentedControl.Item value="fund">
              {t("accountToFund")}
            </SegmentedControl.Item>
          </SegmentedControl.Root>
        </Flex>
      ))}
    </Flex>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Flex direction="column" gap="4">
          <Dialog.Title>{t("archiveTitle")}</Dialog.Title>
          <Dialog.Description>
            {t("archiveAccountsDescription")}
          </Dialog.Description>
          {accounts.length > SCROLL_THRESHOLD ? (
            <Box height="16rem">
              <ScrollArea>{list}</ScrollArea>
            </Box>
          ) : (
            list
          )}
          <Flex gap="3" justify="end">
            <Dialog.Close>
              <Button
                type="button"
                variant="soft"
                color="gray"
                disabled={isPending}
              >
                {tCommon("cancel")}
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              disabled={!allAnswered || isPending}
              onClick={handleConfirm}
            >
              {isPending && <Spinner />}
              {tCommon("archive")}
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
