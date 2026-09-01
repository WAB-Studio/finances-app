"use client";

import { EllipsisVertical, Info, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { deleteGoalAction } from "@/app/actions/savings-goals";
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
  Text,
} from "@/components/ui";
import type { GoalProgress } from "@/db/queries/savings-goals";
import type { TransactionFormOptions } from "@/db/queries/transaction-form";
import { centsToPesos } from "@/lib/money";
import { useActionErrorToast } from "@/lib/use-action-toast";

/**
 * The savings-goals area: each goal reads as a virtual-envelope card whose bar
 * and apartado derive server-side from the `goal_progress` view — money earmarked,
 * never moved (RF-76, RF-77). A goal is created, edited, contributed to or
 * deleted through the dialogs and the confirm below. Money stays integer cents;
 * the peso figure is display only.
 */
export function GoalsScreen({
  goals,
  options,
  hasGroup,
}: {
  goals: GoalProgress[];
  options: TransactionFormOptions;
  hasGroup: boolean;
}) {
  const t = useTranslations("goals");
  const tKey = useTranslations();
  const onActionError = useActionErrorToast();

  // "new" and a row share one dialog instance; its own key resets the form.
  const [formTarget, setFormTarget] = useState<GoalProgress | "new" | null>(
    null,
  );
  const [contributeTarget, setContributeTarget] = useState<GoalProgress | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<GoalProgress | null>(null);

  const deleteState = useAction(deleteGoalAction, {
    onSuccess() {
      toast.success(t("deleted"));
      setDeleteTarget(null);
    },
    onError: onActionError,
  });

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
        {addButton}
      </Flex>

      {goals.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={addButton}
        />
      ) : (
        <Flex direction="column" gap="3">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onContribute={() => setContributeTarget(goal)}
              onEdit={() => setFormTarget(goal)}
              onDelete={() => setDeleteTarget(goal)}
            />
          ))}
        </Flex>
      )}

      {/* The virtual-envelope hint: apartar earmarks, it never empties an account. */}
      <Callout.Root color="jade" variant="soft">
        <Callout.Icon>
          <Info size={16} aria-hidden />
        </Callout.Icon>
        <Callout.Text>{t("virtualHint")}</Callout.Text>
      </Callout.Root>

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

      {deleteTarget && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={t("deleteTitle")}
          description={t("deleteDescription")}
          confirmLabel={tKey("common.delete")}
          cancelLabel={tKey("common.cancel")}
          pending={deleteState.isPending}
          onConfirm={() => deleteState.execute({ goalId: deleteTarget.id })}
        />
      )}
    </Flex>
  );
}

function GoalCard({
  goal,
  onContribute,
  onEdit,
  onDelete,
}: {
  goal: GoalProgress;
  onContribute: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("goals");
  const tKey = useTranslations();
  const format = useFormatter();

  // The bar and the percentage read the derived apartado against the meta,
  // clamped so a reached goal never runs the bar past its track (RF-77).
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
              <DropdownMenu.Item onSelect={onEdit}>
                {tKey("common.edit")}
              </DropdownMenu.Item>
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
          <Button type="button" variant="ghost" size="2" onClick={onContribute}>
            {t("contribute")}
          </Button>
        </Flex>
      </Flex>
    </Card>
  );
}
