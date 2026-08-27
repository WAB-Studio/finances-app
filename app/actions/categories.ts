"use server";

import { refresh } from "next/cache";

import { createCategory, deleteCategory, updateCategory } from "@/db/queries/categories";
import { pgErrorCode } from "@/lib/db-error";
import { ActionError } from "@/lib/errors";
import { authActionClient } from "@/lib/safe-action";
import {
  createCategorySchema,
  deleteCategorySchema,
  updateCategorySchema,
} from "@/lib/validation/category";

// The trigger raises one code, 23514, for four refusals: self-parenting, a
// grandchild, a parent that already has children, and a kind mismatch. The
// request's parent is the only signal available without reading the
// database's text — a named parent could disagree in kind, so it reads as
// that; no parent named at all means the refusal was about nesting instead.
function categoryConstraintErrorKey(parentId: string | null): string {
  return parentId ? "errors.categoryKindMismatch" : "errors.categoryNesting";
}

/**
 * Creates a category (RF-26, RF-27). Depth, kind agreement and same-fund
 * parentage are the trigger's and the composite foreign key's to enforce;
 * this action only turns their shared refusal code into a sentence.
 */
export const createCategoryAction = authActionClient
  .inputSchema(createCategorySchema)
  .action(async ({ parsedInput }) => {
    try {
      await createCategory(parsedInput);
    } catch (error) {
      if (pgErrorCode(error) === "23514") {
        throw new ActionError(categoryConstraintErrorKey(parsedInput.parentId));
      }
      throw error;
    }

    refresh();
  });

/**
 * Renames, recolours or reparents a category. `kind` is immutable and never
 * travels in the payload, so the mapping below reads the same as create's.
 */
export const updateCategoryAction = authActionClient
  .inputSchema(updateCategorySchema)
  .action(async ({ parsedInput }) => {
    let updated: boolean;
    try {
      updated = await updateCategory(parsedInput);
    } catch (error) {
      if (pgErrorCode(error) === "23514") {
        throw new ActionError(categoryConstraintErrorKey(parsedInput.parentId));
      }
      throw error;
    }

    if (!updated) throw new ActionError("errors.notFound");

    refresh();
  });

/**
 * Deletes a category. 23503 is the composite foreign key a transaction will
 * hold once transactions exist; nothing references categories yet.
 */
export const deleteCategoryAction = authActionClient
  .inputSchema(deleteCategorySchema)
  .action(async ({ parsedInput }) => {
    let deleted: boolean;
    try {
      deleted = await deleteCategory(parsedInput);
    } catch (error) {
      if (pgErrorCode(error) === "23503") throw new ActionError("errors.categoryInUse");
      throw error;
    }

    if (!deleted) throw new ActionError("errors.notFound");

    refresh();
  });
