"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";

import {
  createCategoryAction,
  updateCategoryAction,
} from "@/app/actions/categories";
import {
  Button,
  ColorSwatchPicker,
  Dialog,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Flex,
  Select,
  Spinner,
  Text,
  TextField,
} from "@/components/ui";
import { CATEGORY_COLORS, nextCategoryColor } from "@/lib/fund/category-color";
import {
  createCategorySchema,
  updateCategorySchema,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from "@/lib/validation/category";

// Radix's Select rejects an empty-string item value, so "no parent" needs its own sentinel.
const NO_PARENT_VALUE = "none";

// A superset of both schemas' shapes: the resolver strips whichever key the
// active schema does not declare, so only the fields that schema needs ever
// reach the matching action.
type CategoryFormValues = {
  fundId: string;
  categoryId: string;
  kind: "expense" | "income";
  name: string;
  parentId: string | null;
  color: string | null;
};

export function CategoryFormDialog({
  fundId,
  kind,
  parents,
  usedColors,
  open,
  onOpenChange,
  category,
  defaultParentId,
}: {
  fundId: string;
  kind: "expense" | "income";
  parents: { id: string; name: string }[];
  usedColors: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: {
    id: string;
    name: string;
    parentId: string | null;
    color: string | null;
  };
  defaultParentId?: string | null;
}) {
  const t = useTranslations("categories");
  const tCommon = useTranslations("common");
  // Root-scoped: the keys arriving from the schema and the action are full paths.
  const tKey = useTranslations();
  type MessageKey = Parameters<typeof tKey>[0];

  const isEdit = !!category;

  function buildDefaultValues(): CategoryFormValues {
    const parentId = category ? category.parentId : (defaultParentId ?? null);
    return {
      fundId,
      categoryId: category?.id ?? "",
      kind,
      name: category?.name ?? "",
      parentId,
      color:
        parentId === null
          ? (category?.color ?? nextCategoryColor(usedColors))
          : null,
    };
  }

  const form = useForm<CategoryFormValues>({
    resolver: (isEdit
      ? zodResolver(updateCategorySchema)
      : zodResolver(createCategorySchema)) as unknown as Resolver<CategoryFormValues>,
    defaultValues: buildDefaultValues(),
  });

  // Subscribes to the field itself; `form.watch` would return a function the
  // React Compiler refuses to memoize, skipping the whole component.
  const parentId = useWatch({ control: form.control, name: "parentId" });

  // Each open may hand the dialog a different row: reset during render, on the
  // open transition itself, rather than in an effect that would render stale
  // values for a frame first.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) form.reset(buildDefaultValues());
  }

  function onActionSuccess() {
    toast.success(t(isEdit ? "updated" : "created"));
    onOpenChange(false);
  }

  function onActionError({ error }: { error: { serverError?: string } }) {
    toast.error(tKey((error.serverError ?? "errors.unexpected") as MessageKey));
  }

  // Two hooks, not one behind a ternary: the actions' input types differ, and
  // rules of hooks forbid picking which one to call.
  const create = useAction(createCategoryAction, {
    onSuccess: onActionSuccess,
    onError: onActionError,
  });
  const update = useAction(updateCategoryAction, {
    onSuccess: onActionSuccess,
    onError: onActionError,
  });

  const isPending = isEdit ? update.isPending : create.isPending;

  function onSubmit(values: CategoryFormValues) {
    // The resolver already parsed `values` against the schema for this mode,
    // stripping the field the other mode's action does not accept.
    if (isEdit) {
      update.execute(values as UpdateCategoryInput);
    } else {
      create.execute(values as CreateCategoryInput);
    }
  }

  const parentOptions = parents.filter((parent) => parent.id !== category?.id);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Dialog.Title>{t(isEdit ? "editTitle" : "addTitle")}</Dialog.Title>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="category-name">
                    {t("nameLabel")}
                  </FieldLabel>
                  <TextField.Root
                    {...field}
                    id="category-name"
                    size="3"
                    autoFocus
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                    disabled={isPending}
                  />
                  {fieldState.invalid && (
                    <FieldError
                      errors={[
                        {
                          message: tKey(
                            fieldState.error!.message as MessageKey,
                          ),
                        },
                      ]}
                    />
                  )}
                </Field>
              )}
            />
            <Controller
              name="parentId"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="category-parent">
                    {t("parentLabel")}
                  </FieldLabel>
                  <Select.Root
                    value={field.value ?? NO_PARENT_VALUE}
                    onValueChange={(value) => {
                      const nextParentId =
                        value === NO_PARENT_VALUE ? null : value;
                      field.onChange(nextParentId);
                      // A subcategory carries no colour of its own; picking a
                      // parent clears it, clearing the parent brings back the default.
                      form.setValue(
                        "color",
                        nextParentId === null
                          ? nextCategoryColor(usedColors)
                          : null,
                      );
                    }}
                    disabled={isPending}
                  >
                    <Select.Trigger
                      id="category-parent"
                      aria-invalid={fieldState.invalid}
                    />
                    <Select.Content>
                      <Select.Item value={NO_PARENT_VALUE}>
                        {t("parentNone")}
                      </Select.Item>
                      {parentOptions.map((parent) => (
                        <Select.Item key={parent.id} value={parent.id}>
                          {parent.name}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                  {fieldState.invalid && (
                    <FieldError
                      errors={[
                        {
                          message: tKey(
                            fieldState.error!.message as MessageKey,
                          ),
                        },
                      ]}
                    />
                  )}
                </Field>
              )}
            />
            <Field>
              <FieldLabel htmlFor="category-kind">
                {t("kindLabel")}
              </FieldLabel>
              <Text id="category-kind" size="3">
                {t(kind === "expense" ? "kindExpense" : "kindIncome")}
              </Text>
              <FieldDescription>{t("kindLocked")}</FieldDescription>
            </Field>
            {parentId === null && (
              <Controller
                name="color"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field invalid={fieldState.invalid}>
                    <ColorSwatchPicker
                      id="category-color"
                      name="color"
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                      colors={CATEGORY_COLORS}
                      label={t("colorLabel")}
                      optionLabel={(index) =>
                        t("colorOption", { number: index + 1 })
                      }
                      disabled={isPending}
                    />
                    {fieldState.invalid && (
                      <FieldError
                        errors={[
                          {
                            message: tKey(
                              fieldState.error!.message as MessageKey,
                            ),
                          },
                        ]}
                      />
                    )}
                  </Field>
                )}
              />
            )}
            <Field>
              <Flex gap="3" justify="end">
                <Dialog.Close>
                  <Button
                    type="button"
                    variant="soft"
                    color="gray"
                    disabled={isPending}
                  >
                    {tCommon("cancel")}
                  </Button>
                </Dialog.Close>
                <Button type="submit" disabled={isPending}>
                  {isPending && <Spinner />}
                  {tCommon("save")}
                </Button>
              </Flex>
            </Field>
          </FieldGroup>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
