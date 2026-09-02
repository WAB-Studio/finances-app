"use client";

import { useFormatter, useTranslations } from "next-intl";

import {
  Badge,
  CategoryTile,
  DataTable,
  Flex,
  Link,
  Money,
  RowMenu,
  TablePagination,
  Text,
  type DataColumn,
  type MoneyTone,
} from "@/components/ui";
import { Link as LocaleLink } from "@/i18n/navigation";
import { civilDateToDate } from "@/lib/dates";

// One movement, already named: the screen holds the account and category maps,
// so a cell costs no lookup of its own.
export type MovementTableRow = {
  id: string;
  occurredAt: string;
  title: string;
  // A transfer names no category, and neither does an income or expense whose
  // category was archived away from the picker (RF-69).
  category: { name: string; color: string | null } | null;
  account: string;
  label: string | null;
  amountCents: number;
  // Derived from the accounts the movement carries, never stored (RF-18).
  tone: MoneyTone;
  auto: boolean;
};

// The em dash a cell with nothing to name reads as (SPEC-A3), not a word a
// translator would ever change.
const NO_VALUE = "—";

// The tracks of TablaDensa, in order. The last one is wider than the artboard's:
// it holds the amount and the row's menu, which that ledger has no room for.
const WIDTHS = {
  date: "96px",
  description: "minmax(0, 1fr)",
  category: "168px",
  account: "190px",
  label: "108px",
  amount: "160px",
} as const;

/**
 * The dense ledger of `private/design-desktop/SPEC-A3.md` (RF-23, RF-48): six
 * columns, the newest day first, and each row's own menu at the end of it
 * (RF-24). Nothing is stored here — the caller owns the page and hands over the
 * rows it wants drawn, so the ledger renders whatever the URL's filters selected.
 */
export function MovementsTable({
  rows,
  page,
  pageCount,
  onPrev,
  onNext,
  onEdit,
  onDelete,
}: {
  rows: MovementTableRow[];
  // One-based, as the caption reads it.
  page: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations("transactions");
  const format = useFormatter();

  const columns: DataColumn<MovementTableRow>[] = [
    {
      key: "date",
      header: t("dateLabel"),
      width: WIDTHS.date,
      // The rows arrive newest first out of Postgres, and no other order is on
      // offer, so the chevron reports the sort rather than opening one.
      sort: "desc",
      cell: (row) => (
        <Text size="2" color="gray">
          {format.dateTime(civilDateToDate(row.occurredAt), {
            day: "numeric",
            month: "short",
          })}
        </Text>
      ),
    },
    {
      key: "description",
      header: t("descriptionLabel"),
      width: WIDTHS.description,
      cell: (row) => (
        <Flex align="center" gap="2" minWidth="0">
          <Link asChild size="2" weight="medium" color="gray" highContrast truncate>
            <LocaleLink href={`/movements/${row.id}`}>{row.title}</LocaleLink>
          </Link>
          {row.auto && (
            <Badge color="amber" variant="soft" radius="full">
              {t("autoBadge")}
            </Badge>
          )}
        </Flex>
      ),
    },
    {
      key: "category",
      header: t("categoryLabel"),
      width: WIDTHS.category,
      cell: (row) =>
        row.category ? (
          <Flex align="center" gap="2" minWidth="0">
            <CategoryTile color={row.category.color} size={9} />
            <Text size="2" color="gray" truncate>
              {row.category.name}
            </Text>
          </Flex>
        ) : (
          <Text size="2" color="gray">
            {NO_VALUE}
          </Text>
        ),
    },
    {
      key: "account",
      header: t("accountLabel"),
      width: WIDTHS.account,
      cell: (row) => (
        <Text size="2" color="gray" truncate>
          {row.account}
        </Text>
      ),
    },
    {
      key: "label",
      header: t("labelFilterLabel"),
      width: WIDTHS.label,
      cell: (row) =>
        row.label && (
          <Text size="1" color="gray" truncate>
            {row.label}
          </Text>
        ),
    },
    {
      key: "amount",
      header: t("amountLabel"),
      width: WIDTHS.amount,
      align: "end",
      cell: (row) => (
        <Flex align="center" justify="end" gap="1">
          <Money cents={row.amountCents} tone={row.tone} />
          <RowMenu
            rowName={row.title}
            items={[
              { key: "edit", label: t("edit"), onSelect: () => onEdit(row.id) },
              {
                key: "delete",
                label: t("delete"),
                tone: "danger",
                onSelect: () => onDelete(row.id),
              },
            ]}
          />
        </Flex>
      ),
    },
  ];

  return (
    <DataTable
      label={t("listTitle")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      footer={
        pageCount > 1 && (
          <TablePagination
            caption={t("pageStatus", { page, pages: pageCount })}
            onPrev={page > 1 ? onPrev : undefined}
            onNext={page < pageCount ? onNext : undefined}
            prevLabel={t("previousPage")}
            nextLabel={t("nextPage")}
          />
        )
      }
    />
  );
}
