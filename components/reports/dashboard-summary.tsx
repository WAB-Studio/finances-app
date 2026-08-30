"use client";

import { useFormatter, useTranslations } from "next-intl";

import { Badge, Button, Flex, Heading, Text } from "@/components/ui";
import type { DashboardData } from "@/db/queries/reports/dashboard";
import type { OwnerNetWorthNamed } from "@/db/queries/reports/dashboard";
import { Link as LocaleLink } from "@/i18n/navigation";
import { centsToPesos } from "@/lib/money";

/**
 * The home dashboard's headline: the fund's total net worth over a pill per owner
 * (RF-88), the group counting as one bucket rather than split across its members
 * (RF-67), then this month's income, expense and net. Every figure arrives already
 * derived and stays integer cents; the peso reading is display only. No per-account
 * balance list lives here.
 */
export function DashboardSummary({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard");
  const format = useFormatter();

  const { netWorth, totalNetWorthCents, monthFlow } = data;

  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="2">
        <Text size="2" color="gray">
          {t("netWorthTitle")}
        </Text>
        <Heading size="8" style={{ fontVariantNumeric: "tabular-nums" }}>
          {format.number(centsToPesos(totalNetWorthCents), "currency")}
        </Heading>

        <Flex gap="2" wrap="wrap">
          {netWorth.map((bucket) => (
            <Badge
              key={bucketKey(bucket)}
              color="gray"
              variant="soft"
              radius="full"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {t("ownerChip", {
                name: bucketLabel(bucket, t),
                amount: format.number(
                  centsToPesos(bucket.netWorthCents),
                  "currency",
                ),
              })}
            </Badge>
          ))}
        </Flex>
      </Flex>

      <Flex gap="4" wrap="wrap">
        <MonthStat
          label={t("monthIncome")}
          value={`+${format.number(centsToPesos(monthFlow.incomeCents), "currency")}`}
          tone="income"
        />
        <MonthStat
          label={t("monthExpense")}
          value={`−${format.number(centsToPesos(monthFlow.expenseCents), "currency")}`}
        />
        <MonthStat
          label={t("monthNet")}
          value={signedAmount(monthFlow.netCents, format)}
          tone={monthFlow.netCents > 0 ? "income" : undefined}
        />
      </Flex>

      <Button asChild variant="ghost" style={{ alignSelf: "flex-start" }}>
        <LocaleLink href="/reports">{t("viewReports")}</LocaleLink>
      </Button>
    </Flex>
  );
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

// The net reads with the sign of its own value, mirroring the movements list.
function signedAmount(
  cents: number,
  format: ReturnType<typeof useFormatter>,
): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  return `${sign}${format.number(centsToPesos(Math.abs(cents)), "currency")}`;
}

// One month figure: a muted label over its signed amount; income turns green.
function MonthStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "income";
}) {
  return (
    <Flex direction="column" gap="1">
      <Text size="2" color="gray">
        {label}
      </Text>
      <Text
        size="4"
        weight="medium"
        color={tone === "income" ? "grass" : undefined}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </Text>
    </Flex>
  );
}
