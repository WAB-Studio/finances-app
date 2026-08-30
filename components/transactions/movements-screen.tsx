"use client";

import {
  createColumnHelper,
  createPaginatedRowModel,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import {
  Button,
  Card,
  CategoryTile,
  EmptyState,
  Flex,
  Heading,
  IconButton,
  MovementRow,
  SegmentedControl,
  Select,
  Text,
  TextField,
} from "@/components/ui";
import type { TransactionFormOptions } from "@/db/queries/transaction-form";
import type { TransactionListRow } from "@/db/queries/transactions";
import { usePathname, useRouter, Link as LocaleLink } from "@/i18n/navigation";
import { addCivilDays, civilDateToDate, todayInBogota } from "@/lib/dates";
import { centsToPesos } from "@/lib/money";

// The type chip's value, mirrored one-to-one onto the `?type=` query and, on the
// server, onto the movement's generated kind (RF-19, RF-23).
type MovementType = "all" | "expense" | "income" | "transfer";

type MovementsFilters = {
  type: MovementType;
  from: string | null;
  to: string | null;
  member: string | null;
  account: string | null;
  category: string | null;
  // The deep-link flag: kept through any chip change so the filtered view stays
  // put until the user clears the filters (RF-31).
  unreviewed: boolean;
};

// A Radix Select item may not carry an empty value, so the "any" option rides
// this sentinel and maps back to null the moment it is picked.
const ANY = "all";
const PAGE_SIZE = 20;

// Paging is the only client model the list needs; every filter runs in Postgres,
// so no sorting or filtering feature is registered here.
const features = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
const columnHelper = createColumnHelper<typeof features, TransactionListRow>();
const columns = columnHelper.columns([columnHelper.accessor("id", {})]);

// A run of rows that share one calendar day, under a Hoy/Ayer/explicit-date head.
type DayGroup = { key: string; label: string; rows: TransactionListRow[] };

/**
 * The filterable ledger: type chips and the filter panel rewrite the URL query
 * so a year of data is narrowed in Postgres and the view stays shareable (RNF-09,
 * RF-23). The returned rows page through TanStack Table on the client, then group
 * by day for the list. A filter combination with no match lands on the empty
 * state whose action clears the query. Money stays integer cents; the sign and
 * the format are display only.
 */
export function MovementsScreen({
  rows,
  options,
  filters,
}: {
  rows: TransactionListRow[];
  options: TransactionFormOptions;
  filters: MovementsFilters;
}) {
  const t = useTranslations("transactions");
  const format = useFormatter();
  const pathname = usePathname();
  const router = useRouter();

  const [showFilters, setShowFilters] = useState(false);

  const table = useTable(
    {
      features,
      data: rows,
      columns,
      initialState: { pagination: { pageIndex: 0, pageSize: PAGE_SIZE } },
    },
    (state) => ({ pagination: state.pagination }),
  );

  // A name and colour per account and per category id — children included — so a
  // row reads its title, subtitle and tile without a second lookup.
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

  const today = todayInBogota();
  const yesterday = addCivilDays(today, -1);

  function dayLabel(occurredAt: string): string {
    if (occurredAt === today) return t("today");
    if (occurredAt === yesterday) return t("yesterday");
    return format.dateTime(civilDateToDate(occurredAt), {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  // The rows arrive ordered by day descending, so one pass opens a new group on
  // each day change and keeps that order.
  const pageRows = table.getPaginatedRowModel().rows.map((row) => row.original);
  const groups: DayGroup[] = [];
  for (const row of pageRows) {
    const current = groups.at(-1);
    if (current && current.key === row.occurredAt) {
      current.rows.push(row);
    } else {
      groups.push({
        key: row.occurredAt,
        label: dayLabel(row.occurredAt),
        rows: [row],
      });
    }
  }

  const filtersActive =
    filters.type !== "all" ||
    filters.unreviewed ||
    Boolean(
      filters.from ||
        filters.to ||
        filters.member ||
        filters.account ||
        filters.category,
    );

  // Only the well-formed values ride the query; a cleared field drops its key so
  // the URL never carries an empty parameter.
  function toQuery(next: MovementsFilters): Record<string, string> {
    const query: Record<string, string> = {};
    if (next.type !== "all") query.type = next.type;
    if (next.from) query.from = next.from;
    if (next.to) query.to = next.to;
    if (next.member) query.member = next.member;
    if (next.account) query.account = next.account;
    if (next.category) query.category = next.category;
    if (next.unreviewed) query.unreviewed = "1";
    return query;
  }

  function updateFilters(patch: Partial<MovementsFilters>) {
    router.push(
      { pathname, query: toQuery({ ...filters, ...patch }) },
      { scroll: false },
    );
  }

  function clearFilters() {
    router.push({ pathname, query: {} }, { scroll: false });
  }

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center" gap="3">
        <Heading size="5">{t("listTitle")}</Heading>
        <IconButton
          type="button"
          variant={showFilters || filtersActive ? "soft" : "ghost"}
          color="gray"
          size="3"
          aria-label={t("filtersLabel")}
          onClick={() => setShowFilters((open) => !open)}
        >
          <SlidersHorizontal size={18} />
        </IconButton>
      </Flex>

      <SegmentedControl.Root
        value={filters.type}
        onValueChange={(value) => updateFilters({ type: value as MovementType })}
      >
        <SegmentedControl.Item value="all">{t("filterAll")}</SegmentedControl.Item>
        <SegmentedControl.Item value="expense">
          {t("filterExpenses")}
        </SegmentedControl.Item>
        <SegmentedControl.Item value="income">
          {t("filterIncome")}
        </SegmentedControl.Item>
        <SegmentedControl.Item value="transfer">
          {t("filterTransfers")}
        </SegmentedControl.Item>
      </SegmentedControl.Root>

      {showFilters && (
        <Card>
          <Flex direction="column" gap="3">
            <Flex gap="3" wrap="wrap">
              <FilterField label={t("rangeFrom")}>
                <TextField.Root
                  type="date"
                  value={filters.from ?? ""}
                  onChange={(event) =>
                    updateFilters({ from: event.target.value || null })
                  }
                />
              </FilterField>
              <FilterField label={t("rangeTo")}>
                <TextField.Root
                  type="date"
                  value={filters.to ?? ""}
                  onChange={(event) =>
                    updateFilters({ to: event.target.value || null })
                  }
                />
              </FilterField>
            </Flex>

            <FilterField label={t("accountLabel")}>
              <Select.Root
                value={filters.account ?? ANY}
                onValueChange={(value) =>
                  updateFilters({ account: value === ANY ? null : value })
                }
              >
                <Select.Trigger />
                <Select.Content position="popper">
                  <Select.Item value={ANY}>{t("allAccounts")}</Select.Item>
                  {options.accounts.map((account) => (
                    <Select.Item key={account.id} value={account.id}>
                      {account.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </FilterField>

            <FilterField label={t("categoryLabel")}>
              <Select.Root
                value={filters.category ?? ANY}
                onValueChange={(value) =>
                  updateFilters({ category: value === ANY ? null : value })
                }
              >
                <Select.Trigger />
                <Select.Content position="popper">
                  <Select.Item value={ANY}>{t("allCategories")}</Select.Item>
                  {[...categoryNames].map(([id, name]) => (
                    <Select.Item key={id} value={id}>
                      {name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </FilterField>

            {options.members.length > 0 && (
              <FilterField label={t("createdBy")}>
                <Select.Root
                  value={filters.member ?? ANY}
                  onValueChange={(value) =>
                    updateFilters({ member: value === ANY ? null : value })
                  }
                >
                  <Select.Trigger />
                  <Select.Content position="popper">
                    <Select.Item value={ANY}>{t("allMembers")}</Select.Item>
                    {options.members.map((member) => (
                      <Select.Item key={member.userId} value={member.userId}>
                        {member.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </FilterField>
            )}

            {filtersActive && (
              <Button
                type="button"
                variant="soft"
                color="gray"
                onClick={clearFilters}
              >
                {t("clearFilters")}
              </Button>
            )}
          </Flex>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Search size={40} strokeWidth={1.6} />}
          title={t("filteredEmptyTitle")}
          description={t("filteredEmptyDescription")}
          action={
            filtersActive ? (
              <Button type="button" mt="2" onClick={clearFilters}>
                {t("clearFilters")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Flex direction="column" gap="5">
          {groups.map((group) => (
            <Flex key={group.key} direction="column" gap="2">
              <Text size="1" weight="bold" color="gray">
                {group.label.toUpperCase()}
              </Text>
              <Flex direction="column" gap="2">
                {group.rows.map((row) => (
                  <MovementCard
                    key={row.id}
                    row={row}
                    title={rowTitle(row, categoryNames, t)}
                    subtitle={rowSubtitle(row, accountNames)}
                    color={rowColor(row, categoryColors)}
                    amount={rowAmount(row, format)}
                    badge={row.recurringRuleId !== null ? t("autoBadge") : undefined}
                  />
                ))}
              </Flex>
            </Flex>
          ))}

          {table.getPageCount() > 1 && (
            <Flex justify="between" align="center" gap="3">
              <Button
                type="button"
                variant="soft"
                color="gray"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                <ChevronLeft size={16} />
                {t("previousPage")}
              </Button>
              <Text size="2" color="gray">
                {t("pageStatus", {
                  page: table.state.pagination.pageIndex + 1,
                  pages: table.getPageCount(),
                })}
              </Text>
              <Button
                type="button"
                variant="soft"
                color="gray"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                {t("nextPage")}
                <ChevronRight size={16} />
              </Button>
            </Flex>
          )}
        </Flex>
      )}
    </Flex>
  );
}

// A transfer names no category, so its title is the fixed kind word; an income or
// expense reads its first split's category (RF-19).
function rowTitle(
  row: TransactionListRow,
  categoryNames: Map<string, string>,
  t: ReturnType<typeof useTranslations>,
): string {
  if (row.kind === "transfer") return t("kindTransfer");
  const first = row.splits[0]?.categoryId;
  const fallback = row.kind === "income" ? t("kindIncome") : t("kindExpense");
  return (first && categoryNames.get(first)) || fallback;
}

// A transfer reads "origin → destination"; an income names its destination, an
// expense its source.
function rowSubtitle(
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

function rowColor(
  row: TransactionListRow,
  categoryColors: Map<string, string | null>,
): string | null {
  if (row.kind === "transfer") return null;
  const first = row.splits[0]?.categoryId;
  return (first && categoryColors.get(first)) ?? null;
}

// Income reads with a leading +, expense with a −, a transfer with neither; the
// figure is the peso view of the stored cents.
function rowAmount(
  row: TransactionListRow,
  format: ReturnType<typeof useFormatter>,
): string {
  const sign = row.kind === "income" ? "+" : row.kind === "expense" ? "−" : "";
  return `${sign}${format.number(centsToPesos(row.amountCents), "currency")}`;
}

function MovementCard({
  row,
  title,
  subtitle,
  color,
  amount,
  badge,
}: {
  row: TransactionListRow;
  title: string;
  subtitle?: string;
  color: string | null;
  amount: string;
  badge?: string;
}) {
  const tone =
    row.kind === "income"
      ? "income"
      : row.kind === "transfer"
        ? "transfer"
        : "expense";

  return (
    <Card asChild>
      <LocaleLink href={`/movements/${row.id}`}>
        <MovementRow
          tile={<CategoryTile color={color} />}
          title={title}
          subtitle={subtitle}
          amount={amount}
          tone={tone}
          badge={badge}
        />
      </LocaleLink>
    </Card>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Flex direction="column" gap="1" flexGrow="1" minWidth="0">
      <Text size="2" weight="medium" color="gray">
        {label}
      </Text>
      {children}
    </Flex>
  );
}
