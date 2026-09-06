"use client";

import { useTranslations } from "next-intl";

import { DataTable, Text, type DataColumn } from "@/components/ui";

// The em dash a cell with nothing to name reads as (SPEC-A3), not a word a
// translator would ever change.
const NO_VALUE = "—";

// One error, already flattened and translated: the screen owns the entity and
// message lookups (`sheets.*`, the error's own namespace), so this table costs
// no lookup of its own.
export type ImportErrorRow = {
  key: string;
  sheet: string;
  rowIndex: number;
  problem: string;
};

const WIDTHS = {
  sheet: "170px",
  rowIndex: "88px",
  column: "170px",
  value: "170px",
  problem: "minmax(0, 1fr)",
} as const;

/**
 * The import preview's per-row errors (RF-51), flattened across every sheet
 * into one table over the same all-or-nothing confirm the screen already
 * gates: one errored row anywhere still writes nothing. "Columna" and "valor"
 * read as unknown for now — the preview the server returns
 * (`app/actions/import.ts`) carries only a row's position and its message
 * keys, never the field path or the raw cell `lib/spreadsheet/import-pipeline.ts`
 * read it from, so naming either here would be a guess neither of those files
 * makes today.
 */
export function ImportErrorsTable({ rows }: { rows: ImportErrorRow[] }) {
  const t = useTranslations("data");

  const columns: DataColumn<ImportErrorRow>[] = [
    {
      key: "sheet",
      header: t("screen.reportSheet"),
      width: WIDTHS.sheet,
      cell: (row) => (
        <Text size="2" color="gray" truncate>
          {row.sheet}
        </Text>
      ),
    },
    {
      key: "rowIndex",
      header: t("screen.reportRow"),
      width: WIDTHS.rowIndex,
      numeric: true,
      cell: (row) => <Text size="2">{row.rowIndex}</Text>,
    },
    {
      key: "column",
      header: t("screen.reportColumn"),
      width: WIDTHS.column,
      cell: () => (
        <Text size="2" color="gray">
          {NO_VALUE}
        </Text>
      ),
    },
    {
      key: "value",
      header: t("screen.reportValue"),
      width: WIDTHS.value,
      cell: () => (
        <Text size="2" color="gray">
          {NO_VALUE}
        </Text>
      ),
    },
    {
      key: "problem",
      header: t("screen.reportProblem"),
      width: WIDTHS.problem,
      cell: (row) => <Text size="2">{row.problem}</Text>,
    },
  ];

  return (
    <DataTable
      label={t("screen.importHeading")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
    />
  );
}
