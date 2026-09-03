"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { deleteInstallmentPlanAction } from "@/app/actions/installment-plans";
import { DebtPaymentDialog } from "@/components/planning/debt-payment-dialog";
import { InstallmentPlanDialog } from "@/components/planning/installment-plan-dialog";
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Flex,
  Heading,
  Link,
  Money,
  Panel,
  RowMenu,
  ScreenHeader,
  Separator,
  StatTiles,
  Text,
  type DataColumn,
} from "@/components/ui";
import type { DebtDetailData } from "@/db/queries/debt-detail";
import type {
  InstallmentPlanLine,
  InstallmentPlanRow,
} from "@/db/queries/installment-plans";
import type { DebtStatement } from "@/db/schema";
import { Link as LocaleLink } from "@/i18n/navigation";
import { civilDateToDate } from "@/lib/dates";
import { centsToPesos } from "@/lib/money";
import { useActionErrorToast } from "@/lib/use-action-toast";

// The em dash a cell or a tile with nothing to name reads as (SPEC-A3), not a
// word a translator would ever change.
const NO_VALUE = "—";

// The tracks of the two tables, both dense enough to read a whole plan at once.
const LINE_WIDTHS = {
  seq: "88px",
  dueDate: "110px",
  amount: "140px",
  status: "120px",
  movement: "minmax(0, 1fr)",
} as const;

const STATEMENT_WIDTHS = {
  period: "minmax(0, 1fr)",
  cutOff: "110px",
  dueDate: "110px",
  balance: "140px",
  minimum: "130px",
  interest: "130px",
} as const;

/**
 * One liability read in full (RF-16, RF-81, RF-82, RF-84): its derived saldo over
 * the four figures it owes against, a table per installment plan with the dated
 * lines and the movement that settled each, and its statement history under the
 * open period. Every figure arrives derived from the server — the stored
 * statement balances are read exactly as they were frozen at their cut-off, and
 * no interest is recomputed here. A caller the policies would refuse is offered
 * no action at all (`canWrite`).
 */
export function DebtDetailScreen({ data }: { data: DebtDetailData }) {
  const t = useTranslations("installments");
  const tDebts = useTranslations("debts");
  const tKey = useTranslations();
  const format = useFormatter();
  const onActionError = useActionErrorToast();

  const { account, terms, plans, statements, currentStatement, canWrite, payFrom } =
    data;

  const [dialog, setDialog] = useState<"pay" | "plan" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InstallmentPlanRow | null>(
    null,
  );

  const remove = useAction(deleteInstallmentPlanAction, {
    onSuccess() {
      toast.success(t("planDeleted"));
      setDeleteTarget(null);
    },
    onError: onActionError,
  });

  // The magnitude the liability owes, off the balance the view derives from
  // movements; a debt reads without a sign.
  const owedCents = Math.abs(account.balanceCents);

  // What the plans still owe: the unpaid lines the server summed, never a
  // stored figure (RF-82).
  const pendingCents = plans.reduce((sum, plan) => sum + plan.pendingCents, 0);

  // The limit less what is owed, the pair the overview states for the list; with
  // no limit there is no cupo, which is not the same as a cupo of zero (RF-117).
  const availableCreditCents =
    terms?.creditLimitCents == null ? null : terms.creditLimitCents - owedCents;

  function shortDate(date: string): string {
    return format.dateTime(civilDateToDate(date), {
      day: "numeric",
      month: "short",
    });
  }

  const tiles = [
    {
      key: "balance",
      label: tDebts("tableBalance"),
      value: <Money cents={owedCents} signed={false} size="inherit" />,
    },
    {
      key: "pending",
      label: t("tilePending"),
      value:
        plans.length === 0 ? (
          NO_VALUE
        ) : (
          <Money cents={pendingCents} signed={false} size="inherit" />
        ),
    },
    {
      key: "nextPayment",
      label: tDebts("tileNextPayment"),
      // The open period's own minimum, derived by the server on the live
      // balance; a debt with no due day names no next payment.
      value:
        currentStatement === null || currentStatement.nextDueDate === null ? (
          NO_VALUE
        ) : (
          <Money
            cents={currentStatement.minimumPaymentCents}
            signed={false}
            size="inherit"
          />
        ),
      note:
        currentStatement?.nextDueDate == null
          ? undefined
          : shortDate(currentStatement.nextDueDate),
    },
    {
      key: "availableCredit",
      label: tDebts("tileAvailableCredit"),
      value:
        availableCreditCents === null ? (
          NO_VALUE
        ) : (
          <Money cents={availableCreditCents} signed={false} size="inherit" />
        ),
      note:
        terms?.creditLimitCents == null
          ? undefined
          : tDebts("tileAvailableCreditNote", {
              amount: format.number(
                centsToPesos(terms.creditLimitCents),
                "currency",
              ),
            }),
    },
  ];

  const newPlanButton = (
    <Button
      type="button"
      variant="surface"
      color="gray"
      onClick={() => setDialog("plan")}
    >
      <Plus size={15} />
      {tDebts("rowNewPlan")}
    </Button>
  );

  return (
    <Flex direction="column" gap="4">
      <ScreenHeader
        title={account.name}
        meta={<Money cents={owedCents} signed={false} size="inherit" />}
        back={{ href: "/planning/debts", label: tDebts("title") }}
        actions={
          // Exactly what the policies would admit: a reader is offered neither
          // the abono nor the plan, and no row menu below offers the delete.
          canWrite && (
            <>
              <Button
                type="button"
                variant="surface"
                color="gray"
                onClick={() => setDialog("pay")}
              >
                {tDebts("rowPay")}
              </Button>
              {newPlanButton}
            </>
          )
        }
      />

      <StatTiles tiles={tiles} />

      <Flex direction="column" px={{ initial: "0", md: "6" }}>
        <Heading as="h2" size="3">
          {t("plansTitle")}
        </Heading>
      </Flex>

      {plans.length === 0 ? (
        <EmptyState
          variant="filtered"
          title={t("plansEmpty")}
          action={canWrite ? newPlanButton : undefined}
        />
      ) : (
        plans.map((plan) => (
          <PlanTable
            key={plan.id}
            plan={plan}
            canWrite={canWrite}
            onDelete={() => setDeleteTarget(plan)}
          />
        ))
      )}

      <Flex direction="column" px={{ initial: "0", md: "6" }}>
        <Heading as="h2" size="3">
          {t("statementsTitle")}
        </Heading>
      </Flex>

      {/* The period nobody has cut yet: live figures, and never one of the
          snapshots below (RF-84). */}
      {currentStatement !== null && (
        <Flex direction="column" px={{ initial: "0", md: "6" }}>
          <Panel title={t("currentPeriod")}>
            <Flex direction="column" px="4" py="1">
              <Fact
                label={t("periodStart")}
                value={shortDate(currentStatement.periodStart)}
              />
              <Separator size="4" />
              <Fact
                label={t("statementBalance")}
                value={
                  <Money
                    cents={currentStatement.balanceCents}
                    signed={false}
                    size="inherit"
                  />
                }
              />
              <Separator size="4" />
              <Fact
                label={t("statementMinimum")}
                value={
                  <Money
                    cents={currentStatement.minimumPaymentCents}
                    signed={false}
                    size="inherit"
                  />
                }
              />
              {currentStatement.nextCutOffDate !== null && (
                <>
                  <Separator size="4" />
                  <Fact
                    label={t("statementCutOff")}
                    value={shortDate(currentStatement.nextCutOffDate)}
                  />
                </>
              )}
              {currentStatement.nextDueDate !== null && (
                <>
                  <Separator size="4" />
                  <Fact
                    label={t("statementDueDate")}
                    value={shortDate(currentStatement.nextDueDate)}
                  />
                </>
              )}
            </Flex>
          </Panel>
        </Flex>
      )}

      <StatementsTable
        statements={statements}
        hasCutOffDay={terms?.statementCutOffDay != null}
      />

      {dialog === "pay" && (
        <DebtPaymentDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          debt={{
            accountId: account.id,
            name: account.name,
            owedCents,
          }}
          payFrom={payFrom}
        />
      )}

      {dialog === "plan" && (
        <InstallmentPlanDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          account={{ id: account.id, name: account.name }}
        />
      )}

      {deleteTarget !== null && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={t("deleteTitle")}
          // Names both halves of what a delete does: the lines go, and the
          // movements that paid some of them stay, unlinked.
          description={t("deleteDescription", {
            count: deleteTarget.lines.length,
          })}
          confirmLabel={tKey("common.delete")}
          cancelLabel={tKey("common.cancel")}
          pending={remove.isPending}
          onConfirm={() => remove.execute({ planId: deleteTarget.id })}
        />
      )}
    </Flex>
  );
}

// One line of the open period: what it is on the left, what it says on the right.
function Fact({ label, value }: { label: string; value: ReactNode }) {
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

/**
 * One plan's dated lines (RF-81, RF-82). A line reads paid exactly when a
 * movement is linked to it, and that movement is reachable from the row; the
 * total states the pending the server summed over the unpaid lines. The menu
 * offers only the delete — a plan has no edit form.
 */
function PlanTable({
  plan,
  canWrite,
  onDelete,
}: {
  plan: InstallmentPlanRow;
  canWrite: boolean;
  onDelete: () => void;
}) {
  const t = useTranslations("installments");
  const tKey = useTranslations();
  const format = useFormatter();

  // The merchant is what a person recognises; the description is the fallback,
  // and a plan that names neither still has to be addressable.
  const title = plan.merchant || plan.description || t("planUntitled");
  const paid = plan.lines.filter(
    (line) => line.paidTransactionId !== null,
  ).length;

  const columns: DataColumn<InstallmentPlanLine>[] = [
    {
      key: "seq",
      header: t("tableSeq"),
      width: LINE_WIDTHS.seq,
      numeric: true,
      cell: (line) => <Text size="2">{line.seq}</Text>,
    },
    {
      key: "dueDate",
      header: t("tableDueDate"),
      width: LINE_WIDTHS.dueDate,
      numeric: true,
      cell: (line) => (
        <Text size="2" color="gray">
          {format.dateTime(civilDateToDate(line.dueDate), {
            day: "numeric",
            month: "short",
          })}
        </Text>
      ),
    },
    {
      key: "amount",
      header: t("tableAmount"),
      width: LINE_WIDTHS.amount,
      align: "end",
      numeric: true,
      cell: (line) => <Money cents={line.amountCents} signed={false} />,
    },
    {
      key: "status",
      header: t("tableStatus"),
      width: LINE_WIDTHS.status,
      cell: (line) =>
        line.paidTransactionId === null ? (
          <Text size="2" color="gray">
            {t("statusPending")}
          </Text>
        ) : (
          <Badge color="jade" variant="soft" radius="full">
            {t("statusPaid")}
          </Badge>
        ),
    },
    {
      key: "movement",
      header: t("tableMovement"),
      width: LINE_WIDTHS.movement,
      cell: (line) =>
        line.paidTransactionId === null ? (
          <Text size="2" color="gray">
            {NO_VALUE}
          </Text>
        ) : (
          <Link asChild size="2">
            <LocaleLink href={`/movements/${line.paidTransactionId}`}>
              {t("viewMovement")}
            </LocaleLink>
          </Link>
        ),
    },
  ];

  return (
    <DataTable
      label={title}
      caption={
        <>
          <Flex direction="column" minWidth="0">
            <Text size="2" weight="medium" truncate>
              {title}
            </Text>
            <Text size="1" color="gray">
              {t("planPosition", { paid, total: plan.lines.length })}
            </Text>
          </Flex>
          {canWrite && (
            <RowMenu
              rowName={title}
              items={[
                {
                  key: "delete",
                  label: tKey("common.delete"),
                  tone: "danger",
                  onSelect: onDelete,
                },
              ]}
            />
          )}
        </>
      }
      columns={columns}
      rows={plan.lines}
      rowKey={(line) => line.id}
      total={[
        <Text key="label" size="2" color="gray">
          {t("tablePending")}
        </Text>,
        null,
        <Money key="pending" cents={plan.pendingCents} signed={false} />,
      ]}
    />
  );
}

/**
 * The closed periods, newest first (RF-84). Every figure is the snapshot frozen
 * at that cut-off, read as stored and never recomputed against later movements.
 */
function StatementsTable({
  statements,
  hasCutOffDay,
}: {
  statements: DebtStatement[];
  hasCutOffDay: boolean;
}) {
  const t = useTranslations("installments");
  const format = useFormatter();

  function shortDate(date: string): string {
    return format.dateTime(civilDateToDate(date), {
      day: "numeric",
      month: "short",
    });
  }

  const columns: DataColumn<DebtStatement>[] = [
    {
      key: "period",
      header: t("statementPeriod"),
      width: STATEMENT_WIDTHS.period,
      numeric: true,
      // The day the period opened; the column beside it closes the period.
      cell: (statement) => (
        <Text size="2">{shortDate(statement.periodStart)}</Text>
      ),
    },
    {
      key: "cutOff",
      header: t("statementCutOff"),
      width: STATEMENT_WIDTHS.cutOff,
      numeric: true,
      cell: (statement) => (
        <Text size="2" color="gray">
          {shortDate(statement.cutOffDate)}
        </Text>
      ),
    },
    {
      key: "dueDate",
      header: t("statementDueDate"),
      width: STATEMENT_WIDTHS.dueDate,
      numeric: true,
      cell: (statement) => (
        <Text size="2" color="gray">
          {shortDate(statement.paymentDueDate)}
        </Text>
      ),
    },
    {
      key: "balance",
      header: t("statementBalance"),
      width: STATEMENT_WIDTHS.balance,
      align: "end",
      numeric: true,
      cell: (statement) => (
        <Money cents={statement.statementBalanceCents} signed={false} />
      ),
    },
    {
      key: "minimum",
      header: t("statementMinimum"),
      width: STATEMENT_WIDTHS.minimum,
      align: "end",
      numeric: true,
      cell: (statement) => (
        <Text color="gray">
          <Money cents={statement.minimumPaymentCents} signed={false} />
        </Text>
      ),
    },
    {
      key: "interest",
      header: t("statementInterest"),
      width: STATEMENT_WIDTHS.interest,
      align: "end",
      numeric: true,
      cell: (statement) => (
        <Text color="gray">
          <Money cents={statement.interestEstimateCents} signed={false} />
        </Text>
      ),
    },
  ];

  return (
    <DataTable
      label={t("statementsTitle")}
      columns={columns}
      rows={statements}
      rowKey={(statement) => statement.id}
      empty={
        <EmptyState
          variant="filtered"
          title={t("statementsEmpty")}
          // Nothing is filtered here: a debt with no cut-off day has no period
          // to close, and that is the one thing to do about it (RF-84).
          description={hasCutOffDay ? undefined : t("statementsEmptyCutOff")}
        />
      }
    />
  );
}
