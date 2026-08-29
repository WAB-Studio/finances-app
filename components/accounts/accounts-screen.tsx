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
import { useActionErrorToast } from "@/lib/use-action-toast";

type Group = { key: string; label: string; accounts: AccountRow[] };

// The subject of a menu action, not a dialog's own field state: closing any
// of the dialogs below clears this, and reopening one always names an account.
type RowAction =
  | { kind: "archive"; account: AccountRow }
  | { kind: "restore"; account: AccountRow }
  | { kind: "delete"; account: AccountRow };

// `listAccounts` already orders personal accounts ahead of the group's, then by
// name, so one pass that starts a new group on a placement change reproduces
// that split without a second sort to keep in step (RF-60).
function groupByPlacement(
  accounts: AccountRow[],
  personalLabel: string,
  groupLabel: string,
): Group[] {
  const groups: Group[] = [];

  for (const account of accounts) {
    const key = account.ownerUserId ? "personal" : "group";
    const current = groups.at(-1);
    if (current && current.key === key) {
      current.accounts.push(account);
    } else {
      groups.push({
        key,
        label: key === "personal" ? personalLabel : groupLabel,
        accounts: [account],
      });
    }
  }

  return groups;
}

export function AccountsScreen({
  accounts,
  groupName,
  archived,
}: {
  accounts: AccountRow[];
  groupName: string | null;
  archived: boolean;
}) {
  const t = useTranslations("accounts");
  const tKey = useTranslations();
  const pathname = usePathname();
  const router = useRouter();
  const onActionError = useActionErrorToast();

  // "new" and a row share one dialog instance; its own key resets the form.
  const [formTarget, setFormTarget] = useState<AccountRow | "new" | null>(null);
  const [rowAction, setRowAction] = useState<RowAction | null>(null);

  const archiveState = useAction(archiveAccountAction, {
    onSuccess() {
      toast.success(t("archived"));
      setRowAction(null);
    },
    onError: onActionError,
  });

  const restoreState = useAction(restoreAccountAction, {
    onSuccess() {
      toast.success(t("restored"));
      setRowAction(null);
    },
    onError: onActionError,
  });

  const deleteState = useAction(deleteAccountAction, {
    onSuccess() {
      toast.success(t("deleted"));
      setRowAction(null);
    },
    onError: onActionError,
  });

  // Rewrites the query string instead of holding the tab in state, so a
  // reload or a shared link lands on the same tab.
  function onTabChange(value: string) {
    router.push(
      { pathname, query: value === "archived" ? { tab: "archived" } : {} },
      { scroll: false },
    );
  }

  const groups = groupByPlacement(
    accounts,
    t("ownerPersonal"),
    groupName ?? tKey("common.fund"),
  );
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
                    account={account}
                    archived={archived}
                    onEdit={() => setFormTarget(account)}
                    onArchive={() => setRowAction({ kind: "archive", account })}
                    onRestore={() => setRowAction({ kind: "restore", account })}
                    onDelete={() => setRowAction({ kind: "delete", account })}
                  />
                ))}
              </Flex>
            </Flex>
          ))}
        </Flex>
      )}

      <AccountFormDialog
        hasGroup={groupName !== null}
        open={formTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFormTarget(null);
        }}
        account={formTarget === "new" ? undefined : (formTarget ?? undefined)}
      />

      {rowAction?.kind === "archive" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRowAction(null)}
          title={t("archiveTitle")}
          description={t("archiveDescription")}
          confirmLabel={tKey("common.archive")}
          cancelLabel={tKey("common.cancel")}
          tone="neutral"
          pending={archiveState.isPending}
          onConfirm={() =>
            archiveState.execute({ accountId: rowAction.account.id })
          }
        />
      )}

      {rowAction?.kind === "restore" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRowAction(null)}
          title={t("restoreTitle")}
          description={t("restoreDescription")}
          confirmLabel={tKey("common.restore")}
          cancelLabel={tKey("common.cancel")}
          tone="neutral"
          pending={restoreState.isPending}
          onConfirm={() =>
            restoreState.execute({ accountId: rowAction.account.id })
          }
        />
      )}

      {rowAction?.kind === "delete" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRowAction(null)}
          title={t("deleteTitle")}
          description={t("deleteDescription")}
          confirmLabel={tKey("common.delete")}
          cancelLabel={tKey("common.cancel")}
          pending={deleteState.isPending}
          onConfirm={() =>
            deleteState.execute({ accountId: rowAction.account.id })
          }
        />
      )}
    </Flex>
  );
}

function AccountCard({
  account,
  archived,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  account: AccountRow;
  archived: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("accounts");
  const tKey = useTranslations();
  const format = useFormatter();

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
              {t("openingBalanceLabel")}
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
              size="3"
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
              <DropdownMenu.Item onSelect={onRestore}>
                {tKey("common.restore")}
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item onSelect={onArchive}>
                {tKey("common.archive")}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item color="red" onSelect={onDelete}>
              {tKey("common.delete")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Flex>
    </Card>
  );
}
