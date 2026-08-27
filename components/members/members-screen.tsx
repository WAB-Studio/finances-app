"use client";

import { MoreVertical, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { deleteMemberAction, restoreMemberAction } from "@/app/actions/members";
import { ArchiveMemberDialog } from "@/components/members/archive-member-dialog";
import { MemberFormDialog } from "@/components/members/member-form-dialog";
import {
  Badge,
  Box,
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
import type { MemberRow } from "@/db/queries/members";
import { usePathname, useRouter } from "@/i18n/navigation";

type MemberAccount = { id: string; name: string; kind: "asset" | "liability" };

// The subject of a menu action, not a dialog's own field state: closing any
// of the dialogs below clears this, and reopening one always names a member.
type RowAction =
  | { kind: "archive"; member: MemberRow }
  | { kind: "restore"; member: MemberRow }
  | { kind: "delete"; member: MemberRow }
  | { kind: "deleteBlocked"; member: MemberRow };

export function MembersScreen({
  fundId,
  members,
  currentUserId,
  archived,
  memberAccounts,
}: {
  fundId: string;
  members: MemberRow[];
  currentUserId: string;
  archived: boolean;
  memberAccounts: Record<string, MemberAccount[]>;
}) {
  const t = useTranslations("members");
  // Root-scoped: `common` and the actions' errors are full catalogue paths.
  const tKey = useTranslations();
  type MessageKey = Parameters<typeof tKey>[0];

  const router = useRouter();
  const pathname = usePathname();

  // "new" and a row share one dialog instance; its own key resets the form.
  const [formTarget, setFormTarget] = useState<MemberRow | "new" | null>(null);
  const [rowAction, setRowAction] = useState<RowAction | null>(null);

  const restoreState = useAction(restoreMemberAction, {
    onSuccess() {
      toast.success(t("restored"));
      setRowAction(null);
    },
    onError({ error }) {
      toast.error(
        tKey((error.serverError ?? "errors.unexpected") as MessageKey),
      );
    },
  });

  const deleteState = useAction(deleteMemberAction, {
    onSuccess() {
      toast.success(t("deleted"));
      setRowAction(null);
    },
    onError({ error }) {
      toast.error(
        tKey((error.serverError ?? "errors.unexpected") as MessageKey),
      );
    },
  });

  function onTabChange(value: string) {
    router.push(
      { pathname, query: value === "archived" ? { tab: "archived" } : {} },
      { scroll: false },
    );
  }

  return (
    <Flex asChild direction="column" gap="4" p={{ initial: "4", sm: "6" }}>
      <main>
        <Flex justify="between" align="center" gap="3" wrap="wrap">
          <Heading size="5">{t("title")}</Heading>
          <Button type="button" onClick={() => setFormTarget("new")}>
            <Plus size={16} />
            {t("add")}
          </Button>
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

        {archived && members.length === 0 ? (
          <EmptyState title={t("archivedEmpty")} />
        ) : (
          <Flex direction="column" gap="3">
            {members.map((member) => {
              const isSelf = member.userId === currentUserId;

              return (
                <Card key={member.id}>
                  <Flex justify="between" align="center" gap="3">
                    <Flex direction="column" gap="1" flexGrow="1" minWidth="0">
                      <Flex align="center" gap="2" wrap="wrap">
                        <Text weight="medium" truncate>
                          {member.name}
                        </Text>
                        {member.role === "owner" && (
                          <Badge color="blue">{t("ownerBadge")}</Badge>
                        )}
                        {isSelf && <Badge>{t("you")}</Badge>}
                        {member.userId === null && (
                          <Badge color="gray">{t("noLoginBadge")}</Badge>
                        )}
                      </Flex>
                      <Text size="2" color="gray">
                        {t("accountCount", { count: member.activeAccountCount })}
                      </Text>
                    </Flex>

                    <Box flexShrink="0">
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger>
                          <IconButton
                            type="button"
                            variant="ghost"
                            color="gray"
                            size="3"
                            aria-label={tKey("common.actions")}
                          >
                            <MoreVertical size={18} />
                          </IconButton>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content>
                          <DropdownMenu.Item
                            onSelect={() => setFormTarget(member)}
                          >
                            {tKey("common.edit")}
                          </DropdownMenu.Item>
                          {/* The database refuses both on the session user's own row: offering them would only fail. */}
                          {!isSelf && (
                            <>
                              <DropdownMenu.Separator />
                              {member.archivedAt ? (
                                <DropdownMenu.Item
                                  onSelect={() =>
                                    setRowAction({ kind: "restore", member })
                                  }
                                >
                                  {tKey("common.restore")}
                                </DropdownMenu.Item>
                              ) : (
                                <DropdownMenu.Item
                                  onSelect={() =>
                                    setRowAction({ kind: "archive", member })
                                  }
                                >
                                  {tKey("common.archive")}
                                </DropdownMenu.Item>
                              )}
                              <DropdownMenu.Item
                                color="red"
                                onSelect={() =>
                                  setRowAction({
                                    kind:
                                      member.activeAccountCount > 0
                                        ? "deleteBlocked"
                                        : "delete",
                                    member,
                                  })
                                }
                              >
                                {tKey("common.delete")}
                              </DropdownMenu.Item>
                            </>
                          )}
                        </DropdownMenu.Content>
                      </DropdownMenu.Root>
                    </Box>
                  </Flex>
                </Card>
              );
            })}
          </Flex>
        )}

        <MemberFormDialog
          fundId={fundId}
          open={formTarget !== null}
          onOpenChange={(open) => {
            if (!open) setFormTarget(null);
          }}
          member={
            formTarget === null || formTarget === "new"
              ? undefined
              : { id: formTarget.id, name: formTarget.name }
          }
        />

        {rowAction?.kind === "archive" && (
          <ArchiveMemberDialog
            fundId={fundId}
            member={rowAction.member}
            accounts={memberAccounts[rowAction.member.id] ?? []}
            open
            onOpenChange={(open) => {
              if (!open) setRowAction(null);
            }}
          />
        )}

        {rowAction?.kind === "restore" && (
          <ConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) setRowAction(null);
            }}
            title={t("restoreTitle")}
            description={t("restoreDescription")}
            confirmLabel={tKey("common.restore")}
            cancelLabel={tKey("common.cancel")}
            pending={restoreState.isPending}
            tone="neutral"
            onConfirm={() =>
              restoreState.execute({ fundId, memberId: rowAction.member.id })
            }
          />
        )}

        {rowAction?.kind === "delete" && (
          <ConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) setRowAction(null);
            }}
            title={t("deleteTitle")}
            description={t("deleteDescription")}
            confirmLabel={tKey("common.delete")}
            cancelLabel={tKey("common.cancel")}
            pending={deleteState.isPending}
            onConfirm={() =>
              deleteState.execute({ fundId, memberId: rowAction.member.id })
            }
          />
        )}

        {/* The foreign key would refuse this delete; nothing here calls the action. */}
        {rowAction?.kind === "deleteBlocked" && (
          <ConfirmDialog
            open
            onOpenChange={() => setRowAction(null)}
            title={t("deleteTitle")}
            description={t("deleteBlocked")}
            confirmLabel={tKey("common.cancel")}
            cancelLabel={tKey("common.cancel")}
            tone="neutral"
            onConfirm={() => setRowAction(null)}
          />
        )}
      </main>
    </Flex>
  );
}
