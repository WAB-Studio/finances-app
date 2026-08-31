import "server-only";

import ExcelJS from "exceljs";

import type { ExportResult } from "@/db/queries/export";
import {
  SHEET_ENTITIES,
  sheetDescriptors,
  type SheetEntity,
} from "@/lib/spreadsheet/schema";

// A parsed cell holds a resolved name, a scalar, integer cents or nothing — the
// shape `readExport` emits. The money boundary turns cents into a decimal COP
// number here and nowhere else.
type CellValue = string | number | boolean | null;

// One column seen through the shared contract: `satisfies` narrowed each literal,
// so only some carry `money` or `ref`; this view restores the optional markers for
// iteration without reaching back into a concrete descriptor's type.
type ColumnView = {
  readonly key: string;
  readonly field: string;
  readonly money?: { readonly toSheet: (cents: number) => number };
  readonly ref?: { readonly entity: "accounts" | "categories" };
};

// The interface text a person reads on the sheet (RF-49): the localized tab name
// per entity and the localized header per descriptor column key. The route builds
// these from next-intl; this module stays free of the message catalogue.
export type SheetLabels = {
  readonly sheetName: (entity: SheetEntity) => string;
  readonly columnHeader: (key: string) => string;
};

// The hidden sheet the template's dropdowns read their options from. A fixed,
// space-free name so a cross-sheet list formula references it without quoting.
const OPTIONS_SHEET = "options";

// The template validates a generous span of rows so a person can paste many rows
// under each header and still get the dropdown. The options source stays exactly
// as long as its list, so the dropdown carries no trailing blank entries.
const TEMPLATE_DATA_ROWS = 500;

// One cell's written value: a money column crosses the cents→pesos boundary right
// here (the only float in the pipeline), a null becomes an empty cell, the rest
// pass through as the resolved name or scalar `readExport` already produced.
function cellValue(column: ColumnView, value: CellValue): CellValue {
  if (value == null) return null;
  if (column.money) return column.money.toSheet(value as number);
  return value;
}

// Spreadsheet column letter from a 1-based index (1→A, 27→AA), so a list formula
// can point at the right options column without hard-coding the letters.
function columnLetter(index: number): string {
  let remaining = index;
  let letter = "";
  while (remaining > 0) {
    const rem = (remaining - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letter;
}

// The absolute cross-sheet range a dropdown reads, or null when the list is empty
// — an empty range is not a valid list source, so that ref column keeps no rule.
function optionRange(columnIndex: number, count: number): string | null {
  if (count <= 0) return null;
  const letter = columnLetter(columnIndex);
  return `${OPTIONS_SHEET}!$${letter}$1:$${letter}$${count}`;
}

/**
 * The export workbook (RF-50): one worksheet per entity present in `data`, walked
 * in the fixed `SHEET_ENTITIES` order so every download shares the same layout. A
 * header row from the descriptor's column order leads, the caller's rows follow,
 * each cell crossing the money boundary only where the descriptor marks it.
 */
export function buildWorkbook(input: {
  data: ExportResult;
  labels: SheetLabels;
}): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();

  for (const entity of SHEET_ENTITIES) {
    const rows = input.data[entity];
    if (rows === undefined) continue;

    const sheet = workbook.addWorksheet(input.labels.sheetName(entity));
    const columns = sheetDescriptors[entity].columns as readonly ColumnView[];

    sheet.addRow(columns.map((column) => input.labels.columnHeader(column.key)));

    for (const row of rows) {
      const record = row as Record<string, CellValue>;
      sheet.addRow(columns.map((column) => cellValue(column, record[column.key])));
    }
  }

  return workbook;
}

/**
 * The fill-in template (RF-49): all five sheets, header row only, plus a hidden
 * options sheet holding the caller's existing account and category names. Every
 * account-referencing column (transactions/recurring `fromAccount`/`toAccount`)
 * gets a dropdown against the account list; every category-referencing column
 * (recurring `category`, categories `parent`) against the category list — the
 * reason a workbook, not a CSV, ships here.
 */
export function buildTemplate(input: {
  labels: SheetLabels;
  accountNames: string[];
  categoryNames: string[];
}): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();

  const options = workbook.addWorksheet(OPTIONS_SHEET, { state: "hidden" });
  input.accountNames.forEach((name, index) => {
    options.getCell(index + 1, 1).value = name;
  });
  input.categoryNames.forEach((name, index) => {
    options.getCell(index + 1, 2).value = name;
  });

  const rangeByRef: Record<"accounts" | "categories", string | null> = {
    accounts: optionRange(1, input.accountNames.length),
    categories: optionRange(2, input.categoryNames.length),
  };

  for (const entity of SHEET_ENTITIES) {
    const sheet = workbook.addWorksheet(input.labels.sheetName(entity));
    const columns = sheetDescriptors[entity].columns as readonly ColumnView[];

    sheet.addRow(columns.map((column) => input.labels.columnHeader(column.key)));

    columns.forEach((column, index) => {
      if (!column.ref) return;
      const range = rangeByRef[column.ref.entity];
      if (range === null) return;

      const columnIndex = index + 1;
      for (let row = 2; row <= TEMPLATE_DATA_ROWS; row += 1) {
        sheet.getCell(row, columnIndex).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [range],
        };
      }
    });
  }

  return workbook;
}
