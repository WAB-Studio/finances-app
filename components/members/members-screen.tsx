"use client";

import { EllipsisVertical, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import {
  archiveMemberAction,
  deleteMemberAction,
  restoreMemberAction,
} from "@/app/actions/members";
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
import type { MemberRow } from "@/db/queries/group-members";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useActionErrorToast } from "@/lib/use-action-toast";

// The subject of a menu action, not a dialog's own field state: closing any
// of the dialogs below clears this, and reopening one always names a member.
type RowAction =
  | { kind: "archive"; member: MemberRow }
  | { kind: "restore"; member: MemberRow }
  | { kind: "delete"; member: MemberRow };

export function MembersScreen({
  members,
  currentUserId,
  archived,
}: {
  members: MemberRow[];
  currentUserId: string;
  archived: boolean;
}) {
  const t = useTranslations("members");
  // Root-scoped: `common` is a full catalogue path, not this component's namespace.
  const tKey = useTranslations();
  const onActionError = useActionErrorToast();

  const router = useRouter();
  const pathname = usePathname();

  // "new" and a row share one dialog instance; its own key resets the form.
  const [formTarget, setFormTarget] = useState<MemberRow | "new" | null>(null);
  const [rowAction, setRowAction] = useState<RowAction | null>(null);

  const archiveState = useAction(archiveMemberAction, {
    onSuccess() {
      toast.success(t("archived"));
      setRowAction(null);
    },
    onError: onActionError,
  });

  const restoreState = useAction(restoreMemberAction, {
    onSuccess() {
      toast.success(t("restored"));
      setRowAction(null);
    },
    onError: onActionError,
  });

  const deleteState = useAction(deleteMemberAction, {
    onSuccess() {
      toast.success(t("deleted"));
      setRowAction(null);
    },
    onError: onActionError,
  });

  function onTabChange(value: string) {
    router.push(
      { pathname, query: value === "archived" ? { tab: "archived" } : {} },
      { scroll: false },
    );
  }

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center" gap="3" wrap="wrap">
        <Heading size="5">{t("title")}</Heading>
        {/* Add would create an active member, so the archived tab offers none. */}
        {!archived && (
          <Button type="button" onClick={() => setFormTarget("new")}>
            <Plus size={16} />
            {t("add")}
          </Button>
        )}
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
                      {member.role === "leader" && (
                        <Badge color="blue">{t("ownerBadge")}</Badge>
                      )}
                      {isSelf && <Badge>{t("you")}</Badge>}
                      {member.userId === null && (
                        <Badge color="gray">{t("noLoginBadge")}</Badge>
                      )}
                      {member.userId === null && member.inviteEmail && (
                        <Badge color="amber">{t("pendingBadge")}</Badge>
                      )}
                    </Flex>
                  </Flex>

                  <Box flexShrink="0">
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger>
                        <IconButton
                          type="button"
                          variant="ghost"
                          color="gray"
                          size="3"
                          aria-label={tKey("common.actionsFor", {
                            name: member.name,
                          })}
                        >
                          <EllipsisVertical size={16} />
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
                                setRowAction({ kind: "delete", member })
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
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setRowAction(null);
          }}
          title={t("archiveTitle")}
          description={t("archiveDescription")}
          confirmLabel={tKey("common.archive")}
          cancelLabel={tKey("common.cancel")}
          pending={archiveState.isPending}
          tone="neutral"
          onConfirm={() =>
            archiveState.execute({ memberId: rowAction.member.id })
          }
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
            restoreState.execute({ memberId: rowAction.member.id })
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
            deleteState.execute({ memberId: rowAction.member.id })
          }
        />
      )}
    </Flex>
  );
}
