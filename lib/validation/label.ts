import { z } from "zod";

import { CATEGORY_COLORS } from "@/lib/fund/category-color";

const labelNameSchema = z
  .string()
  .trim()
  .min(1, { error: "labels.errors.nameRequired" })
  .max(80, { error: "labels.errors.nameTooLong" });

// A label shares the category palette (RF-70). It has no parent to inherit
// from, so it always carries its own colour.
const labelColorSchema = z
  .enum(CATEGORY_COLORS, { error: "labels.errors.colorRequired" })
  .nullable();

function requireColor(
  data: { color: string | null },
  ctx: z.RefinementCtx,
) {
  if (data.color === null) {
    ctx.addIssue({
      code: "custom",
      message: "labels.errors.colorRequired",
      path: ["color"],
    });
  }
}

// The scope (personal or group) is resolved from the session (RF-70), so it
// never travels in the payload.
export const createLabelSchema = z
  .object({
    name: labelNameSchema,
    color: labelColorSchema,
  })
  .superRefine(requireColor);

export type CreateLabelInput = z.infer<typeof createLabelSchema>;

export const updateLabelSchema = z
  .object({
    labelId: z.uuid(),
    name: labelNameSchema,
    color: labelColorSchema,
  })
  .superRefine(requireColor);

export type UpdateLabelInput = z.infer<typeof updateLabelSchema>;

export const deleteLabelSchema = z.object({
  labelId: z.uuid(),
});

export type DeleteLabelInput = z.infer<typeof deleteLabelSchema>;
