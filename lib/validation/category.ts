import { z } from "zod";

import { CATEGORY_COLORS } from "@/lib/fund/category-color";

// The list the screens and both sides of validation read for a category's kind (RF-27).
export const CATEGORY_KINDS = ["expense", "income"] as const;

const categoryNameSchema = z
  .string()
  .trim()
  .min(1, { error: "categories.errors.nameRequired" })
  .max(80, { error: "categories.errors.nameTooLong" });

const categoryParentIdSchema = z
  .uuid({ error: "categories.errors.parentInvalid" })
  .nullable();

const categoryColorSchema = z
  .enum(CATEGORY_COLORS, { error: "categories.errors.colorRequired" })
  .nullable();

// A subcategory inherits its parent's colour and sends none of its own; a
// top-level category has no parent to inherit from, so it must pick one (RF-26).
function requireColorAtTopLevel(
  data: { parentId: string | null; color: string | null },
  ctx: z.RefinementCtx,
) {
  if (data.parentId === null && data.color === null) {
    ctx.addIssue({
      code: "custom",
      message: "categories.errors.colorRequired",
      path: ["color"],
    });
  }
}

export const createCategorySchema = z
  .object({
    fundId: z.uuid(),
    name: categoryNameSchema,
    kind: z.enum(CATEGORY_KINDS, { error: "categories.errors.kindInvalid" }),
    parentId: categoryParentIdSchema,
    color: categoryColorSchema,
  })
  .superRefine(requireColorAtTopLevel);

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

// `kind` is immutable after creation, so it never appears in the update schema.
export const updateCategorySchema = z
  .object({
    fundId: z.uuid(),
    categoryId: z.uuid(),
    name: categoryNameSchema,
    parentId: categoryParentIdSchema,
    color: categoryColorSchema,
  })
  .superRefine(requireColorAtTopLevel);

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const deleteCategorySchema = z.object({
  fundId: z.uuid(),
  categoryId: z.uuid(),
});

export type DeleteCategoryInput = z.infer<typeof deleteCategorySchema>;
