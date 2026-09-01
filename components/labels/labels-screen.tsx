"use client";

import { EllipsisVertical, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { deleteLabelAction } from "@/app/actions/labels";
import {
  LabelFormDialog,
  type LabelPlacement,
} from "@/components/labels/label-form-dialog";
import {
  Button,
  Card,
  ColorSwatch,
  ConfirmDialog,
  DropdownMenu,
  Flex,
  Heading,
  IconButton,
  Text,
} from "@/components/ui";
import type { LabelManagementRow } from "@/db/queries/labels";
import { useActionErrorToast } from "@/lib/use-action-toast";

// What the form dialog opens for: a blank label in one scope, or an existing
// label to edit. The placement travels either way, since the row itself never
// carries the scope it was read for.
type FormTarget = {
  placement: LabelPlacement;
  label?: { id: string; name: string; color: string | null };
};

// The confirmation names how many movements let go of the label.
type DeleteTarget = { id: string; movementCount: number };

export function LabelsScreen({
  personal,
  group,
  groupName,
  canManageGroup,
  usedColors,
}: {
  personal: LabelManagementRow[];
  group: LabelManagementRow[];
  groupName: string | null;
  canManageGroup: boolean;
  usedColors: { personal: string[]; group: string[] };
}) {
  const t = useTranslations("labels");
  // Root-scoped: `common`'s labels are full catalogue paths.
  const tKey = useTranslations();

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const onActionError = useActionErrorToast();

  const deleteAction = useAction(deleteLabelAction, {
    onSuccess() {
      toast.success(t("deleted"));
      setDeleteTarget(null);
    },
    onError: onActionError,
  });

  function addButton(placement: LabelPlacement) {
    return (
      <Button type="button" onClick={() => setFormTarget({ placement })}>
        <Plus size={16} />
        {t("add")}
      </Button>
    );
  }

  const hasGroup = groupName !== null;

  return (
    <Flex direction="column" gap="4">
      <Heading size="5">{t("title")}</Heading>

      {/* Each scope keeps its own heading and add button even while empty, so a
          leader with no label anywhere still reaches the group's create path. */}
      <Flex direction="column" gap="5">
        <LabelSection
          title={t("personalSection")}
          rows={personal}
          // A member who does not lead their group still governs their own
          // set, and their personal movements carry only personal labels.
          manageable
          note={personal.length === 0 ? t("emptyDescription") : undefined}
          addButton={addButton("personal")}
          onEdit={(label) => setFormTarget({ placement: "personal", label })}
          onDelete={setDeleteTarget}
        />
        {hasGroup && (
          <LabelSection
            title={groupName}
            rows={group}
            manageable={canManageGroup}
            note={canManageGroup ? undefined : t("leaderOnly")}
            addButton={addButton("group")}
            onEdit={(label) => setFormTarget({ placement: "group", label })}
            onDelete={setDeleteTarget}
          />
        )}
      </Flex>

      {/* Below Dialog.Content the form keys itself on the subject; closing unmounts it. */}
      <LabelFormDialog
        open={formTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFormTarget(null);
        }}
        label={
          formTarget?.label && {
            ...formTarget.label,
            placement: formTarget.placement,
          }
        }
        defaultPlacement={formTarget?.placement ?? "personal"}
        hasGroup={hasGroup}
        canManageGroup={canManageGroup}
        usedColors={usedColors}
      />

      {deleteTarget && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title={t("deleteTitle")}
          description={
            deleteTarget.movementCount > 0
              ? t("deleteWithUsageDescription", {
                  count: deleteTarget.movementCount,
                })
              : t("deleteDescription")
          }
          confirmLabel={tKey("common.delete")}
          cancelLabel={tKey("common.cancel")}
          pending={deleteAction.isPending}
          onConfirm={() => deleteAction.execute({ labelId: deleteTarget.id })}
        />
      )}
    </Flex>
  );
}

function LabelSection({
  title,
  rows,
  manageable,
  note,
  addButton,
  onEdit,
  onDelete,
}: {
  title: string;
  rows: LabelManagementRow[];
  manageable: boolean;
  note?: string;
  addButton: ReactNode;
  onEdit: (label: { id: string; name: string; color: string | null }) => void;
  onDelete: (target: DeleteTarget) => void;
}) {
  return (
    <Flex direction="column" gap="3">
      <Flex justify="between" align="center" gap="3" wrap="wrap">
        <Text size="2" weight="bold" color="gray">
          {title}
        </Text>
        {manageable && addButton}
      </Flex>
      {note && (
        <Text size="2" color="gray">
          {note}
        </Text>
      )}
      <Flex direction="column" gap="2">
        {rows.map((row) => (
          <LabelCard
            key={row.id}
            row={row}
            manageable={manageable}
            onEdit={() =>
              onEdit({ id: row.id, name: row.name, color: row.color })
            }
            onDelete={() =>
              onDelete({ id: row.id, movementCount: row.movementCount })
            }
          />
        ))}
      </Flex>
    </Flex>
  );
}

function LabelCard({
  row,
  manageable,
  onEdit,
  onDelete,
}: {
  row: LabelManagementRow;
  manageable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("labels");
  const tKey = useTranslations();

  return (
    <Card>
      <Flex justify="between" align="center" gap="3">
        <Flex align="center" gap="2" minWidth="0">
          {/* `color` is a nullable column; a row stored without one keeps its
              name and loses only the swatch. */}
          {row.color && <ColorSwatch color={row.color} label={row.name} />}
          <Flex direction="column" minWidth="0">
            <Text weight="medium" truncate>
              {row.name}
            </Text>
            <Flex gap="2" wrap="wrap">
              <Text size="2" color="gray">
                {t("usageCount", { count: row.movementCount })}
              </Text>
              <Text size="2" color="gray">
                {t("budgetCount", { count: row.budgetCount })}
              </Text>
            </Flex>
          </Flex>
        </Flex>
        {manageable && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton
                type="button"
                variant="ghost"
                color="gray"
                size="3"
                aria-label={tKey("common.actionsFor", { name: row.name })}
              >
                <EllipsisVertical size={16} />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item onSelect={onEdit}>
                {tKey("common.edit")}
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item color="red" onSelect={onDelete}>
                {tKey("common.delete")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        )}
      </Flex>
    </Card>
  );
}
