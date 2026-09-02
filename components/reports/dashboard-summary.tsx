"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Badge, Button, Flex, Heading, Money, Text } from "@/components/ui";
import type { MoneyTone } from "@/components/ui";
import type { DashboardData } from "@/db/queries/reports/dashboard";
import type { OwnerNetWorthNamed } from "@/db/queries/reports/dashboard";
import { Link as LocaleLink } from "@/i18n/navigation";
import styles from "./dashboard-summary.module.css";

/**
 * The home dashboard's headline: the fund's total net worth over a pill per owner
 * (RF-88), the group counting as one bucket rather than split across its members
 * (RF-67), then this month's income, expense and net. Every figure arrives already
 * derived and stays integer cents; the peso reading is `Money`'s. No per-account
 * balance list lives here.
 *
 * From `md` up the blocks become the three side-by-side cards of the Inicio
 * artboard, `cash` filling the third; below it the two figure blocks stack as they
 * always have and the cash card, which the phone reaches through its own dialog,
 * is not displayed.
 */
export function DashboardSummary({
  data,
  cash,
}: {
  data: DashboardData;
  cash?: ReactNode;
}) {
  const t = useTranslations("dashboard");

  const {
    netWorth,
    totalNetWorthCents,
    monthFlow,
    unreviewedCount,
    pendingDeliveryCount,
  } = data;

  // The group reads before the members it holds; `sort` is stable, so the rest
  // keep the order the query gave them.
  const buckets = [...netWorth].sort(
    (a, b) => Number(b.bucket === "group") - Number(a.bucket === "group"),
  );

  return (
    <Flex direction="column" gap="4" className={styles.summary}>
      <div className={styles.cards}>
        <div className={styles.card} data-card="net">
          <Flex direction="column" gap="2">
            <Text size="2" color="gray">
              {t("netWorthTitle")}
            </Text>
            <Heading size="8" className={styles.figure}>
              <Money cents={totalNetWorthCents} tone={signTone(totalNetWorthCents)} size="inherit" />
            </Heading>

            {(unreviewedCount > 0 || pendingDeliveryCount > 0) && (
              <Flex gap="2" wrap="wrap">
                {/* Deep-links to the ledger filtered to generated-unreviewed rows; hidden
                    once nothing awaits review (RF-31). */}
                {unreviewedCount > 0 && (
                  <LocaleLink
                    href="/movements?unreviewed=1"
                    style={{ textDecoration: "none", alignSelf: "flex-start" }}
                  >
                    <Badge color="amber" variant="soft" radius="full">
                      {t("unreviewedBadge", { count: unreviewedCount })}
                    </Badge>
                  </LocaleLink>
                )}
                {pendingDeliveryCount > 0 && (
                  <LocaleLink
                    href="/inbox"
                    style={{ textDecoration: "none", alignSelf: "flex-start" }}
                  >
                    <Badge color="amber" variant="soft" radius="full">
                      {t("pendingDeliveriesBadge", {
                        count: pendingDeliveryCount,
                      })}
                    </Badge>
                  </LocaleLink>
                )}
              </Flex>
            )}

            <Flex gap="2" wrap="wrap">
              {buckets.map((bucket) => (
                <Badge key={bucketKey(bucket)} color="gray" variant="soft" radius="full">
                  {t.rich("ownerChip", {
                    name: bucketLabel(bucket, t),
                    amount: () => (
                      <Money
                        cents={bucket.netWorthCents}
                        tone={signTone(bucket.netWorthCents)}
                        size="inherit"
                      />
                    ),
                  })}
                </Badge>
              ))}
            </Flex>
          </Flex>
        </div>

        <div className={styles.card} data-card="month">
          <Flex gap="4" wrap="wrap" className={styles.monthStats}>
            <MonthStat
              label={t("monthIncome")}
              cents={monthFlow.incomeCents}
              tone="income"
            />
            <MonthStat
              label={t("monthExpense")}
              cents={monthFlow.expenseCents}
              tone="expense"
            />
            <MonthStat
              label={t("monthNet")}
              cents={monthFlow.netCents}
              tone={signTone(monthFlow.netCents, "income")}
            />
          </Flex>
        </div>

        <div className={styles.card} data-card="cash">
          {cash}
        </div>
      </div>

      <Button asChild variant="ghost" style={{ alignSelf: "flex-start" }}>
        <LocaleLink href="/reports">{t("viewReports")}</LocaleLink>
      </Button>
    </Flex>
  );
}

// A figure that can fall either way reads its sign off its own value: below zero
// it takes the expense's minus, at or above it the caller's own tone.
function signTone(cents: number, atOrAbove: MoneyTone = "plain"): MoneyTone {
  return cents < 0 ? "expense" : atOrAbove;
}

// A net-worth chip's stable key: the member's user id or the single group bucket.
function bucketKey(bucket: OwnerNetWorthNamed): string {
  return bucket.bucket === "group"
    ? `group:${bucket.groupId}`
    : `member:${bucket.ownerUserId}`;
}

// The name a chip wears: the group's, a member's, or the self label for the
// caller's own personal-only bucket, which carries no name (RF-55).
function bucketLabel(
  bucket: OwnerNetWorthNamed,
  t: ReturnType<typeof useTranslations<"dashboard">>,
): string {
  if (bucket.bucket === "group") return bucket.name ?? t("groupLabel");
  if (bucket.isSelf && bucket.name === null) return t("selfLabel");
  return bucket.name ?? t("selfLabel");
}

// One month figure: a muted label over its amount, which carries its own sign
// and colour.
function MonthStat({
  label,
  cents,
  tone,
}: {
  label: string;
  cents: number;
  tone: MoneyTone;
}) {
  return (
    <Flex direction="column" gap="1">
      <Text size="2" color="gray">
        {label}
      </Text>
      <Text size="4" weight="medium">
        <Money cents={cents} tone={tone} size="inherit" />
      </Text>
    </Flex>
  );
}
