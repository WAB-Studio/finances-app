"use client";

import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";

import {
  Badge,
  Button,
  DataTable,
  Flex,
  Money,
  Progress,
  RowMenu,
  TablePagination,
  Text,
  type DataColumn,
} from "@/components/ui";
import type { GoalProgress } from "@/db/queries/savings-goals";
import { civilDateToDate } from "@/lib/dates";
import { centsToPesos } from "@/lib/money";

// The em dash a cell with nothing to name reads as (SPEC-A3), not a word a
// translator would ever change.
const NO_VALUE = "—";

// The tracks of the Metas artboard, in order.
const WIDTHS = {
  goal: "minmax(0, 1fr)",
  progress: "130px",
  pace: "224px",
  saved: "128px",
  remaining: "128px",
  targetDate: "84px",
  contribute: "96px",
  menu: "36px",
} as const;

// The four states the ritmo column reads as, derived from figures the server
// already derived — never stored (RNF-07).
type Pace = "reached" | "noDate" | "behind" | "onTrack";

function paceOf(goal: GoalProgress): Pace {
  if (goal.reachedTarget) return "reached";
  if (goal.targetDate === null) return "noDate";
  return goal.behindPace ? "behind" : "onTrack";
}

const PACE_LABEL = {
  reached: "paceReached",
  noDate: "paceNoDate",
  behind: "paceBehind",
  onTrack: "paceOnTrack",
} as const;

const PACE_COLOR = {
  reached: "jade",
  noDate: "gray",
  behind: "amber",
  onTrack: "jade",
} as const;

/**
 * The dense Metas of `private/design-desktop/SPEC-A3.md` (RF-76, RF-87): a goal
 * per row with its bar, its ritmo, what it has apartado and what it still needs,
 * and a total that sums the rows on screen. Every figure arrives derived from the
 * server and is only formatted here; nothing is stored (RNF-07). The caller owns
 * the page and hands over the rows it wants drawn.
 */
export function GoalsTable({
  rows,
  archived,
  page,
  pageSize,
  total,
  empty,
  onPrev,
  onNext,
  onContribute,
  onUndo,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  rows: GoalProgress[];
  // An archived goal is read-only: no aporte reaches it and none is undone from
  // it, so the way back is all its menu offers (RF-120).
  archived: boolean;
  // One-based, as the caption reads it.
  page: number;
  pageSize: number;
  // Every goal on this side of the tabs, not this page's.
  total: number;
  empty?: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  onContribute: (goal: GoalProgress) => void;
  onUndo: (goal: GoalProgress) => void;
  onEdit: (goal: GoalProgress) => void;
  onArchive: (goal: GoalProgress) => void;
  onRestore: (goal: GoalProgress) => void;
  onDelete: (goal: GoalProgress) => void;
}) {
  const t = useTranslations("goals");
  const tKey = useTranslations();
  const format = useFormatter();

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  function pesos(cents: number): string {
    return format.number(centsToPesos(cents), "currency");
  }

  // The rows on screen, which is what the total row states: a page sums itself.
  const savedTotalCents = rows.reduce((sum, goal) => sum + goal.savedCents, 0);
  const remainingTotalCents = rows.reduce(
    (sum, goal) => sum + goal.remainingCents,
    0,
  );
  const targetTotalCents = savedTotalCents + remainingTotalCents;
  const totalPct =
    targetTotalCents > 0
      ? Math.round((savedTotalCents / targetTotalCents) * 100)
      : 0;

  const columns: DataColumn<GoalProgress>[] = [
    {
      key: "goal",
      header: t("tableGoal"),
      width: WIDTHS.goal,
      cell: (goal) => (
        <Text size="2" weight="medium" truncate>
          {goal.name}
        </Text>
      ),
    },
    {
      key: "progress",
      header: t("tableProgress"),
      width: WIDTHS.progress,
      cell: (goal) => (
        <Progress
          value={goal.progressPct}
          color={goal.behindPace ? "amber" : undefined}
          aria-label={t("progressLabel", {
            name: goal.name,
            amount: pesos(goal.savedCents),
            pct: goal.progressPct,
          })}
        />
      ),
    },
    {
      key: "pace",
      header: t("tablePace"),
      width: WIDTHS.pace,
      // The rows arrive ordered by ritmo out of Postgres — atrasada first, sin
      // fecha last — and no other order is on offer, so the chevron reports the
      // sort rather than opening one.
      sort: "asc",
      cell: (goal) => {
        const pace = paceOf(goal);

        return (
          <Flex align="center" gap="2" minWidth="0">
            <Badge color={PACE_COLOR[pace]} variant="soft" radius="full">
              {t(PACE_LABEL[pace])}
            </Badge>
            {goal.requiredMonthlyCents === null ? (
              <Text size="2" color="gray">
                {NO_VALUE}
              </Text>
            ) : (
              <Text size="2" color={pace === "behind" ? "amber" : "gray"}>
                <Money
                  cents={goal.requiredMonthlyCents}
                  size="inherit"
                  signed={false}
                />
                {t("perMonth")}
              </Text>
            )}
          </Flex>
        );
      },
    },
    {
      key: "saved",
      header: t("apartado"),
      width: WIDTHS.saved,
      align: "end",
      numeric: true,
      cell: (goal) => <Money cents={goal.savedCents} signed={false} />,
    },
    {
      key: "remaining",
      header: t("tableRemaining"),
      width: WIDTHS.remaining,
      align: "end",
      numeric: true,
      cell: (goal) => (
        <Text color="gray">
          <Money cents={goal.remainingCents} signed={false} />
        </Text>
      ),
    },
    {
      key: "targetDate",
      header: t("targetDateLabel"),
      width: WIDTHS.targetDate,
      align: "end",
      numeric: true,
      cell: (goal) => (
        <Text size="2" color="gray">
          {goal.targetDate
            ? format.dateTime(civilDateToDate(goal.targetDate), {
                day: "numeric",
                month: "short",
              })
            : NO_VALUE}
        </Text>
      ),
    },
    {
      key: "contribute",
      header: "",
      width: WIDTHS.contribute,
      align: "end",
      cell: (goal) =>
        !archived && (
          <Button
            type="button"
            variant="surface"
            color="gray"
            onClick={() => onContribute(goal)}
          >
            {t("contribute")}
          </Button>
        ),
    },
    {
      key: "menu",
      header: "",
      width: WIDTHS.menu,
      align: "end",
      cell: (goal) => (
        <RowMenu
          rowName={goal.name}
          items={
            archived
              ? [
                  {
                    key: "restore",
                    label: tKey("common.restore"),
                    onSelect: () => onRestore(goal),
                  },
                  {
                    key: "delete",
                    label: tKey("common.delete"),
                    tone: "danger",
                    onSelect: () => onDelete(goal),
                  },
                ]
              : [
                  // A goal nobody has contributed to has nothing to undo.
                  ...(goal.savedCents > 0
                    ? [
                        {
                          key: "undo",
                          label: t("undoContribution"),
                          onSelect: () => onUndo(goal),
                        },
                      ]
                    : []),
                  {
                    key: "edit",
                    label: tKey("common.edit"),
                    onSelect: () => onEdit(goal),
                  },
                  {
                    key: "archive",
                    label: tKey("common.archive"),
                    onSelect: () => onArchive(goal),
                  },
                  {
                    key: "delete",
                    label: tKey("common.delete"),
                    tone: "danger",
                    onSelect: () => onDelete(goal),
                  },
                ]
          }
        />
      ),
    },
  ];

  return (
    <DataTable
      label={t("title")}
      columns={columns}
      rows={rows}
      rowKey={(goal) => goal.id}
      empty={empty}
      total={
        rows.length > 0
          ? [
              <Text key="label" size="1" weight="bold" color="gray">
                {t("tableTotal").toUpperCase()}
              </Text>,
              <Progress
                key="progress"
                value={totalPct}
                aria-label={t("totalProgressLabel", {
                  saved: pesos(savedTotalCents),
                  target: pesos(targetTotalCents),
                  pct: totalPct,
                })}
              />,
              null,
              <Money key="saved" cents={savedTotalCents} signed={false} />,
              <Text key="remaining" color="gray">
                <Money cents={remainingTotalCents} signed={false} />
              </Text>,
            ]
          : undefined
      }
      footer={
        pageCount > 1 && (
          <TablePagination
            caption={t("pageRange", { from, to, total })}
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
