"use client";

import { EllipsisVertical, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import {
  archiveAccountAction,
  deleteAccountAction,
  restoreAccountAction,
} from "@/app/actions/accounts";
import { AccountFormDialog } from "@/components/accounts/account-form-dialog";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  Flex,
  Heading,
  IconButton,
  SegmentedControl,
  Text,
} from "@/components/ui";
import type { AccountRow } from "@/db/queries/accounts";
import { usePathname, useRouter } from "@/i18n/navigation";
import { civilDateToDate } from "@/lib/dates";
import { centsToPesos } from "@/lib/money";

type Member = { id: string; name: string };
type Group = { key: string; label: string; accounts: AccountRow[] };

// `listAccounts` already orders fund accounts first, then by member name,
// then by account name, so one pass that starts a new group on an owner
// change reproduces that grouping without a second sort to keep in step.
function groupByOwner(accounts: AccountRow[], fundLabel: string): Group[] {
  const groups: Group[] = [];

  for (const account of accounts) {
    const key = account.memberId ?? "fund";
    const current = groups.at(-1);
    if (current && current.key === key) {
      current.accounts.push(account);
    } else {
      groups.push({
        key,
        // The left join yields a name exactly when `memberId` is set.
        label: account.memberName ?? fundLabel,
        accounts: [account],
      });
    }
  }

  return groups;
}

export function AccountsScreen({
  fundId,
  accounts,
  members,
  archived,
}: {
  fundId: string;
  accounts: AccountRow[];
  members: Member[];
  archived: boolean;
}) {
  const t = useTranslations("accounts");
  const tKey = useTranslations();
  const pathname = usePathname();
  const router = useRouter();

  // "new" and a row share one dialog instance; its own key resets the form.
  const [formTarget, setFormTarget] = useState<AccountRow | "new" | null>(null);

  // Rewrites the query string instead of holding the tab in state, so a
  // reload or a shared link lands on the same tab.
  function onTabChange(value: string) {
    router.push(
      { pathname, query: value === "archived" ? { tab: "archived" } : {} },
      { scroll: false },
    );
  }

  const groups = groupByOwner(accounts, tKey("common.fund"));
  const addButton = (
    <Button type="button" onClick={() => setFormTarget("new")}>
      <Plus size={16} />
      {t("add")}
    </Button>
  );

  // Add would create an active account, so the archived tab offers none, in
  // the header or in the empty state.
  const emptyState = archived ? (
    <EmptyState title={t("archivedEmpty")} />
  ) : (
    <EmptyState
      title={t("emptyTitle")}
      description={t("emptyDescription")}
      action={addButton}
    />
  );

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center" gap="3" wrap="wrap">
        <Heading size="5">{t("title")}</Heading>
        {!archived && addButton}
      </Flex>
      <SegmentedControl.Root
        value={archived ? "archived" : "active"}
        onValueChange={onTabChange}
      >
        <SegmentedControl.Item value="active">
          {t("activeTab")}
        </SegmentedControl.Item>
        <SegmentedControl.Item value="archived">
          {t("archivedTab")}
        </SegmentedControl.Item>
      </SegmentedControl.Root>

      {accounts.length === 0 ? (
        emptyState
      ) : (
        <Flex direction="column" gap="5">
          {groups.map((group) => (
            <Flex key={group.key} direction="column" gap="3">
              <Text size="2" weight="bold" color="gray">
                {group.label}
              </Text>
              <Flex direction="column" gap="2">
                {group.accounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    fundId={fundId}
                    account={account}
                    archived={archived}
                    onEdit={() => setFormTarget(account)}
                  />
                ))}
              </Flex>
            </Flex>
          ))}
        </Flex>
      )}

      <AccountFormDialog
        fundId={fundId}
        members={members}
        open={formTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFormTarget(null);
        }}
        account={formTarget === "new" ? undefined : (formTarget ?? undefined)}
      />
    </Flex>
  );
}

function AccountCard({
  fundId,
  account,
  archived,
  onEdit,
}: {
  fundId: string;
  account: AccountRow;
  archived: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations("accounts");
  const tKey = useTranslations();
  type MessageKey = Parameters<typeof tKey>[0];
  const format = useFormatter();

  // Tracks which of the three confirmations is open.
  const [confirm, setConfirm] = useState<"archive" | "restore" | "delete" | null>(
    null,
  );

  const { execute: executeArchive, isPending: archiving } = useAction(
    archiveAccountAction,
    {
      onSuccess() {
        toast.success(t("archived"));
        setConfirm(null);
      },
      onError({ error }) {
        toast.error(
          tKey((error.serverError ?? "errors.unexpected") as MessageKey),
        );
      },
    },
  );

  const { execute: executeRestore, isPending: restoring } = useAction(
    restoreAccountAction,
    {
      onSuccess() {
        toast.success(t("restored"));
        setConfirm(null);
      },
      onError({ error }) {
        toast.error(
          tKey((error.serverError ?? "errors.unexpected") as MessageKey),
        );
      },
    },
  );

  const { execute: executeDelete, isPending: deleting } = useAction(
    deleteAccountAction,
    {
      onSuccess() {
        toast.success(t("deleted"));
        setConfirm(null);
      },
      onError({ error }) {
        toast.error(
          tKey((error.serverError ?? "errors.unexpected") as MessageKey),
        );
      },
    },
  );

  const pending = archiving || restoring || deleting;

  return (
    <Card>
      <Flex justify="between" align="start" gap="3">
        <Flex direction="column" gap="1" flexGrow="1" minWidth="0">
          <Flex align="center" gap="2" wrap="wrap">
            <Text weight="medium">{account.name}</Text>
            <Badge color={account.kind === "liability" ? "red" : "green"}>
              {t(account.kind === "liability" ? "kindLiability" : "kindAsset")}
            </Badge>
          </Flex>
          {account.institution && (
            <Text size="2" color="gray">
              {account.institution}
            </Text>
          )}
          {/* Names the opening figure, never a balance: no movement exists
              yet, so nothing on this screen derives an actual balance. */}
          <Flex align="center" gap="1" wrap="wrap">
            <Text size="2" color="gray">
              {t("openingBalanceName")}
            </Text>
            <Text size="2" color="gray">
              {t("openingBalanceRow", {
                amount: format.number(
                  centsToPesos(Math.abs(account.initialBalanceCents)),
                  "currency",
                ),
                date: format.dateTime(civilDateToDate(account.initialBalanceOn)),
              })}
            </Text>
          </Flex>
        </Flex>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              disabled={pending}
              aria-label={tKey("common.actions")}
            >
              <EllipsisVertical size={16} />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={onEdit}>
              {tKey("common.edit")}
            </DropdownMenu.Item>
            {archived ? (
              <DropdownMenu.Item onSelect={() => setConfirm("restore")}>
                {tKey("common.restore")}
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item onSelect={() => setConfirm("archive")}>
                {tKey("common.archive")}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              color="red"
              onSelect={() => setConfirm("delete")}
            >
              {tKey("common.delete")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Flex>

      {confirm === "archive" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          title={t("archiveTitle")}
          description={t("archiveDescription")}
          confirmLabel={tKey("common.archive")}
          cancelLabel={tKey("common.cancel")}
          tone="neutral"
          pending={archiving}
          onConfirm={() => executeArchive({ fundId, accountId: account.id })}
        />
      )}

      {confirm === "restore" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          title={t("restoreTitle")}
          description={t("restoreDescription")}
          confirmLabel={tKey("common.restore")}
          cancelLabel={tKey("common.cancel")}
          tone="neutral"
          pending={restoring}
          onConfirm={() => executeRestore({ fundId, accountId: account.id })}
        />
      )}

      {confirm === "delete" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          title={t("deleteTitle")}
          description={t("deleteDescription")}
          confirmLabel={tKey("common.delete")}
          cancelLabel={tKey("common.cancel")}
          pending={deleting}
          onConfirm={() => executeDelete({ fundId, accountId: account.id })}
        />
      )}
    </Card>
  );
}
