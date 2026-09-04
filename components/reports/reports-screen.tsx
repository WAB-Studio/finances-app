"use client";

import { useFormatter, useTranslations } from "next-intl";

import {
  BarChart,
  Box,
  CategoryTile,
  Flex,
  Heading,
  Text,
} from "@/components/ui";
import type { BarChartDatum } from "@/components/ui";
import type { ReportsData } from "@/db/queries/reports/reports-screen";
import type { MemberContributionNamed } from "@/db/queries/reports/reports-screen";
import { civilDateToDate } from "@/lib/dates";
import { centsToPesos } from "@/lib/money";

// The two flow series carry the fund's colours: jade for what comes in, tomato
// for what goes out.
const SERIES_COLORS = {
  income: "var(--jade-9)",
  expense: "var(--tomato-9)",
} as const;

/**
 * The reports screen: this month's expenses by category (largest first, RF-34),
 * the six-month income-vs-expense trend (RF-35) and each member's net contribution
 * to the group pot (RF-66) — the pot itself never a contributor (RF-67). Every
 * figure arrives already derived and stays integer cents; the peso reading is
 * display only. Recharts lives behind the `BarChart` primitive alone.
 */
export function ReportsScreen({ data }: { data: ReportsData }) {
  const t = useTranslations("reports");
  const format = useFormatter();

  const { expensesByCategory, sixMonthFlow, contributions, hasGroup } = data;

  // Oldest-first months, each flat as the two-series shape the chart wants; the
  // label is the month's short name in the active locale.
  const chartData: BarChartDatum[] = sixMonthFlow.map((month) => ({
    label: format.dateTime(civilDateToDate(month.monthStart), { month: "short" }),
    series: [
      { key: "income", valueCents: month.incomeCents },
      { key: "expense", valueCents: month.expenseCents },
    ],
  }));

  return (
    <Flex direction="column" gap="6">
      <Heading size="6">{t("title")}</Heading>

      <Flex direction="column" gap="3" asChild>
        <section>
          <Heading as="h2" size="4">{t("byCategoryTitle")}</Heading>
          {expensesByCategory.length === 0 ? (
            <Text size="2" color="gray">
              {t("byCategoryEmpty")}
            </Text>
          ) : (
            <Flex direction="column" gap="3">
              {expensesByCategory.map((row) => (
                <Flex key={row.categoryId} align="center" gap="3">
                  <CategoryTile color={row.color} size={28} />
                  <Text as="div" size="3" style={{ flex: 1, minWidth: 0 }} truncate>
                    {row.name}
                  </Text>
                  <Text
                    size="3"
                    weight="medium"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {format.number(centsToPesos(row.totalCents), "currency")}
                  </Text>
                </Flex>
              ))}
            </Flex>
          )}
        </section>
      </Flex>

      <Flex direction="column" gap="3" asChild>
        <section>
          <Heading as="h2" size="4">{t("comparisonTitle")}</Heading>
          <BarChart
            data={chartData}
            seriesColors={SERIES_COLORS}
            aria-label={t("comparisonTitle")}
          />
          <Flex gap="4" wrap="wrap">
            <LegendItem color={SERIES_COLORS.income} label={t("legendIncome")} />
            <LegendItem color={SERIES_COLORS.expense} label={t("legendExpense")} />
          </Flex>
        </section>
      </Flex>

      <Flex direction="column" gap="3" asChild>
        <section>
          <Heading as="h2" size="4">{t("contributionsTitle")}</Heading>
          {!hasGroup ? (
            <Text size="2" color="gray">
              {t("noGroup")}
            </Text>
          ) : contributions.length === 0 ? (
            <Text size="2" color="gray">
              {t("contributionsEmpty")}
            </Text>
          ) : (
            <Flex direction="column" gap="3">
              {contributions.map((row) => (
                <ContributionRow key={row.userId} row={row} />
              ))}
            </Flex>
          )}
        </section>
      </Flex>
    </Flex>
  );
}

// A colour dot beside its series name.
function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <Flex align="center" gap="2">
      <Box
        style={{
          width: 12,
          height: 12,
          borderRadius: "9999px",
          background: color,
        }}
      />
      <Text size="2" color="gray">
        {label}
      </Text>
    </Flex>
  );
}

// One member's net contribution to the pot; the caller's own row wears the self
// label when it carries no name.
function ContributionRow({ row }: { row: MemberContributionNamed }) {
  const t = useTranslations();
  const format = useFormatter();

  const name = row.isSelf && row.name === null ? t("members.you") : row.name ?? t("members.you");

  return (
    <Flex align="center" gap="3">
      <Text as="div" size="3" style={{ flex: 1, minWidth: 0 }} truncate>
        {name}
      </Text>
      <Text
        size="3"
        weight="medium"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {format.number(centsToPesos(row.contributionCents), "currency")}
      </Text>
    </Flex>
  );
}
