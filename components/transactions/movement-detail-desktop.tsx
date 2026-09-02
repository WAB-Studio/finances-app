"use client";

import { CheckIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { markMovementReviewedAction } from "@/app/actions/recurring-rules";
import { deleteTransactionAction } from "@/app/actions/transactions";
import { MovementForm } from "@/components/transactions/movement-form";
import {
  Badge,
  Button,
  CategoryTile,
  ConfirmDialog,
  Dialog,
  Flex,
  Money,
  Panel,
  ScreenHeader,
  Separator,
  Text,
  VisuallyHidden,
} from "@/components/ui";
import type { MoneyTone } from "@/components/ui";
import type { TransactionFormOptions } from "@/db/queries/transaction-form";
import type { TransactionListRow } from "@/db/queries/transactions";
import { useRouter } from "@/i18n/navigation";
import { civilDateToDate } from "@/lib/dates";
import { useActionErrorToast } from "@/lib/use-action-toast";

// The side pane of the DetalleMovimiento artboard, beside a main pane that takes
// what is left.
const SIDE_PANE = "396px";

/**
 * The two panes of one movement: the amount over its category tile, the
 * description and the splits on the left; the account, the derived type, the
 * date, who recorded it, the labels and the two actions on the right (RF-24,
 * RF-25, RF-69, RF-70). It reads the props the phone's detail already receives,
 * so the wider shape costs no query of its own, and it deletes through the same
 * confirm the phone uses. Money stays integer cents; the sign is `Money`'s.
 */
export function MovementDetailDesktop({
  movement,
  options,
  creatorName,
}: {
  movement: TransactionListRow;
  options: TransactionFormOptions;
  creatorName: string | null;
}) {
  const t = useTranslations("transactions");
  const tKey = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const onActionError = useActionErrorToast();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const remove = useAction(deleteTransactionAction, {
    onSuccess: () => router.push("/movements"),
    onError: onActionError,
  });

  // Confirming stamps `reviewed_at`, dropping the movement from the count, banner
  // and badge (RF-31); the action's refresh re-reads this detail, so the
  // affordance then disappears on its own.
  const confirm = useAction(markMovementReviewedAction, {
    onSuccess: () => toast.success(t("confirmedToast")),
    onError: onActionError,
  });

  const isUnreviewedGenerated =
    movement.recurringRuleId !== null && movement.reviewedAt === null;

  // A name and colour per account and per category id — children included — so
  // both panes read their names without a second lookup.
  const accountNames = new Map(options.accounts.map((a) => [a.id, a.name]));
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

  const kind = movement.kind;
  const firstSplit = movement.splits[0]?.categoryId;

  const tone: MoneyTone =
    kind === "income" ? "income" : kind === "transfer" ? "transfer" : "expense";

  const kindLabel =
    kind === "income"
      ? t("kindIncome")
      : kind === "transfer"
        ? t("kindTransfer")
        : t("kindExpense");

  // A transfer names no category, so its tile stays the neutral surface (RF-69).
  const tileColor =
    kind === "transfer" ? null : (firstSplit && categoryColors.get(firstSplit)) ?? null;

  // A transfer reads "origin → destination"; an income names its destination, an
  // expense its source.
  const account =
    kind === "transfer"
      ? `${(movement.fromAccountId && accountNames.get(movement.fromAccountId)) ?? ""} → ${(movement.toAccountId && accountNames.get(movement.toAccountId)) ?? ""}`
      : kind === "income"
        ? (movement.toAccountId && accountNames.get(movement.toAccountId)) ?? ""
        : (movement.fromAccountId && accountNames.get(movement.fromAccountId)) ?? "";

  const occurredAt = civilDateToDate(movement.occurredAt);
  const longDate = format.dateTime(occurredAt, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const shortDate = format.dateTime(occurredAt, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <Flex direction="column">
      <ScreenHeader
        title={t("detailTitle")}
        meta={shortDate}
        back={{ href: "/movements", label: t("listTitle") }}
      />

      <Flex align="start" gap="4" px="6" pb="6">
        <Flex direction="column" gap="4" flexGrow="1" minWidth="0">
          <Panel>
            <Flex direction="column" align="center" gap="2" px="4" py="7">
              <CategoryTile color={tileColor} size={60} />
              <Money cents={movement.amountCents} tone={tone} size="hero" />
              {movement.description && (
                <Text size="4" weight="medium" align="center">
                  {movement.description}
                </Text>
              )}
              <Flex align="center" gap="2">
                <Text size="2" weight="medium">
                  {kindLabel}
                </Text>
                <Text size="2" color="gray">
                  {t("kindDerivedFrom")}
                </Text>
              </Flex>
            </Flex>
          </Panel>

          {/* A transfer carries no split, so the block belongs to an income or an
              expense alone (RF-69). */}
          {movement.splits.length > 0 && (
            <Panel
              title={t("splitsTitle")}
              action={
                <Text size="2" color="gray">
                  {t.rich("splitsTotal", {
                    amount: () => (
                      <Money cents={movement.amountCents} signed={false} size="inherit" />
                    ),
                  })}
                </Text>
              }
            >
              {movement.splits.map((split, index) => (
                <Fragment key={split.categoryId}>
                  {index > 0 && <Separator size="4" />}
                  <Flex align="center" justify="between" gap="4" px="4" py="3">
                    <Flex align="center" gap="2" minWidth="0">
                      <CategoryTile
                        color={categoryColors.get(split.categoryId) ?? null}
                        size={9}
                      />
                      <Text size="2" color="gray" truncate>
                        {categoryNames.get(split.categoryId)}
                      </Text>
                    </Flex>
                    <Money cents={split.amountCents} signed={false} />
                  </Flex>
                </Fragment>
              ))}
            </Panel>
          )}
        </Flex>

        <Flex direction="column" gap="4" width={SIDE_PANE} flexShrink="0">
          <Panel>
            <Flex direction="column" px="4" py="1">
              <Fact label={t("accountLabel")} value={account} />
              <Separator size="4" />
              <Fact label={t("typeLabel")} value={kindLabel} />
              <Separator size="4" />
              <Fact label={t("dateLabel")} value={longDate} />
              {creatorName && (
                <>
                  <Separator size="4" />
                  <Fact label={t("createdBy")} value={creatorName} />
                </>
              )}
            </Flex>
          </Panel>

          {movement.labels.length > 0 && (
            <Panel title={t("labels")}>
              <Flex gap="2" wrap="wrap" px="4" pb="4">
                {movement.labels.map((label) => (
                  <Badge key={label.id} color="gray" variant="soft" radius="full">
                    {label.name}
                  </Badge>
                ))}
              </Flex>
            </Panel>
          )}

          {/* Only a generated movement still awaiting review offers Confirmar; a
              manual or already-reviewed one shows none. */}
          {isUnreviewedGenerated && (
            <Button
              type="button"
              size="3"
              disabled={confirm.isPending}
              onClick={() => confirm.execute({ transactionId: movement.id })}
            >
              <CheckIcon size={16} />
              {t("confirm")}
            </Button>
          )}

          <Flex gap="3">
            <Flex asChild align="center" justify="center" gap="2" flexGrow="1">
              <Button type="button" size="3" onClick={() => setEditOpen(true)}>
                <PencilIcon size={15} />
                {t("edit")}
              </Button>
            </Flex>
            <Flex asChild align="center" justify="center" gap="2" flexGrow="1">
              <Button
                type="button"
                size="3"
                variant="surface"
                color="red"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2Icon size={15} />
                {t("delete")}
              </Button>
            </Flex>
          </Flex>
        </Flex>
      </Flex>

      <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
        <Dialog.Content>
          {/* The form carries its own heading; the title stays for the a11y tree. */}
          <VisuallyHidden>
            <Dialog.Title>{t("formTitle")}</Dialog.Title>
          </VisuallyHidden>
          {/* Closing unmounts the content, so the form reseeds on each open. */}
          {editOpen && (
            <MovementForm
              mode="edit"
              options={options}
              movement={movement}
              onDone={() => setEditOpen(false)}
            />
          )}
        </Dialog.Content>
      </Dialog.Root>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteTitle")}
        description={t("deleteDescription")}
        confirmLabel={t("delete")}
        cancelLabel={tKey("common.cancel")}
        pending={remove.isPending}
        onConfirm={() => remove.execute({ transactionId: movement.id })}
      />
    </Flex>
  );
}

// One line of the trail: what it is on the left, what it says on the right.
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Flex align="center" justify="between" gap="4" py="3">
      <Text size="2" color="gray">
        {label}
      </Text>
      <Text size="2" weight="medium" align="right">
        {value}
      </Text>
    </Flex>
  );
}
