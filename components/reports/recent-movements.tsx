import { ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import {
  CategoryTile,
  EmptyState,
  Flex,
  Heading,
  Link,
  Money,
  Text,
} from "@/components/ui";
import type { TransactionListRow } from "@/db/queries/transactions";
import { Link as LocaleLink } from "@/i18n/navigation";
import { civilDateToDate } from "@/lib/dates";

// A transfer carries neither category nor sign; an income and an expense read
// their first split's category and lean on the kind word only when none is set.
export type KindLabels = { transfer: string; income: string; expense: string };

// The row grid of the Inicio artboard: tile, title over account, date, amount.
const COLUMNS = "36px 1fr 110px 160px";

/**
 * The desktop dashboard's tail: the movements the ledger opens with (RF-23), each
 * a row into its detail, over a link to the full list. The names arrive already
 * mapped by the page, so a row costs no lookup of its own, and the amount is the
 * last cell in every one of them (RF-17, RF-18, RF-69).
 */
export function RecentMovements({
  rows,
  kindLabels,
  accountNames,
  categoryNames,
  categoryColors,
}: {
  rows: TransactionListRow[];
  kindLabels: KindLabels;
  accountNames: Map<string, string>;
  categoryNames: Map<string, string>;
  categoryColors: Map<string, string | null>;
}) {
  const t = useTranslations("transactions");
  const td = useTranslations("dashboard");
  const format = useFormatter();

  return (
    <div
      style={{
        backgroundColor: "var(--color-panel-solid)",
        border: "1px solid var(--gray-a4)",
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      <Flex align="center" justify="between" gap="3" style={{ padding: "14px 18px" }}>
        <Heading as="h2" size="3">
          {t("listTitle")}
        </Heading>
        <Link asChild size="2" weight="medium">
          <LocaleLink href="/movements">
            <Flex align="center" gap="1">
              {t("seeAll")}
              <ChevronRight size={13} strokeWidth={2.4} aria-hidden />
            </Flex>
          </LocaleLink>
        </Link>
      </Flex>

      {rows.length === 0 && (
        <EmptyState variant="filtered" title={td("emptyTitle")} />
      )}

      {rows.map((row) => (
        <LocaleLink
          key={row.id}
          href={`/movements/${row.id}`}
          style={{
            display: "grid",
            gridTemplateColumns: COLUMNS,
            gap: 14,
            alignItems: "center",
            height: 54,
            padding: "0 18px",
            borderTop: "1px solid var(--gray-a3)",
            color: "inherit",
            textDecoration: "none",
          }}
        >
          <CategoryTile color={rowColor(row, categoryColors)} size={36} />
          <Flex direction="column" minWidth="0">
            <Text size="2" weight="medium" truncate>
              {rowTitle(row, categoryNames, kindLabels)}
            </Text>
            <Text size="1" color="gray" truncate>
              {rowSubtitle(row, accountNames)}
            </Text>
          </Flex>
          <Text size="2" color="gray" style={{ fontVariantNumeric: "tabular-nums" }}>
            {format.dateTime(civilDateToDate(row.occurredAt), {
              day: "numeric",
              month: "short",
            })}
          </Text>
          <div style={{ textAlign: "right" }}>
            <Money cents={row.amountCents} tone={rowTone(row)} />
          </div>
        </LocaleLink>
      ))}
    </div>
  );
}

// A transfer names no category, so its title is the fixed kind word; an income or
// expense reads its first split's category (RF-19).
export function rowTitle(
  row: TransactionListRow,
  categoryNames: Map<string, string>,
  kindLabels: KindLabels,
): string {
  if (row.kind === "transfer") return kindLabels.transfer;
  const first = row.splits[0]?.categoryId;
  const fallback = row.kind === "income" ? kindLabels.income : kindLabels.expense;
  return (first && categoryNames.get(first)) || fallback;
}

// A transfer reads "origin → destination"; an income names its destination, an
// expense its source.
export function rowSubtitle(
  row: TransactionListRow,
  accountNames: Map<string, string>,
): string | undefined {
  if (row.kind === "transfer") {
    const from = (row.fromAccountId && accountNames.get(row.fromAccountId)) ?? "";
    const to = (row.toAccountId && accountNames.get(row.toAccountId)) ?? "";
    return `${from} → ${to}`;
  }
  const accountId = row.kind === "income" ? row.toAccountId : row.fromAccountId;
  return (accountId && accountNames.get(accountId)) ?? undefined;
}

// A transfer wears no category colour, so its tile stays the neutral surface.
export function rowColor(
  row: TransactionListRow,
  categoryColors: Map<string, string | null>,
): string | null {
  if (row.kind === "transfer") return null;
  const first = row.splits[0]?.categoryId;
  return (first && categoryColors.get(first)) ?? null;
}

// The union both `Money` and `MovementRow` accept, so the phone's card and the
// desktop row read one derivation.
export function rowTone(
  row: TransactionListRow,
): "income" | "transfer" | "expense" {
  if (row.kind === "income") return "income";
  if (row.kind === "transfer") return "transfer";
  return "expense";
}
