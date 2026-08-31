import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { readExport } from "@/db/queries/export";
import { requireUser } from "@/db/session";
import { isCivilDate } from "@/lib/dates";
import { TIME_ZONE } from "@/lib/locales";
import { SHEET_ENTITIES, type SheetEntity } from "@/lib/spreadsheet/schema";
import { buildWorkbook, type SheetLabels } from "@/lib/spreadsheet/workbook";
import { routing } from "@/i18n/routing";

// ExcelJS writes with Node streams and zlib, so the workbook build stays on the
// Node runtime; the read is user-scoped, so nothing here is prerendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SPREADSHEET_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// A malformed bound never reaches Postgres: a bad civil date drops to undefined,
// mirroring the audit viewer's `.catch()` guard.
const civilDate = z
  .string()
  .refine(isCivilDate)
  .catch(() => undefined as unknown as string)
  .optional();

// The caller's own Bogotá day (RNF-06), for a filename a person recognizes.
function todayInBogota(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
}

// The requested entities, from a comma-separated list or repeated `entities` keys;
// anything unknown is dropped and an empty selection falls back to all five (RF-50).
function requestedEntities(params: URLSearchParams): SheetEntity[] {
  const known = SHEET_ENTITIES as readonly string[];
  const picked = params
    .getAll("entities")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value): value is SheetEntity => known.includes(value));

  const unique = SHEET_ENTITIES.filter((entity) => picked.includes(entity));
  return unique.length > 0 ? unique : [...SHEET_ENTITIES];
}

/**
 * The export download (RF-50). Streams an `.xlsx` of the caller's rows — one sheet
 * per requested entity, headers and tab names localized, references shown as names,
 * money as decimal COP. RLS in `readExport` bounds every row to the caller's scope.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ locale: string }> },
): Promise<Response> {
  const { locale } = await context.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  await requireUser();

  const params = request.nextUrl.searchParams;
  const entityKeys = requestedEntities(params);
  const from = civilDate.parse(params.get("from") ?? undefined);
  const to = civilDate.parse(params.get("to") ?? undefined);

  const [data, t] = await Promise.all([
    readExport({ entityKeys, from, to }),
    getTranslations({ locale, namespace: "data" }),
  ]);

  const labels: SheetLabels = {
    sheetName: (entity) => t(`sheets.${entity}`),
    // The key is a descriptor column key, a fixed member of `data.columns`, but its
    // static type is a bare string, so the catalogue lookup is asserted.
    columnHeader: (key) => t(`columns.${key}` as Parameters<typeof t>[0]),
  };

  const workbook = buildWorkbook({ data, labels });
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${t("filenames.export")}-${todayInBogota()}.xlsx`;

  return new Response(buffer, {
    headers: {
      "Content-Type": SPREADSHEET_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
