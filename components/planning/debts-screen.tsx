"use client";

import {
  createColumnHelper,
  createPaginatedRowModel,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";
import { CalendarDays, CircleAlert, CreditCard, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { DebtFormDialog } from "@/components/planning/debt-form-dialog";
import type { DebtAccount } from "@/components/planning/debt-form-dialog";
import { DebtPaymentDialog } from "@/components/planning/debt-payment-dialog";
import { DebtsTable } from "@/components/planning/debts-table";
import type { DebtTableRow } from "@/components/planning/debts-table";
import { InstallmentPlanDialog } from "@/components/planning/installment-plan-dialog";
import {
  Box,
  Button,
  Card,
  EmptyState,
  Flex,
  FundChip,
  Heading,
  Money,
  ScreenHeader,
  Separator,
  StatTiles,
  Text,
} from "@/components/ui";
import type { DebtsScreenData } from "@/db/queries/debts-screen";
import type { DebtOverviewRow } from "@/db/queries/debt-overview";
import type { PlanPosition } from "@/db/queries/installment-plans";
import { useRouter } from "@/i18n/navigation";
import { civilDateToDate } from "@/lib/dates";
import { centsToPesos } from "@/lib/money";

const PAGE_SIZE = 10;

// The em dash a tile with nothing to name reads as (SPEC-A3), not a word a
// translator would ever change.
const NO_VALUE = "—";

// Paging is the only client model the table needs: the rows are ordered here and
// scoped by Postgres, so no sorting or filtering feature is registered.
const features = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
const columnHelper = createColumnHelper<typeof features, DebtTableRow>();
const columns = columnHelper.columns([columnHelper.accessor("accountId", {})]);

// The dialog is one instance driven by this: which mode it opens in and, for
// everything but "create", which liability it acts on.
type DialogTarget =
  | { mode: "create" }
  | { mode: "complete"; account: DebtAccount }
  | { mode: "pay"; account: DebtAccount }
  | { mode: "plan"; account: DebtAccount };

// A row carrying its plan position, which is what the phone's cards read.
type OverviewCard = DebtOverviewRow & {
  name: string;
  planPosition: PlanPosition | null;
};

/**
 * The consolidated debts area (RF-83, RF-117): the fund's four figures over the
 * dense table of SPEC-A3 on a laptop, and the same liabilities as cards read by
 * their `debtKind` on a phone. Every figure arrives already derived from the
 * backend and stays integer cents; the peso and percent readings are display
 * only. One `DebtFormDialog` serves the header's "new debt" and each bare
 * liability's "complete terms", and the same target state opens the payment
 * (RF-16, RF-82) and the plan (RF-81).
 */
export function DebtsScreen({
  data,
  hasGroup,
}: {
  data: DebtsScreenData;
  hasGroup: boolean;
}) {
  const t = useTranslations("debts");
  const tKey = useTranslations();
  const format = useFormatter();
  const router = useRouter();

  const [target, setTarget] = useState<DialogTarget | null>(null);

  const { totals, withTerms, withoutTerms, payFrom } = data;
  const isEmpty = withTerms.length === 0 && withoutTerms.length === 0;
  const debtCount = withTerms.length + withoutTerms.length;

  // A debt is paid from an asset (RF-16): with no asset on the roster there is
  // no source to pick, so no card offers the abono.
  const canPay = payFrom.length > 0;

  function shortDate(date: string): string {
    return format.dateTime(civilDateToDate(date), {
      day: "numeric",
      month: "short",
    });
  }

  function payTarget(account: DebtAccount) {
    setTarget({ mode: "pay", account });
  }

  // The table sorts nothing: the rows arrive here in the order its due-date
  // column inks as sorted, the debts with no date last, then by name.
  const rows = useMemo<DebtTableRow[]>(() => {
    const all: DebtTableRow[] = [
      ...withTerms.map((row) => ({
        accountId: row.accountId,
        name: row.name,
        owedCents: row.owedCents,
        planPosition: row.planPosition,
        terms: row,
      })),
      ...withoutTerms.map((debt) => ({ ...debt, terms: null })),
    ];

    return all.sort((a, b) => {
      const left = a.terms?.nextDueDate ?? null;
      const right = b.terms?.nextDueDate ?? null;
      if (left !== right) {
        if (left === null) return 1;
        if (right === null) return -1;
        return left < right ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [withTerms, withoutTerms]);

  const table = useTable(
    {
      features,
      data: rows,
      columns,
      initialState: { pagination: { pageIndex: 0, pageSize: PAGE_SIZE } },
    },
    (state) => ({ pagination: state.pagination }),
  );

  const pageRows = table.getPaginatedRowModel().rows.map((row) => row.original);

  const addButton = (
    <Button type="button" onClick={() => setTarget({ mode: "create" })}>
      <Plus size={16} />
      {t("add")}
    </Button>
  );

  // The table's own slot: inside its frame the stack keeps its own height, so
  // the column headers stay on screen.
  const tableEmpty = (
    <EmptyState
      variant="filtered"
      title={t("emptyTitle")}
      description={t("emptyDescription")}
      action={addButton}
    />
  );

  // Which debt the fund's next payment belongs to. `totals.nextPayment` names it
  // but carries no id, so the same earliest-due fold the query already ran picks
  // the row out — over every debt, never over the page.
  const nextPaymentAccountId =
    withTerms.reduce<{ accountId: string; date: string } | null>(
      (earliest, row) => {
        if (row.nextDueDate === null) return earliest;
        if (earliest !== null && earliest.date <= row.nextDueDate) return earliest;
        return { accountId: row.accountId, date: row.nextDueDate };
      },
      null,
    )?.accountId ?? null;

  // The four figures of the artboard, the whole consolidated view: the summed
  // interest reads as a share of the owed magnitude, a ratio of two totals and
  // never a money division; the cupo is the backend's own sum over the debts
  // that carry a limit, so it can never disagree with the column it sits over.
  const interestSharePct =
    totals.owedCents > 0 ? totals.monthlyInterestCents / totals.owedCents : 0;

  const tiles = [
    {
      key: "total",
      label: t("tileTotal"),
      value: <Money cents={totals.owedCents} signed={false} size="inherit" />,
      note: t("tileTotalNote", { count: debtCount }),
    },
    {
      key: "interest",
      label: t("tileMonthlyInterest"),
      value: (
        <Money cents={totals.monthlyInterestCents} signed={false} size="inherit" />
      ),
      note: t("tileMonthlyInterestNote", {
        pct: format.number(interestSharePct, {
          style: "percent",
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      }),
    },
    {
      key: "nextPayment",
      label: t("tileNextPayment"),
      value:
        totals.nextPayment === null ? (
          NO_VALUE
        ) : (
          <Money
            cents={totals.nextPayment.amountCents}
            signed={false}
            size="inherit"
          />
        ),
      note:
        totals.nextPayment === null
          ? undefined
          : t("tileNextPaymentNote", {
              date: shortDate(totals.nextPayment.date),
              name: totals.nextPayment.name,
            }),
    },
    {
      key: "availableCredit",
      label: t("tileAvailableCredit"),
      value: (
        <Money cents={totals.availableCreditCents} signed={false} size="inherit" />
      ),
      note: t("tileAvailableCreditNote", {
        amount: format.number(
          centsToPesos(totals.creditLimitCents),
          "currency",
        ),
      }),
    },
  ];

  return (
    <Flex direction="column" gap="4">
      {/* The laptop's band and table, and the phone's header and cards: exactly
          one set is displayed at any width. */}
      <Box display={{ initial: "none", lg: "block" }}>
        <ScreenHeader
          title={t("title")}
          meta={
            totals.nextPayment === null
              ? t("listMetaNoPayment", { count: debtCount })
              : t("listMeta", {
                  count: debtCount,
                  date: shortDate(totals.nextPayment.date),
                })
          }
          actions={
            <Button
              type="button"
              variant="surface"
              color="gray"
              onClick={() => setTarget({ mode: "create" })}
            >
              <Plus size={15} />
              {t("add")}
            </Button>
          }
        />
        <StatTiles tiles={tiles} />
        <DebtsTable
          rows={pageRows}
          nextPaymentAccountId={nextPaymentAccountId}
          page={table.state.pagination.pageIndex + 1}
          pageSize={PAGE_SIZE}
          total={rows.length}
          empty={tableEmpty}
          onPrev={() => table.previousPage()}
          onNext={() => table.nextPage()}
          onPay={(row) =>
            payTarget({
              accountId: row.accountId,
              name: row.name,
              owedCents: row.owedCents,
            })
          }
          onNewPlan={(row) =>
            setTarget({
              mode: "plan",
              account: {
                accountId: row.accountId,
                name: row.name,
                owedCents: row.owedCents,
              },
            })
          }
          onDetail={(row) => router.push(`/planning/debts/${row.accountId}`)}
          onEditTerms={(row) =>
            setTarget({
              mode: "complete",
              account: {
                accountId: row.accountId,
                name: row.name,
                owedCents: row.owedCents,
              },
            })
          }
        />
      </Box>

      <Box display={{ initial: "block", lg: "none" }}>
        <Flex direction="column" gap="4">
          <Flex justify="between" align="center" gap="3" wrap="wrap">
            <Flex align="center" gap="2">
              <Heading size="5">{t("title")}</Heading>
              {hasGroup && <FundChip label={tKey("fund.label")} />}
            </Flex>
            {addButton}
          </Flex>

          <Flex direction="column" gap="1">
            <Text size="2" color="gray">
              {t("total")}
            </Text>
            <Heading
              as="h2"
              size="8"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {format.number(centsToPesos(totals.owedCents), "currency")}
            </Heading>
            {totals.nextPayment !== null && (
              <Text size="2" color="gray">
                {t("nextPayment", {
                  amount: format.number(
                    centsToPesos(totals.nextPayment.amountCents),
                    "currency",
                  ),
                  date: format.dateTime(
                    civilDateToDate(totals.nextPayment.date),
                    { day: "numeric", month: "short" },
                  ),
                })}
              </Text>
            )}
            <Text size="2" color="gray">
              {t("monthlyInterest", {
                amount: format.number(
                  centsToPesos(totals.monthlyInterestCents),
                  "currency",
                ),
              })}
            </Text>
          </Flex>

          {isEmpty ? (
            <EmptyState
              title={t("emptyTitle")}
              description={t("emptyDescription")}
              action={addButton}
            />
          ) : (
            <Flex direction="column" gap="3">
              {withTerms.map((row) =>
                row.debtKind === "revolving" ? (
                  <RevolvingCard
                    key={row.accountId}
                    row={row}
                    onPay={
                      canPay
                        ? () =>
                            payTarget({
                              accountId: row.accountId,
                              name: row.name,
                              owedCents: row.owedCents,
                            })
                        : undefined
                    }
                  />
                ) : (
                  <InstallmentCard
                    key={row.accountId}
                    row={row}
                    onPay={
                      canPay
                        ? () =>
                            payTarget({
                              accountId: row.accountId,
                              name: row.name,
                              owedCents: row.owedCents,
                            })
                        : undefined
                    }
                  />
                ),
              )}
              {withoutTerms.map((debt) => (
                <NoTermsCard
                  key={debt.accountId}
                  debt={debt}
                  onComplete={() =>
                    setTarget({
                      mode: "complete",
                      account: {
                        accountId: debt.accountId,
                        name: debt.name,
                        owedCents: debt.owedCents,
                      },
                    })
                  }
                  onPay={
                    canPay
                      ? () =>
                          payTarget({
                            accountId: debt.accountId,
                            name: debt.name,
                            owedCents: debt.owedCents,
                          })
                      : undefined
                  }
                />
              ))}
            </Flex>
          )}
        </Flex>
      </Box>

      <DebtFormDialog
        open={target?.mode === "create" || target?.mode === "complete"}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        mode={target?.mode === "complete" ? "complete" : "create"}
        hasGroup={hasGroup}
        account={target?.mode === "complete" ? target.account : undefined}
      />

      {target?.mode === "pay" && (
        <DebtPaymentDialog
          open
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
          debt={target.account}
          payFrom={payFrom}
        />
      )}

      {target?.mode === "plan" && (
        <InstallmentPlanDialog
          open
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
          account={{
            id: target.account.accountId,
            name: target.account.name,
          }}
        />
      )}
    </Flex>
  );
}

// A soft tinted disc carrying the card's icon, matching the hub's rows.
function Disc({ icon: Icon, tint }: { icon: LucideIcon; tint: string }) {
  return (
    <Flex
      align="center"
      justify="center"
      style={{
        width: 42,
        height: 42,
        borderRadius: "var(--radius-5)",
        background: `var(--${tint}-a3)`,
        color: `var(--${tint}-11)`,
        flexShrink: 0,
      }}
    >
      <Icon size={20} />
    </Flex>
  );
}

// The head row every card shares: disc, name over a meta line, owed on the right.
function CardHead({
  icon,
  tint,
  name,
  meta,
  owedCents,
}: {
  icon: LucideIcon;
  tint: string;
  name: string;
  meta: string;
  owedCents: number;
}) {
  const format = useFormatter();

  return (
    <Flex align="center" gap="3">
      <Disc icon={icon} tint={tint} />
      <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
        <Text weight="bold" truncate>
          {name}
        </Text>
        <Text size="1" color="gray">
          {meta}
        </Text>
      </Flex>
      <Text weight="bold" style={{ fontVariantNumeric: "tabular-nums" }}>
        {format.number(centsToPesos(owedCents), "currency")}
      </Text>
    </Flex>
  );
}

// A footer label over its value; the value already reads as a formatted string.
function Stat({
  label,
  value,
  align,
}: {
  label: string;
  value: string;
  align?: "right";
}) {
  return (
    <Flex direction="column" gap="1" style={align ? { textAlign: "right" } : undefined}>
      <Text size="1" color="gray">
        {label}
      </Text>
      <Text size="2" weight="medium" style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Text>
    </Flex>
  );
}

// The abono a card offers when the fund has an asset to pay it from (RF-16).
function PayButton({ onPay }: { onPay: () => void }) {
  const t = useTranslations("debts");

  return (
    <Flex justify="end">
      <Button type="button" tap variant="ghost" size="2" onClick={onPay}>
        {t("rowPay")}
      </Button>
    </Flex>
  );
}

function RevolvingCard({
  row,
  onPay,
}: {
  row: OverviewCard;
  onPay?: () => void;
}) {
  const t = useTranslations("debts");
  const format = useFormatter();

  const hasFooter =
    row.minimumPaymentCents !== null ||
    row.nextCutOffDate !== null ||
    row.availableCreditCents !== null;

  return (
    <Card>
      <Flex direction="column" gap="3">
        <CardHead
          icon={CreditCard}
          tint="indigo"
          name={row.name}
          meta={t("revolvingMeta", {
            // The effective monthly step the server derived off the annual rate,
            // read as a percentage here and nowhere divided, so the card and the
            // row can never state the rate a hair apart.
            pct: format.number(row.monthlyRatePct, {
              style: "percent",
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            }),
          })}
          owedCents={row.owedCents}
        />

        {hasFooter && (
          <>
            <Separator size="4" />
            {(row.minimumPaymentCents !== null ||
              row.nextCutOffDate !== null) && (
              <Flex justify="between" gap="3">
                {row.minimumPaymentCents !== null && (
                  <Stat
                    label={t("minimumPayment")}
                    value={format.number(
                      centsToPesos(row.minimumPaymentCents),
                      "currency",
                    )}
                  />
                )}
                {row.nextCutOffDate !== null && (
                  <Stat
                    align="right"
                    label={t("cutOff")}
                    value={format.dateTime(
                      civilDateToDate(row.nextCutOffDate),
                      { day: "numeric", month: "short" },
                    )}
                  />
                )}
              </Flex>
            )}
            {row.availableCreditCents !== null && (
              <Text size="1" color="gray">
                {t("availableCredit", {
                  amount: format.number(
                    centsToPesos(row.availableCreditCents),
                    "currency",
                  ),
                })}
              </Text>
            )}
          </>
        )}

        {onPay && <PayButton onPay={onPay} />}
      </Flex>
    </Card>
  );
}

function InstallmentCard({
  row,
  onPay,
}: {
  row: OverviewCard;
  onPay?: () => void;
}) {
  const t = useTranslations("debts");
  const format = useFormatter();

  const position = row.planPosition;
  const nextLine =
    position !== null &&
    position.nextDueDate !== null &&
    position.nextAmountCents !== null
      ? { date: position.nextDueDate, amountCents: position.nextAmountCents }
      : null;

  return (
    <Card>
      <Flex direction="column" gap="3">
        <CardHead
          icon={CalendarDays}
          tint="amber"
          name={row.name}
          // A debt whose plan the server counted states its position; one that
          // carries no plan only states its kind (RF-81).
          meta={
            position === null
              ? t("installmentMeta")
              : t("installmentPosition", {
                  paid: position.linesPaid,
                  total: position.linesTotal,
                })
          }
          owedCents={row.owedCents}
        />

        <Separator size="4" />
        <Flex justify="between" gap="3">
          <Stat
            label={t("dueInstallments")}
            value={format.number(
              centsToPesos(row.dueInstallmentsCents),
              "currency",
            )}
          />
          {row.nextDueDate !== null && (
            <Stat
              align="right"
              label={t("dueDate")}
              value={format.dateTime(civilDateToDate(row.nextDueDate), {
                day: "numeric",
                month: "short",
              })}
            />
          )}
        </Flex>

        {nextLine && (
          <Flex justify="between" align="center" gap="3">
            <Text size="1" color="gray">
              {t("nextInstallment", {
                date: format.dateTime(civilDateToDate(nextLine.date), {
                  day: "numeric",
                  month: "short",
                }),
              })}
            </Text>
            <Text size="2" weight="medium">
              <Money cents={nextLine.amountCents} signed={false} size="inherit" />
            </Text>
          </Flex>
        )}

        {onPay && <PayButton onPay={onPay} />}
      </Flex>
    </Card>
  );
}

function NoTermsCard({
  debt,
  onComplete,
  onPay,
}: {
  debt: { accountId: string; name: string; owedCents: number };
  onComplete: () => void;
  onPay?: () => void;
}) {
  const t = useTranslations("debts");

  return (
    <Card>
      <Flex direction="column" gap="3">
        <CardHead
          icon={CircleAlert}
          tint="amber"
          name={debt.name}
          meta={t("noTermsMeta")}
          owedCents={debt.owedCents}
        />
        <Button
          type="button"
          variant="soft"
          color="amber"
          onClick={onComplete}
        >
          {t("completeTerms")}
        </Button>
        {onPay && <PayButton onPay={onPay} />}
      </Flex>
    </Card>
  );
}
