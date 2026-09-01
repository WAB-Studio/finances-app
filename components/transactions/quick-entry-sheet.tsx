"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { SquarePenIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import {
  createTransactionAction,
  deleteTransactionAction,
} from "@/app/actions/transactions";
import { SplitEditor } from "@/components/transactions/split-editor";
import {
  Button,
  ChipMultiSelect,
  Dialog,
  Field,
  FieldControl,
  FieldGroup,
  FieldLabel,
  FieldMessage,
  Flex,
  IconButton,
  Link,
  Select,
  Spinner,
  Text,
  TextField,
} from "@/components/ui";
import type { TransactionFormOptions } from "@/db/queries/transaction-form";
import { todayInBogota } from "@/lib/dates";
import { interpretQuickEntry } from "@/lib/transactions/interpret";
import { useActionErrorToast } from "@/lib/use-action-toast";
import {
  createTransactionSchema,
  type CreateTransactionInput,
} from "@/lib/validation/transaction";

/**
 * The make-or-break quick sheet: one text field the interpreter reads into an
 * editable expense (RF-22). It is fixed to an expense — a source account, no
 * destination — so the type is never chosen (RF-18); income and transfer live
 * in the full form the "Income or transfer?" link opens.
 */
export function QuickEntrySheet({
  open,
  onOpenChange,
  options,
  onOpenFull,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: TransactionFormOptions;
  onOpenFull: () => void;
}) {
  const t = useTranslations("transactions");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Flex align="center" justify="between" mb="4">
          <Dialog.Title mb="0">{t("quickTitle")}</Dialog.Title>
          <Dialog.Close>
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              aria-label={t("quickTitle")}
            >
              <XIcon size={18} />
            </IconButton>
          </Dialog.Close>
        </Flex>
        {/* Closing unmounts the content, so the form is born fresh each open. */}
        <QuickEntryForm
          options={options}
          onOpenChange={onOpenChange}
          onOpenFull={onOpenFull}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function QuickEntryForm({
  options,
  onOpenChange,
  onOpenFull,
}: {
  options: TransactionFormOptions;
  onOpenChange: (open: boolean) => void;
  onOpenFull: () => void;
}) {
  const t = useTranslations("transactions");
  const onActionError = useActionErrorToast();

  const [text, setText] = useState("");

  const form = useForm<CreateTransactionInput>({
    resolver: zodResolver(createTransactionSchema),
    mode: "onChange",
    defaultValues: {
      // Fixed to an expense: a source only, the destination always null (RF-18).
      fromAccountId: options.lastUsedAccountId,
      toAccountId: null,
      amount: "",
      occurredAt: todayInBogota(),
      description: null,
      splits: [],
      labelIds: [],
    },
  });

  const fromAccountId = useWatch({ control: form.control, name: "fromAccountId" });
  const amount = useWatch({ control: form.control, name: "amount" });
  const splits = useWatch({ control: form.control, name: "splits" });

  // The account's scope decides which categories are on offer (RF-62): a
  // personal account names its owner, a group account its group.
  const scope = useMemo(() => {
    const account = options.accounts.find((one) => one.id === fromAccountId);
    return account?.groupId ? "group" : "personal";
  }, [options.accounts, fromAccountId]);

  // The expense set of that scope, parents and children flattened, is what the
  // interpreter matches a category token against.
  const expenseCategories = useMemo(
    () =>
      options.categories
        .filter((category) => category.scope === scope && category.kind === "expense")
        .flatMap((category) => [
          { id: category.id, name: category.name, kind: category.kind },
          ...category.children.map((child) => ({
            id: child.id,
            name: child.name,
            kind: "expense",
          })),
        ]),
    [options.categories, scope],
  );

  // The same scope's labels, offered only when it has any: the sheet stays as
  // short as it is today for a caller with none (RF-70).
  const scopedLabels = useMemo(
    () => options.labels.filter((label) => label.scope === scope),
    [options.labels, scope],
  );

  // Everything the interpreter proposes stays a suggestion the fields may
  // overwrite (RF-22): the account fills only while still empty so a manual
  // pick survives further typing.
  function handleText(next: string) {
    setText(next);

    const proposal = interpretQuickEntry(next, {
      categories: expenseCategories,
      accounts: options.accounts.map((one) => ({ id: one.id, name: one.name })),
      defaultAccountId: options.lastUsedAccountId,
    });

    if (proposal.amountPesos !== null) {
      form.setValue("amount", proposal.amountPesos, { shouldValidate: true });
    }
    if (proposal.accountId && !form.getValues("fromAccountId")) {
      form.setValue("fromAccountId", proposal.accountId, { shouldValidate: true });
    }
    form.setValue("description", proposal.description || null);
    if (proposal.categoryId) {
      // One category is one split summing to the amount (RF-69); more than one
      // is the split editor's to manage.
      form.setValue(
        "splits",
        [{ categoryId: proposal.categoryId, amount: proposal.amountPesos ?? "" }],
        { shouldValidate: true },
      );
    }
  }

  const lastScope = useRef(scope);

  // A lone split always carries the whole amount, so editing the total keeps it
  // in step; two or more are the editor's to balance.
  useEffect(() => {
    if (splits.length === 1 && splits[0].amount !== amount) {
      form.setValue("splits", [{ ...splits[0], amount }], { shouldValidate: true });
    }

    // A label shares its movement's scope, so an account of the other scope
    // drops what the previous scope's picker filled.
    if (lastScope.current !== scope) {
      lastScope.current = scope;
      form.setValue("labelIds", [], { shouldValidate: true });
    }
  }, [amount, splits, scope, form]);

  const create = useAction(createTransactionAction, {
    onSuccess: ({ data }) => {
      const transactionId = data?.transactionId;
      // The undo toast stands in for a confirm dialog (RF-22): it removes the
      // movement just written.
      toast.success(t("saved"), {
        action: transactionId
          ? {
              label: t("undo"),
              onClick: () => remove.execute({ transactionId }),
            }
          : undefined,
      });
      onOpenChange(false);
    },
    onError: onActionError,
  });

  const remove = useAction(deleteTransactionAction, { onError: onActionError });

  // No token read into a figure or a category yet: prompt for both.
  const recognised = amount.trim().length > 0 || splits.some((split) => split.categoryId);
  const hint = text.trim().length === 0
    ? null
    : recognised
      ? t("quickInterpreted")
      : t("quickUnrecognized");

  function onSubmit(values: CreateTransactionInput) {
    create.execute(values);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="quick-text">{t("quickTitle")}</FieldLabel>
          <TextField.Root
            id="quick-text"
            value={text}
            onChange={(event) => handleText(event.target.value)}
            placeholder={t("quickPlaceholder")}
            size="3"
            autoFocus
            autoComplete="off"
          >
            <TextField.Slot>
              <SquarePenIcon size={16} />
            </TextField.Slot>
          </TextField.Root>
          {hint && (
            <Text size="2" color={recognised ? "gray" : "amber"}>
              {hint}
            </Text>
          )}
        </Field>

        <Controller
          name="amount"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="quick-amount">{t("amountLabel")}</FieldLabel>
              <FieldControl>
                <TextField.Root
                  {...field}
                  id="quick-amount"
                  size="3"
                  inputMode="numeric"
                  disabled={create.isPending}
                />
              </FieldControl>
              <FieldMessage error={fieldState.error} />
            </Field>
          )}
        />

        <Controller
          name="splits"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel>{t("categoryLabel")}</FieldLabel>
              <SplitEditor
                totalPesos={amount}
                scope={scope}
                kind="expense"
                categories={options.categories}
                value={field.value}
                onChange={field.onChange}
              />
              <FieldMessage error={fieldState.error} />
            </Field>
          )}
        />

        {scopedLabels.length > 0 && (
          <Controller
            name="labelIds"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field invalid={fieldState.invalid}>
                <FieldControl>
                  <ChipMultiSelect
                    id="quick-labels"
                    name="labelIds"
                    value={field.value}
                    onValueChange={field.onChange}
                    options={scopedLabels}
                    label={t("labelsLabel")}
                    disabled={create.isPending}
                  />
                </FieldControl>
                <FieldMessage error={fieldState.error} />
              </Field>
            )}
          />
        )}

        <Controller
          name="fromAccountId"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="quick-account">{t("accountLabel")}</FieldLabel>
              <Select.Root
                size="3"
                value={field.value ?? undefined}
                onValueChange={field.onChange}
                disabled={create.isPending}
              >
                <FieldControl>
                  <Select.Trigger
                    id="quick-account"
                    placeholder={t("accountLabel")}
                  />
                </FieldControl>
                <Select.Content position="popper">
                  {options.accounts.map((account) => (
                    <Select.Item key={account.id} value={account.id}>
                      {account.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <FieldMessage error={fieldState.error} />
            </Field>
          )}
        />

        <Controller
          name="occurredAt"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="quick-date">{t("dateLabel")}</FieldLabel>
              <FieldControl>
                <TextField.Root
                  {...field}
                  id="quick-date"
                  size="3"
                  type="date"
                  disabled={create.isPending}
                />
              </FieldControl>
              <FieldMessage error={fieldState.error} />
            </Field>
          )}
        />

        <Flex justify="center">
          <Link href="#" onClick={(event) => { event.preventDefault(); onOpenFull(); }}>
            {t("quickTypeLink")}
          </Link>
        </Flex>

        {/* Never dead: while the form is short of something, submitting is what
            makes it say so. */}
        <Button type="submit" size="3" disabled={create.isPending}>
          {create.isPending && <Spinner />}
          {t("quickSave")}
        </Button>
      </FieldGroup>
    </form>
  );
}
