"use server";

import { z } from "zod";

import { ActionError } from "@/lib/errors";
import { authActionClient } from "@/lib/safe-action";
import { runImportPipeline } from "@/lib/spreadsheet/import-pipeline";
import type { SheetEntity } from "@/lib/spreadsheet/schema";

// The upload guards raise these; the shared pipeline owns the rest (RF-48).
const FILE_REQUIRED = "data.import.errors.fileRequired";
const FILE_TYPE = "data.import.errors.fileType";

type PreviewRow = {
  index: number;
  status: "new" | "update";
  errors: string[];
};

type PreviewEntity = {
  entity: SheetEntity;
  rows: PreviewRow[];
};

export type ImportPreview = {
  perEntity: PreviewEntity[];
  totals: { new: number; update: number; error: number };
};

/**
 * The import preview (RF-51/52): parse the upload, validate every row before a single
 * write, resolve references against existing scope unioned with the file's own new
 * accounts and categories, and classify each row new-vs-update by its stable key.
 * Writes NOTHING — the caller confirms first, a later commit action applies the same
 * `runImportPipeline` result. The resolved objects stay server-side; the payload
 * carries only each row's position, classification and error keys.
 */
export const previewImportAction = authActionClient
  .inputSchema(z.instanceof(FormData))
  .action(async ({ parsedInput: formData }): Promise<ImportPreview> => {
    const file = formData.get("file");
    if (!(file instanceof File)) throw new ActionError(FILE_REQUIRED);
    if (!file.name.toLowerCase().endsWith(".xlsx")) throw new ActionError(FILE_TYPE);

    const result = await runImportPipeline({ buffer: await file.arrayBuffer() });

    return {
      perEntity: result.perEntity.map((entity) => ({
        entity: entity.entity,
        rows: entity.rows.map((row) => ({
          index: row.index,
          status: row.status,
          errors: row.errors,
        })),
      })),
      totals: result.totals,
    };
  });
