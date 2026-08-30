"use server";

import { refresh } from "next/cache";

import { getUserGroup } from "@/db/queries/groups";
import { createLabel, deleteLabel } from "@/db/queries/labels";
import type { LabelScope } from "@/db/queries/labels";
import { ActionError } from "@/lib/errors";
import { authActionClient } from "@/lib/safe-action";
import { createLabelSchema, deleteLabelSchema } from "@/lib/validation/label";

/**
 * Creates a label (RF-70). The scope is the caller's group when they belong to
 * one, otherwise their personal set; it is resolved from the session, never
 * trusted from the form.
 */
export const createLabelAction = authActionClient
  .inputSchema(createLabelSchema)
  .action(async ({ parsedInput, ctx }) => {
    const group = await getUserGroup();
    const scope: LabelScope = group
      ? { groupId: group.id }
      : { ownerUserId: ctx.user.id };

    const { labelId } = await createLabel({ ...parsedInput, scope });
    refresh();
    return { labelId };
  });

// The join's cascade detaches the label from its movements; a false row count is
// a denied or absent label (RF-70).
export const deleteLabelAction = authActionClient
  .inputSchema(deleteLabelSchema)
  .action(async ({ parsedInput: { labelId } }) => {
    const deleted = await deleteLabel({ labelId });
    if (!deleted) throw new ActionError("errors.notFound");

    refresh();
  });
