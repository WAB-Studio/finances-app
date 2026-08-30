"use client";

import { ChevronLeft, ChevronRight, EllipsisVertical, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { deleteBudgetAction } from "@/app/actions/budgets";
import { BudgetFormDialog } from "@/components/planning/budget-form-dialog";
import {
  Button,
  Card,
  CategoryTile,
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
import type { BudgetStatus } from "@/db/queries/budgets";
import type { TransactionFormOptions } from "@/db/queries/transaction-form";
import { usePathname, useRouter } from "@/i18n/navigation";
import { addCivilMonths, civilDateToDate } from "@/lib/dates";
import { centsToPesos } from "@/lib/money";
import { useActionErrorToast } from "@/lib/use-action-toast";

/**
 * The budgets area: each active budget reads as a card whose bar and status are
 * derived server-side from the split spend over the selected month's window
 * (RF-72, RF-73). The month selector rewrites `?month=` so the page re-derives
 * the whole list; a budget is created, edited or deleted through the dialog and
 * the confirm below. Money stays integer cents; the peso figure is display only.
 */
export function BudgetsScreen({
  budgets,
  options,
  hasGroup,
  month,
}: {
  budgets: BudgetStatus[];
  options: TransactionFormOptions;
  hasGroup: boolean;
  month: string;
}) {
  const t = useTranslations("budgets");
  const tKey = useTranslations();
  const format = useFormatter();
  const pathname = usePathname();
  const router = useRouter();
  const onActionError = useActionErrorToast();

  // "new" and a row share one dialog instance; its own key resets the form.
  const [formTarget, setFormTarget] = useState<BudgetStatus | "new" | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<BudgetStatus | null>(null);

  const deleteState = useAction(deleteBudgetAction, {
    onSuccess() {
      toast.success(t("deleted"));
      setDeleteTarget(null);
    },
    onError: onActionError,
  });

  // A name and colour per category id — children included — so a card reads its
  // title and dot without a second lookup.
  const categoryNames = new Map<string, string>();
  const categoryColors = new Map<string, string | null>();
  for (const category of options.categories) {
    categoryNames.set(category.id, category.name);
    categoryColors.set(category.id, category.color);
    for (const child of category.children) {
      categoryNames.set(child.id, child.name);
      categoryColors.set(child.id, child.color);
    }
  }

  const anchor = `${month}-01`;
  const monthLabel = format.dateTime(civilDateToDate(anchor), {
    month: "long",
    year: "numeric",
  });

  function goToMonth(delta: number) {
    const next = addCivilMonths(anchor, delta).slice(0, 7);
    router.push({ pathname, query: { month: next } }, { scroll: false });
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
        {addButton}
      </Flex>

      <Flex align="center" justify="center" gap="4">
        <IconButton
          type="button"
          variant="ghost"
          color="gray"
          size="3"
          aria-label={t("previousMonth")}
          onClick={() => goToMonth(-1)}
        >
          <ChevronLeft size={18} />
        </IconButton>
        <Text weight="bold" style={{ textTransform: "capitalize" }}>
          {monthLabel}
        </Text>
        <IconButton
          type="button"
          variant="ghost"
          color="gray"
          size="3"
          aria-label={t("nextMonth")}
          onClick={() => goToMonth(1)}
        >
          <ChevronRight size={18} />
        </IconButton>
      </Flex>

      {budgets.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={addButton}
        />
      ) : (
        <Flex direction="column" gap="3">
          {budgets.map((budget) => (
            <BudgetCard
              key={budget.id}
              budget={budget}
              title={budget.name ?? categoryNames.get(budget.categoryId) ?? ""}
              color={categoryColors.get(budget.categoryId) ?? null}
              onEdit={() => setFormTarget(budget)}
              onDelete={() => setDeleteTarget(budget)}
            />
          ))}
        </Flex>
      )}

      <BudgetFormDialog
        open={formTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFormTarget(null);
        }}
        options={options}
        budget={formTarget === "new" ? undefined : (formTarget ?? undefined)}
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
          onConfirm={() =>
            deleteState.execute({ budgetId: deleteTarget.id })
          }
        />
      )}
    </Flex>
  );
}

function BudgetCard({
  budget,
  title,
  color,
  onEdit,
  onDelete,
}: {
  budget: BudgetStatus;
  title: string;
  color: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("budgets");
  const tKey = useTranslations();
  const format = useFormatter();

  // The bar and the percentage read the derived spend against the limit, clamped
  // so an overspend never runs the bar past its track (RF-72).
  const pct =
    budget.limitCents > 0
      ? Math.min(100, Math.round((budget.spentCents / budget.limitCents) * 100))
      : budget.spentCents > 0
        ? 100
        : 0;

  const tone = budget.overspent
    ? "red"
    : budget.overThreshold
      ? "amber"
      : "gray";

  const status = budget.overspent
    ? t("overspent", {
        amount: format.number(
          centsToPesos(budget.spentCents - budget.limitCents),
          "currency",
        ),
      })
    : budget.overThreshold
      ? t("nearLimit", { pct, threshold: budget.thresholdPct })
      : t("remaining", {
          amount: format.number(centsToPesos(budget.remainingCents), "currency"),
          pct,
        });

  return (
    <Card
      style={
        budget.overspent ? { background: "var(--red-a2)" } : undefined
      }
    >
      <Flex direction="column" gap="3">
        <Flex align="center" gap="3">
          <CategoryTile color={color} size={16} />
          <Text weight="medium" style={{ flex: 1, minWidth: 0 }} truncate>
            {title}
          </Text>
          <Text
            size="2"
            weight="medium"
            color={budget.overspent ? "red" : undefined}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {format.number(centsToPesos(budget.spentCents), "currency")}
            <Text color="gray" weight="regular">
              {` / ${format.number(centsToPesos(budget.limitCents), "currency")}`}
            </Text>
          </Text>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton
                type="button"
                variant="ghost"
                color="gray"
                aria-label={tKey("common.actions")}
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
        <Progress
          value={pct}
          color={tone === "gray" ? undefined : tone}
        />
        <Text
          size="1"
          weight={tone === "gray" ? "regular" : "medium"}
          color={tone}
        >
          {status}
        </Text>
      </Flex>
    </Card>
  );
}
