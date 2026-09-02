"use client";

import { EllipsisVertical, Info, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import {
  archiveGoalAction,
  deleteGoalAction,
  restoreGoalAction,
} from "@/app/actions/savings-goals";
import { GoalContributeDialog } from "@/components/planning/goal-contribute-dialog";
import { GoalFormDialog } from "@/components/planning/goal-form-dialog";
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  Flex,
  FundChip,
  Heading,
  IconButton,
  Progress,
  SegmentedControl,
  Text,
} from "@/components/ui";
import type { GoalProgress } from "@/db/queries/savings-goals";
import type { TransactionFormOptions } from "@/db/queries/transaction-form";
import { usePathname, useRouter } from "@/i18n/navigation";
import { centsToPesos } from "@/lib/money";
import { useActionErrorToast } from "@/lib/use-action-toast";

// The subject of a menu action, not a dialog's own field state: closing any of
// the dialogs below clears this, and reopening one always names a goal.
type RowAction =
  | { kind: "archive"; goal: GoalProgress }
  | { kind: "restore"; goal: GoalProgress }
  | { kind: "delete"; goal: GoalProgress };

/**
 * The savings-goals area: each goal reads as a virtual-envelope card whose bar
 * and apartado derive server-side from the `goal_progress` view — money earmarked,
 * never moved (RF-76, RF-87). A goal is created, edited, contributed to, archived,
 * restored or deleted through the dialogs and the confirms below (RF-120). Money
 * stays integer cents; the peso figure is display only.
 */
export function GoalsScreen({
  goals,
  options,
  hasGroup,
  archived,
}: {
  goals: GoalProgress[];
  options: TransactionFormOptions;
  hasGroup: boolean;
  archived: boolean;
}) {
  const t = useTranslations("goals");
  const tKey = useTranslations();
  const onActionError = useActionErrorToast();

  const router = useRouter();
  const pathname = usePathname();

  // "new" and a row share one dialog instance; its own key resets the form.
  const [formTarget, setFormTarget] = useState<GoalProgress | "new" | null>(
    null,
  );
  const [contributeTarget, setContributeTarget] = useState<GoalProgress | null>(
    null,
  );
  const [rowAction, setRowAction] = useState<RowAction | null>(null);

  const archiveState = useAction(archiveGoalAction, {
    onSuccess() {
      toast.success(t("archived"));
      setRowAction(null);
    },
    onError: onActionError,
  });

  const restoreState = useAction(restoreGoalAction, {
    onSuccess() {
      toast.success(t("restored"));
      setRowAction(null);
    },
    onError: onActionError,
  });

  const deleteState = useAction(deleteGoalAction, {
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

  const addButton = (
    <Button type="button" onClick={() => setFormTarget("new")}>
      <Plus size={16} />
      {t("add")}
    </Button>
  );

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center" gap="3" wrap="wrap">
        <Flex align="center" gap="2">
          <Heading size="5">{t("title")}</Heading>
          {hasGroup && <FundChip label={tKey("fund.label")} />}
        </Flex>
        {/* Add would create an active goal, so the archived tab offers none. */}
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

      {goals.length === 0 ? (
        archived ? (
          <EmptyState title={t("archivedEmpty")} />
        ) : (
          <EmptyState
            title={t("emptyTitle")}
            description={t("emptyDescription")}
            action={addButton}
          />
        )
      ) : (
        <Flex direction="column" gap="3">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              archived={archived}
              onContribute={() => setContributeTarget(goal)}
              onEdit={() => setFormTarget(goal)}
              onArchive={() => setRowAction({ kind: "archive", goal })}
              onRestore={() => setRowAction({ kind: "restore", goal })}
              onDelete={() => setRowAction({ kind: "delete", goal })}
            />
          ))}
        </Flex>
      )}

      {/* The hint answers Aportar, which the archived tab no longer offers. */}
      {!archived && (
        <Callout.Root color="jade" variant="soft">
          <Callout.Icon>
            <Info size={16} aria-hidden />
          </Callout.Icon>
          <Callout.Text>{t("virtualHint")}</Callout.Text>
        </Callout.Root>
      )}

      <GoalFormDialog
        open={formTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFormTarget(null);
        }}
        options={options}
        goal={formTarget === "new" ? undefined : (formTarget ?? undefined)}
      />

      <GoalContributeDialog
        open={contributeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setContributeTarget(null);
        }}
        goal={contributeTarget ?? undefined}
      />

      {rowAction?.kind === "archive" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRowAction(null)}
          title={t("archiveTitle")}
          description={t("archiveDescription")}
          confirmLabel={tKey("common.archive")}
          cancelLabel={tKey("common.cancel")}
          pending={archiveState.isPending}
          tone="neutral"
          onConfirm={() => archiveState.execute({ goalId: rowAction.goal.id })}
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
          pending={restoreState.isPending}
          tone="neutral"
          onConfirm={() => restoreState.execute({ goalId: rowAction.goal.id })}
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
          onConfirm={() => deleteState.execute({ goalId: rowAction.goal.id })}
        />
      )}
    </Flex>
  );
}

function GoalCard({
  goal,
  archived,
  onContribute,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  goal: GoalProgress;
  archived: boolean;
  onContribute: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("goals");
  const tKey = useTranslations();
  const format = useFormatter();

  // The bar and the percentage read the derived apartado against the meta,
  // clamped so a reached goal never runs the bar past its track (RF-87).
  const pct =
    goal.targetAmountCents > 0
      ? Math.min(100, Math.round((goal.savedCents / goal.targetAmountCents) * 100))
      : goal.savedCents > 0
        ? 100
        : 0;

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Flex align="center" gap="3">
          <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
            <Text weight="medium" truncate>
              {goal.name}
            </Text>
            <Text size="1" color="gray">
              {t("meta", {
                amount: format.number(
                  centsToPesos(goal.targetAmountCents),
                  "currency",
                ),
              })}
            </Text>
          </Flex>
          <Badge
            color={goal.reachedTarget ? "jade" : "gray"}
            variant="soft"
            radius="full"
          >
            {t("percent", { pct })}
          </Badge>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton
                type="button"
                variant="ghost"
                color="gray"
                aria-label={tKey("common.actionsFor", { name: goal.name })}
              >
                <EllipsisVertical size={16} />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {/* An archived goal is read-only: the way back is all it offers,
                  and a mistake is corrected by restoring it first. */}
              {archived ? (
                <DropdownMenu.Item onSelect={onRestore}>
                  {tKey("common.restore")}
                </DropdownMenu.Item>
              ) : (
                <>
                  <DropdownMenu.Item onSelect={onEdit}>
                    {tKey("common.edit")}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={onArchive}>
                    {tKey("common.archive")}
                  </DropdownMenu.Item>
                </>
              )}
              <DropdownMenu.Item color="red" onSelect={onDelete}>
                {tKey("common.delete")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Flex>

        <Progress value={pct} color={goal.reachedTarget ? "jade" : undefined} />

        <Flex align="center" justify="between" gap="3">
          <Text size="2" color="gray">
            {t("apartado")}{" "}
            <Text
              color={goal.reachedTarget ? "jade" : undefined}
              weight="medium"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {format.number(centsToPesos(goal.savedCents), "currency")}
            </Text>
          </Text>
          {/* Archiving is what stops money reaching the goal, so it stops here too. */}
          {!archived && (
            <Button
              type="button"
              variant="ghost"
              size="2"
              onClick={onContribute}
            >
              {t("contribute")}
            </Button>
          )}
        </Flex>
      </Flex>
    </Card>
  );
}
