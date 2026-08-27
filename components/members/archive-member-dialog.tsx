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
  // Root-scoped: the action's error is a full catalogue path, and `common` is
  // not this component's namespace.
  const tKey = useTranslations();
  type MessageKey = Parameters<typeof tKey>[0];

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
        confirmLabel={tKey("common.archive")}
        cancelLabel={tKey("common.cancel")}
        pending={isPending}
        tone="neutral"
        onConfirm={() => execute({ fundId, memberId: member.id, accounts: [] })}
      />
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Flex direction="column" gap="4">
          <Dialog.Title>{t("archiveTitle")}</Dialog.Title>
          <Dialog.Description>
            {t("archiveAccountsDescription")}
          </Dialog.Description>
          {/* Closing unmounts the content, so every reopening starts blank: a
              leftover choice would be the app deciding, not the person. */}
          <AccountDecisions
            accounts={accounts}
            pending={isPending}
            onConfirm={(decisions) =>
              execute({
                fundId,
                memberId: member.id,
                accounts: accounts.map((account) => ({
                  accountId: account.id,
                  decision: decisions[account.id]!,
                })),
              })
            }
          />
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function AccountDecisions({
  accounts,
  pending,
  onConfirm,
}: {
  accounts: ArchiveAccount[];
  pending: boolean;
  onConfirm: (decisions: Record<string, Decision>) => void;
}) {
  const t = useTranslations("members");
  const tAccounts = useTranslations("accounts");
  // Root-scoped: `common` is not this component's namespace.
  const tKey = useTranslations();

  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const allAnswered = accounts.every((account) => decisions[account.id]);

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
    <>
      {accounts.length > SCROLL_THRESHOLD ? (
        <Box height="16rem">
          <ScrollArea>{list}</ScrollArea>
        </Box>
      ) : (
        list
      )}
      <Flex gap="3" justify="end">
        <Dialog.Close>
          <Button type="button" variant="soft" color="gray" disabled={pending}>
            {tKey("common.cancel")}
          </Button>
        </Dialog.Close>
        <Button
          type="button"
          disabled={!allAnswered || pending}
          onClick={() => onConfirm(decisions)}
        >
          {pending && <Spinner />}
          {tKey("common.archive")}
        </Button>
      </Flex>
    </>
  );
}
