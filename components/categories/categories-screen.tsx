"use client";

import { EllipsisVertical, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { deleteCategoryAction } from "@/app/actions/categories";
import { CategoryFormDialog } from "@/components/categories/category-form-dialog";
import {
  Box,
  Button,
  Card,
  ColorSwatch,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  Flex,
  Heading,
  IconButton,
  SegmentedControl,
  Text,
} from "@/components/ui";
import type { CategoryNode } from "@/db/queries/categories";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useActionErrorToast } from "@/lib/use-action-toast";

type CategoryKind = "expense" | "income";

// What the form dialog opens for: a blank top-level category, a subcategory
// preselected under `defaultParentId`, or an existing category to edit.
// `hasChildren` is absent whenever `category` is, since a target with no
// category never gates the parent picker.
type FormTarget = {
  category?: { id: string; name: string; parentId: string | null; color: string | null };
  defaultParentId?: string | null;
  hasChildren?: boolean;
};

// A top-level category names its children before the cascade removes them;
// a subcategory never carries any of its own.
type DeleteTarget = { id: string; childCount: number };

export function CategoriesScreen({
  kind,
  categories,
  parents,
  usedColors,
}: {
  kind: CategoryKind;
  categories: CategoryNode[];
  parents: { id: string; name: string }[];
  usedColors: string[];
}) {
  const t = useTranslations("categories");
  // Root-scoped: `common`'s labels are full catalogue paths.
  const tKey = useTranslations();

  const pathname = usePathname();
  const router = useRouter();

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const onActionError = useActionErrorToast();

  const deleteAction = useAction(deleteCategoryAction, {
    onSuccess() {
      toast.success(t("deleted"));
      setDeleteTarget(null);
    },
    onError: onActionError,
  });

  // RF-63 caps nesting at one level: a would-be parent that already has
  // children is marked here, so the dialog can keep it off the picker
  // without a second pass over `categories`.
  const parentOptions = parents.map((parent) => ({
    id: parent.id,
    name: parent.name,
    hasChildren:
      (categories.find((category) => category.id === parent.id)?.children
        .length ?? 0) > 0,
  }));

  // Rewrites the query string so the active tab survives a reload and can be linked to.
  function onKindChange(nextKind: string) {
    router.push({ pathname, query: { kind: nextKind } }, { scroll: false });
  }

  const addButton = (
    <Button type="button" onClick={() => setFormTarget({})}>
      <Plus size={16} />
      {t("add")}
    </Button>
  );

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center" gap="3" wrap="wrap">
        <Heading size="5">{t("title")}</Heading>
        {addButton}
      </Flex>
      <SegmentedControl.Root value={kind} onValueChange={onKindChange}>
        <SegmentedControl.Item value="expense">
          {t("expenseTab")}
        </SegmentedControl.Item>
        <SegmentedControl.Item value="income">
          {t("incomeTab")}
        </SegmentedControl.Item>
      </SegmentedControl.Root>
      {categories.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={addButton}
        />
      ) : (
        <Flex direction="column" gap="3">
          {categories.map((category) => (
            <Card key={category.id}>
              <Flex direction="column" gap="3">
                <Flex justify="between" align="center" gap="3">
                  <Flex align="center" gap="2" minWidth="0">
                    {/* `color` is a nullable column; only the write-path schema
                        keeps a top-level category's colour set, so a row that
                        arrived any other way loses the swatch, not the row. */}
                    {category.color && (
                      <ColorSwatch color={category.color} label={category.name} />
                    )}
                    <Flex direction="column" minWidth="0">
                      <Text weight="medium" truncate>
                        {category.name}
                      </Text>
                      <Text size="2" color="gray">
                        {t("subcategoryCount", {
                          count: category.children.length,
                        })}
                      </Text>
                    </Flex>
                  </Flex>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      <IconButton
                        type="button"
                        variant="ghost"
                        color="gray"
                        size="3"
                        aria-label={tKey("common.actionsFor", {
                          name: category.name,
                        })}
                      >
                        <EllipsisVertical size={16} />
                      </IconButton>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content>
                      <DropdownMenu.Item
                        onSelect={() =>
                          setFormTarget({
                            category: {
                              id: category.id,
                              name: category.name,
                              parentId: null,
                              color: category.color,
                            },
                            hasChildren: category.children.length > 0,
                          })
                        }
                      >
                        {tKey("common.edit")}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onSelect={() =>
                          setFormTarget({ defaultParentId: category.id })
                        }
                      >
                        {t("addSub")}
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item
                        color="red"
                        onSelect={() =>
                          setDeleteTarget({
                            id: category.id,
                            childCount: category.children.length,
                          })
                        }
                      >
                        {tKey("common.delete")}
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </Flex>
                {category.children.length > 0 && (
                  <Box pl="6">
                    <Flex direction="column" gap="2">
                      {category.children.map((child) => (
                        <Flex
                          key={child.id}
                          justify="between"
                          align="center"
                          gap="3"
                        >
                          <Text truncate>{child.name}</Text>
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger>
                              <IconButton
                                type="button"
                                variant="ghost"
                                color="gray"
                                size="3"
                                aria-label={tKey("common.actionsFor", {
                                  name: child.name,
                                })}
                              >
                                <EllipsisVertical size={16} />
                              </IconButton>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Content>
                              <DropdownMenu.Item
                                onSelect={() =>
                                  setFormTarget({
                                    category: {
                                      id: child.id,
                                      name: child.name,
                                      parentId: category.id,
                                      color: child.color,
                                    },
                                  })
                                }
                              >
                                {tKey("common.edit")}
                              </DropdownMenu.Item>
                              <DropdownMenu.Separator />
                              <DropdownMenu.Item
                                color="red"
                                onSelect={() =>
                                  setDeleteTarget({ id: child.id, childCount: 0 })
                                }
                              >
                                {tKey("common.delete")}
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Root>
                        </Flex>
                      ))}
                    </Flex>
                  </Box>
                )}
              </Flex>
            </Card>
          ))}
        </Flex>
      )}
      {/* Below Dialog.Content the form keys itself on the subject; closing unmounts it. */}
      <CategoryFormDialog
        kind={kind}
        parents={parentOptions}
        usedColors={usedColors}
        open={formTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFormTarget(null);
        }}
        category={formTarget?.category}
        defaultParentId={formTarget?.defaultParentId}
        hasChildren={formTarget?.hasChildren ?? false}
      />
      {deleteTarget && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title={t("deleteTitle")}
          description={
            deleteTarget.childCount > 0
              ? t("deleteWithChildrenDescription", {
                  count: deleteTarget.childCount,
                })
              : t("deleteDescription")
          }
          confirmLabel={tKey("common.delete")}
          cancelLabel={tKey("common.cancel")}
          pending={deleteAction.isPending}
          onConfirm={() =>
            deleteAction.execute({ categoryId: deleteTarget.id })
          }
        />
      )}
    </Flex>
  );
}
