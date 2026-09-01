"use client";

import type { LucideIcon } from "lucide-react";
import { CalendarDays, CircleAlert, CreditCard, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { DebtFormDialog } from "@/components/planning/debt-form-dialog";
import type { DebtAccount } from "@/components/planning/debt-form-dialog";
import {
  Button,
  Card,
  EmptyState,
  Flex,
  FundChip,
  Heading,
  Separator,
  Text,
} from "@/components/ui";
import type { DebtsScreenData } from "@/db/queries/debts-screen";
import type { DebtOverviewRow } from "@/db/queries/debt-overview";
import { civilDateToDate } from "@/lib/dates";
import { centsToPesos } from "@/lib/money";

// The dialog is one instance driven by this: which mode it opens in and, for the
// complete path, which bare liability it writes terms onto.
type DialogTarget =
  | { mode: "create" }
  | { mode: "complete"; account: DebtAccount };

/**
 * The consolidated debts screen (RF-83): the fund's total owed, its next payment
 * and summed monthly interest, then a card per liability read by its `debtKind`.
 * Every figure arrives already derived from the backend and stays integer cents;
 * the peso and percent readings are display only. One `DebtFormDialog` serves both
 * the header "new debt" and each bare liability's "complete terms" invitation.
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

  const [target, setTarget] = useState<DialogTarget | null>(null);

  const { totals, withTerms, withoutTerms } = data;
  const isEmpty = withTerms.length === 0 && withoutTerms.length === 0;

  const addButton = (
    <Button type="button" onClick={() => setTarget({ mode: "create" })}>
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

      <Flex direction="column" gap="1">
        <Text size="2" color="gray">
          {t("total")}
        </Text>
        <Heading as="h2" size="8" style={{ fontVariantNumeric: "tabular-nums" }}>
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
              <RevolvingCard key={row.accountId} row={row} />
            ) : (
              <InstallmentCard key={row.accountId} row={row} />
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
            />
          ))}
        </Flex>
      )}

      <DebtFormDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        mode={target?.mode ?? "create"}
        hasGroup={hasGroup}
        account={target?.mode === "complete" ? target.account : undefined}
      />
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

function RevolvingCard({ row }: { row: DebtOverviewRow & { name: string } }) {
  const t = useTranslations("debts");
  const format = useFormatter();

  // The monthly rate reads as the derived interest against the owed magnitude —
  // never re-summed, never the linear rate/12; display only as a percentage.
  const monthlyRate =
    row.owedCents > 0 ? row.monthlyInterestCents / row.owedCents : 0;

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
            pct: format.number(monthlyRate, {
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
      </Flex>
    </Card>
  );
}

function InstallmentCard({ row }: { row: DebtOverviewRow & { name: string } }) {
  const t = useTranslations("debts");
  const format = useFormatter();

  return (
    <Card>
      <Flex direction="column" gap="3">
        <CardHead
          icon={CalendarDays}
          tint="amber"
          name={row.name}
          meta={t("installmentMeta")}
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
      </Flex>
    </Card>
  );
}

function NoTermsCard({
  debt,
  onComplete,
}: {
  debt: { accountId: string; name: string; owedCents: number };
  onComplete: () => void;
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
      </Flex>
    </Card>
  );
}
