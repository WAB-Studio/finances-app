"use client";

import {
  createColumnHelper,
  createPaginatedRowModel,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";

import { deleteTransactionAction } from "@/app/actions/transactions";
import { MovementForm } from "@/components/transactions/movement-form";
import {
  MovementsFilterBar,
  type MovementsFilters,
  type MovementType,
} from "@/components/transactions/movements-filter-bar";
import {
  MovementsTable,
  type MovementTableRow,
} from "@/components/transactions/movements-table";
import { useQuickEntry } from "@/components/transactions/quick-entry-provider";
import {
  Box,
  Button,
  Card,
  CategoryTile,
  ColorSwatch,
  ConfirmDialog,
  Dialog,
  EmptyState,
  FilterField,
  Flex,
  Heading,
  IconButton,
  Money,
  MovementRow,
  ScreenHeader,
  SegmentedControl,
  Select,
  Text,
  TextField,
  VisuallyHidden,
} from "@/components/ui";
import type { TransactionFormOptions } from "@/db/queries/transaction-form";
import type { TransactionListRow } from "@/db/queries/transactions";
import { usePathname, useRouter, Link as LocaleLink } from "@/i18n/navigation";
import { addCivilDays, civilDateToDate, todayInBogota } from "@/lib/dates";
import { centsToPesos } from "@/lib/money";
import { useActionErrorToast } from "@/lib/use-action-toast";

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
 * The filterable ledger: the filter row and the type chips rewrite the URL query
 * so a year of data is narrowed in Postgres and the view stays shareable (RNF-09,
 * RF-23, RF-89). The returned rows page through TanStack Table on the client,
 * then render as the dense table of SPEC-A3 on a laptop and as day-grouped cards
 * on a phone. A filter combination with no match offers to clear them; a ledger
 * with nothing in it at all invites recording the first movement instead.
 * Money stays integer cents; the sign and the format are display only.
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
  const tKey = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const onActionError = useActionErrorToast();
  const { openQuick } = useQuickEntry();

  const [showFilters, setShowFilters] = useState(false);
  // The row a menu opened a dialog over; the ledger holds it, so both dialogs
  // are mounted once for the whole page (RF-24).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const remove = useAction(deleteTransactionAction, {
    onSuccess: () => setRemovingId(null),
    onError: onActionError,
  });

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

  // The description a person wrote wins the ledger's widest column; without one
  // the row falls back to what names it (RF-69).
  const tableRows: MovementTableRow[] = pageRows.map((row) => ({
    id: row.id,
    occurredAt: row.occurredAt,
    title: row.description || rowTitle(row, categoryNames, t),
    category: rowCategory(row, categoryNames, categoryColors),
    account: rowSubtitle(row, accountNames) ?? "",
    label: row.labels[0]?.name ?? null,
    amountCents: row.amountCents,
    tone: rowTone(row),
    auto: row.recurringRuleId !== null,
  }));

  // A transfer moves money between the caller's own accounts, so it moves the net
  // by nothing (RF-19). The figure spans every filtered row, not just this page.
  const netCents = rows.reduce(
    (total, row) =>
      row.kind === "income"
        ? total + row.amountCents
        : row.kind === "expense"
          ? total - row.amountCents
          : total,
    0,
  );

  const filtersActive =
    filters.type !== "all" ||
    filters.unreviewed ||
    Boolean(
      filters.from ||
        filters.to ||
        filters.member ||
        filters.account ||
        filters.category ||
        filters.label,
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
    if (next.label) query.label = next.label;
    if (next.unreviewed) query.unreviewed = "1";
    return query;
  }

  function updateFilters(next: MovementsFilters) {
    router.push({ pathname, query: toQuery(next) }, { scroll: false });
  }

  function patchFilters(patch: Partial<MovementsFilters>) {
    updateFilters({ ...filters, ...patch });
  }

  function clearFilters() {
    router.push({ pathname, query: {} }, { scroll: false });
  }

  // The download route parses the same schema this screen writes to the URL, so
  // the sheet holds exactly the rows the table is showing (RF-118, RF-50).
  const exportQuery = new URLSearchParams(toQuery(filters));
  exportQuery.set("entities", "transactions");
  const exportHref = `/${locale}/settings/data/export?${exportQuery.toString()}`;

  const editing = rows.find((row) => row.id === editingId) ?? null;

  return (
    <Flex direction="column" gap="4">
      {/* The laptop's band, filter row and table, and the phone's header, chips
          and panel: exactly one set is displayed at any width. */}
      <Box display={{ initial: "none", lg: "block" }}>
        <ScreenHeader
          title={t("listTitle")}
          meta={
            <>
              {t("listMeta", { count: rows.length })}{" "}
              <Money
                cents={netCents}
                tone={netCents < 0 ? "expense" : "income"}
                size="inherit"
              />
            </>
          }
          actions={
            rows.length > 0 && (
              <Button asChild variant="surface" color="gray">
                <a href={exportHref}>
                  <Download size={15} />
                  {t("export")}
                </a>
              </Button>
            )
          }
        />
      </Box>

      <Box display={{ initial: "none", lg: "block" }}>
        <MovementsFilterBar
          filters={filters}
          options={options}
          onChange={updateFilters}
        />
      </Box>

      <Box display={{ initial: "block", lg: "none" }}>
        <Flex direction="column" gap="4">
          <Flex justify="between" align="center" gap="3">
            <Heading size="5">{t("listTitle")}</Heading>
            <IconButton
              type="button"
              variant={showFilters || filtersActive ? "soft" : "ghost"}
              color="gray"
              size="3"
              aria-label={t("filtersLabel")}
              aria-expanded={showFilters}
              onClick={() => setShowFilters((open) => !open)}
            >
              <SlidersHorizontal size={18} />
            </IconButton>
          </Flex>

          <SegmentedControl.Root
            value={filters.type}
            onValueChange={(value) =>
              patchFilters({ type: value as MovementType })
            }
          >
            <SegmentedControl.Item value="all">
              {t("filterAll")}
            </SegmentedControl.Item>
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
                    {(id) => (
                      <TextField.Root
                        id={id}
                        type="date"
                        value={filters.from ?? ""}
                        onChange={(event) =>
                          patchFilters({ from: event.target.value || null })
                        }
                      />
                    )}
                  </FilterField>
                  <FilterField label={t("rangeTo")}>
                    {(id) => (
                      <TextField.Root
                        id={id}
                        type="date"
                        value={filters.to ?? ""}
                        onChange={(event) =>
                          patchFilters({ to: event.target.value || null })
                        }
                      />
                    )}
                  </FilterField>
                </Flex>

                <FilterField label={t("accountLabel")}>
                  {(id) => (
                    <Select.Root
                      value={filters.account ?? ANY}
                      onValueChange={(value) =>
                        patchFilters({ account: value === ANY ? null : value })
                      }
                    >
                      <Select.Trigger id={id} />
                      <Select.Content position="popper">
                        <Select.Item value={ANY}>{t("allAccounts")}</Select.Item>
                        {options.accounts.map((account) => (
                          <Select.Item key={account.id} value={account.id}>
                            {account.name}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  )}
                </FilterField>

                <FilterField label={t("categoryLabel")}>
                  {(controlId) => (
                    <Select.Root
                      value={filters.category ?? ANY}
                      onValueChange={(value) =>
                        patchFilters({ category: value === ANY ? null : value })
                      }
                    >
                      <Select.Trigger id={controlId} />
                      <Select.Content position="popper">
                        <Select.Item value={ANY}>
                          {t("allCategories")}
                        </Select.Item>
                        {[...categoryNames].map(([id, name]) => (
                          <Select.Item key={id} value={id}>
                            {name}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  )}
                </FilterField>

                {/* The ledger spans both scopes, so the read filter offers every
                    label — unlike the write pickers, which narrow to one (RF-89). */}
                {options.labels.length > 0 && (
                  <FilterField label={t("labelFilterLabel")}>
                    {(id) => (
                      <Select.Root
                        value={filters.label ?? ANY}
                        onValueChange={(value) =>
                          patchFilters({ label: value === ANY ? null : value })
                        }
                      >
                        <Select.Trigger id={id} />
                        <Select.Content position="popper">
                          <Select.Item value={ANY}>{t("allLabels")}</Select.Item>
                          {options.labels.map((label) => (
                            <Select.Item key={label.id} value={label.id}>
                              <Flex as="span" align="center" gap="2">
                                {/* `color` is a nullable column; a label stored
                                    without one keeps its name. */}
                                {label.color && (
                                  <ColorSwatch color={label.color} />
                                )}
                                {label.name}
                              </Flex>
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                    )}
                  </FilterField>
                )}

                {options.members.length > 0 && (
                  <FilterField label={t("createdBy")}>
                    {(id) => (
                      <Select.Root
                        value={filters.member ?? ANY}
                        onValueChange={(value) =>
                          patchFilters({ member: value === ANY ? null : value })
                        }
                      >
                        <Select.Trigger id={id} />
                        <Select.Content position="popper">
                          <Select.Item value={ANY}>
                            {t("allMembers")}
                          </Select.Item>
                          {options.members.map((member) => (
                            <Select.Item key={member.userId} value={member.userId}>
                              {member.name}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                    )}
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
        </Flex>
      </Box>

      {rows.length === 0 ? (
        filtersActive ? (
          <EmptyState
            variant="filtered"
            icon={<Search size={40} strokeWidth={1.6} />}
            title={t("filteredEmptyTitle")}
            description={t("filteredEmptyDescription")}
            action={
              <Button type="button" mt="2" onClick={clearFilters}>
                {t("clearFilters")}
              </Button>
            }
          />
        ) : (
          // Nothing is filtered, so nothing here names a filter: the ledger is
          // empty because no movement has been recorded yet (FLOWS §9).
          <EmptyState
            icon={<ArrowRightLeft size={40} strokeWidth={1.6} />}
            title={t("emptyTitle")}
            action={
              <Button type="button" size="3" mt="2" onClick={openQuick}>
                <Plus size={18} strokeWidth={2.2} />
                {t("quickTitle")}
              </Button>
            }
          />
        )
      ) : (
        <>
          <Box display={{ initial: "none", lg: "block" }}>
            <MovementsTable
              rows={tableRows}
              page={table.state.pagination.pageIndex + 1}
              pageCount={table.getPageCount()}
              onPrev={() => table.previousPage()}
              onNext={() => table.nextPage()}
              onEdit={setEditingId}
              onDelete={setRemovingId}
            />
          </Box>

          <Box display={{ initial: "block", lg: "none" }}>
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
                        badge={
                          row.recurringRuleId !== null ? t("autoBadge") : undefined
                        }
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
          </Box>
        </>
      )}

      <Dialog.Root
        open={editing !== null}
        onOpenChange={(open) => !open && setEditingId(null)}
      >
        <Dialog.Content>
          {/* The form carries its own heading; the title stays for the a11y tree. */}
          <VisuallyHidden>
            <Dialog.Title>{t("formTitle")}</Dialog.Title>
          </VisuallyHidden>
          {/* Closing unmounts the content, so the form reseeds on each open. */}
          {editing && (
            <MovementForm
              mode="edit"
              options={options}
              movement={editing}
              onDone={() => setEditingId(null)}
            />
          )}
        </Dialog.Content>
      </Dialog.Root>

      <ConfirmDialog
        open={removingId !== null}
        onOpenChange={(open) => !open && setRemovingId(null)}
        title={t("deleteTitle")}
        description={t("deleteDescription")}
        confirmLabel={t("delete")}
        cancelLabel={tKey("common.cancel")}
        pending={remove.isPending}
        onConfirm={() =>
          removingId && remove.execute({ transactionId: removingId })
        }
      />
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

// The table's own category cell: the name and the dot beside it, or nothing at
// all for a transfer, which carries no split to read one from (RF-69).
function rowCategory(
  row: TransactionListRow,
  categoryNames: Map<string, string>,
  categoryColors: Map<string, string | null>,
): { name: string; color: string | null } | null {
  if (row.kind === "transfer") return null;
  const first = row.splits[0]?.categoryId;
  const name = first && categoryNames.get(first);
  return name ? { name, color: categoryColors.get(first) ?? null } : null;
}

// The union both `Money` and `MovementRow` accept, so the phone's card and the
// table's row read one derivation of the kind (RF-18).
function rowTone(
  row: TransactionListRow,
): "income" | "transfer" | "expense" {
  if (row.kind === "income") return "income";
  if (row.kind === "transfer") return "transfer";
  return "expense";
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
  return (
    <Card asChild>
      <LocaleLink href={`/movements/${row.id}`}>
        <MovementRow
          tile={<CategoryTile color={color} />}
          title={title}
          subtitle={subtitle}
          amount={amount}
          tone={rowTone(row)}
          badge={badge}
        />
      </LocaleLink>
    </Card>
  );
}
