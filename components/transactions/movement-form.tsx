"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronLeftIcon, InfoIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useRef } from "react";
import {
  Controller,
  useForm,
  useWatch,
  type Resolver,
} from "react-hook-form";

import {
  createTransactionAction,
  updateTransactionAction,
} from "@/app/actions/transactions";
import { acceptDeliveryAction } from "@/app/actions/ingest";
import { SplitEditor } from "@/components/transactions/split-editor";
import {
  Badge,
  Box,
  Button,
  Callout,
  ChipMultiSelect,
  Field,
  FieldControl,
  FieldGroup,
  FieldLabel,
  FieldMessage,
  Flex,
  FundChip,
  Grid,
  Heading,
  IconButton,
  Select,
  Spinner,
  Text,
  TextField,
  type Responsive,
} from "@/components/ui";
import type { TransactionFormOptions } from "@/db/queries/transaction-form";
import type { TransactionListRow } from "@/db/queries/transactions";
import { todayInBogota } from "@/lib/dates";
import { centsToPesos, parsePesos } from "@/lib/money";
import { useActionErrorToast } from "@/lib/use-action-toast";
import {
  acceptDeliverySchema,
  type AcceptDeliveryInput,
} from "@/lib/validation/ingest";
import {
  createTransactionSchema,
  updateTransactionSchema,
  type CreateTransactionInput,
  type UpdateTransactionInput,
} from "@/lib/validation/transaction";

// A superset of both schemas' shapes: the resolver strips whichever key the
// active schema does not declare, so `external_ref` never reaches the edit
// action and `transaction_id` never reaches the create one.
type MovementFormValues = {
  deliveryId?: string;
  transactionId?: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  amount: string;
  occurredAt: string;
  description: string | null;
  externalRef?: string;
  splits: { categoryId: string; amount: string }[];
  labelIds: string[];
};

// The kind the DB generates from the accounts (RF-18): a lone destination is an
// income, a lone source an expense, both a transfer, neither nothing yet.
type DerivedKind = "income" | "expense" | "transfer" | null;

function deriveKind(
  fromAccountId: string | null,
  toAccountId: string | null,
): DerivedKind {
  if (fromAccountId && toAccountId) return "transfer";
  if (toAccountId) return "income";
  if (fromAccountId) return "expense";
  return null;
}

/**
 * The dialog this form is laid out for: the 884px of the FormMovimiento artboard
 * from `md` up, and below it the width Radix gives every dialog. Every caller
 * reads it from here, so the form is never opened narrower than its two columns.
 */
export const movementFormDialogWidth: Responsive<string> = {
  initial: "600px",
  md: "884px",
};

// The artboard's body: the accounts, the figure, the date and the note on the
// fixed track, the splits and the labels on what is left.
const BODY_COLUMNS = "400px 1fr";

// A sentinel the account selects use for "no account", since a Radix item may
// not carry an empty value; it maps back to null the moment it is picked.
const NO_ACCOUNT = "none";

/**
 * The full movement form: income, expense and transfer through one screen where
 * the type is never chosen but derived from the two account slots and shown
 * read-only (RF-18). An income or expense reuses the shared `SplitEditor` with a
 * category set of its own scope and kind (RF-62, RF-69); a transfer hides both.
 * It writes through the same actions and the same Zod schema the server runs,
 * and reopens on any movement to edit it (RF-24). Money is integer cents.
 */
export function MovementForm({
  mode,
  options,
  movement,
  deliveryId,
  defaults,
  onDone,
}: {
  mode: "create" | "edit";
  options: TransactionFormOptions;
  movement?: TransactionListRow;
  deliveryId?: string;
  defaults?: {
    fromAccountId?: string | null;
    toAccountId?: string | null;
    amount?: string;
    occurredAt?: string;
    description?: string | null;
    splits?: { categoryId: string; amount: string }[];
  };
  onDone: () => void;
}) {
  const t = useTranslations("transactions");
  const tIngest = useTranslations("ingest");
  const tKey = useTranslations();
  const format = useFormatter();
  const onActionError = useActionErrorToast();

  const isEdit = mode === "edit";
  const isAccept = !movement && deliveryId !== undefined;

  const form = useForm<MovementFormValues>({
    resolver: (isEdit
      ? zodResolver(updateTransactionSchema)
      : isAccept
        ? zodResolver(acceptDeliverySchema)
        : zodResolver(createTransactionSchema)) as unknown as Resolver<MovementFormValues>,
    mode: "onChange",
    defaultValues: movement
      ? {
          transactionId: movement.id,
          fromAccountId: movement.fromAccountId,
          toAccountId: movement.toAccountId,
          amount: String(centsToPesos(movement.amountCents)),
          occurredAt: movement.occurredAt,
          description: movement.description,
          splits: movement.splits.map((split) => ({
            categoryId: split.categoryId,
            amount: String(centsToPesos(split.amountCents)),
          })),
          labelIds: movement.labels.map((label) => label.id),
        }
      : {
          deliveryId: isAccept ? deliveryId : undefined,
          // Reached from the quick sheet's income-or-transfer link, so the empty
          // form opens as an income: a destination and no source (RF-18).
          fromAccountId:
            defaults?.fromAccountId !== undefined
              ? defaults.fromAccountId
              : null,
          toAccountId:
            defaults?.toAccountId !== undefined
              ? defaults.toAccountId
              : options.lastUsedAccountId,
          amount: defaults?.amount ?? "",
          occurredAt: defaults?.occurredAt ?? todayInBogota(),
          description:
            defaults?.description !== undefined ? defaults.description : null,
          splits: defaults?.splits ?? [],
          labelIds: [],
        },
  });

  const fromAccountId = useWatch({ control: form.control, name: "fromAccountId" });
  const toAccountId = useWatch({ control: form.control, name: "toAccountId" });
  const amount = useWatch({ control: form.control, name: "amount" });
  const splits = useWatch({ control: form.control, name: "splits" });

  const kind = deriveKind(fromAccountId, toAccountId);

  // Both accounts share one writable scope (RF-62): whichever slot is set names
  // it, and that scope decides which categories the split editor offers.
  const scopeAccountId = fromAccountId ?? toAccountId;
  const scope = useMemo(() => {
    const account = options.accounts.find((one) => one.id === scopeAccountId);
    return account?.groupId ? "group" : "personal";
  }, [options.accounts, scopeAccountId]);

  const isGroupScoped = kind !== null && scope === "group";

  // A movement's labels share its scope, so only that scope's set is on offer
  // (RF-70); the other scope's would be refused by the check on write.
  const scopedLabels = useMemo(
    () => options.labels.filter((label) => label.scope === scope),
    [options.labels, scope],
  );

  // Keep the splits in step with the derived kind: a transfer drops them, and a
  // switch between income and expense clears the categories the old kind carried
  // (RF-69). A lone split always holds the whole amount, like the quick sheet.
  const lastKind = useRef<DerivedKind>(kind);
  useEffect(() => {
    if (kind === "transfer") {
      if (splits.length > 0) form.setValue("splits", [], { shouldValidate: true });
      lastKind.current = kind;
      return;
    }

    if (kind === null) {
      if (splits.length > 0) form.setValue("splits", [], { shouldValidate: true });
      lastKind.current = kind;
      return;
    }

    // A row with no category yet is what the person came to fill, not a
    // mistake to report: seeding it never validates, so the form opens quiet.
    if (lastKind.current !== kind && lastKind.current !== null) {
      form.setValue("splits", [{ categoryId: "", amount }]);
    } else if (splits.length === 0) {
      form.setValue("splits", [{ categoryId: "", amount }]);
    } else if (splits.length === 1 && splits[0].amount !== amount) {
      form.setValue("splits", [{ ...splits[0], amount }], { shouldValidate: true });
    }

    lastKind.current = kind;
  }, [kind, splits, amount, form]);

  // Switching to an account of the other scope drops the selection, so a
  // personal label never rides into a group movement.
  const lastScope = useRef(scope);
  useEffect(() => {
    if (lastScope.current === scope) return;
    lastScope.current = scope;
    form.setValue("labelIds", [], { shouldValidate: true });
  }, [scope, form]);

  function onActionSuccess() {
    onDone();
  }

  // Three hooks, not one behind a ternary: the actions' input types differ, and
  // rules of hooks forbid picking which one to call.
  const create = useAction(createTransactionAction, {
    onSuccess: onActionSuccess,
    onError: onActionError,
  });
  const update = useAction(updateTransactionAction, {
    onSuccess: onActionSuccess,
    onError: onActionError,
  });
  const accept = useAction(acceptDeliveryAction, {
    onSuccess: onActionSuccess,
    onError: onActionError,
  });

  const isPending = isEdit
    ? update.isPending
    : isAccept
      ? accept.isPending
      : create.isPending;

  function onSubmit(values: MovementFormValues) {
    // The resolver already parsed `values` for this mode, dropping the field the
    // other mode's action refuses: `external_ref` on edit, `transaction_id` on
    // create.
    if (isEdit) {
      update.execute(values as UpdateTransactionInput);
    } else if (isAccept) {
      accept.execute({ ...values, deliveryId } as AcceptDeliveryInput);
    } else {
      create.execute(values as CreateTransactionInput);
    }
  }

  const kindLabel =
    kind === "income"
      ? t("kindIncome")
      : kind === "expense"
        ? t("kindExpense")
        : kind === "transfer"
          ? t("kindTransfer")
          : null;
  const kindColor =
    kind === "income" ? "grass" : kind === "expense" ? "red" : "gray";
  const sign = kind === "income" ? "+" : kind === "expense" ? "−" : "";
  const amountPesos = parsePesos(amount);

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <Flex align="center" gap="3" mb="4">
        <IconButton
          type="button"
          tap
          variant="ghost"
          color="gray"
          onClick={onDone}
          aria-label={tKey("common.cancel")}
        >
          <ChevronLeftIcon size={18} />
        </IconButton>
        <Heading size="5" style={{ flex: 1 }}>
          {t("formTitle")}
        </Heading>
        {isGroupScoped && <FundChip label={tKey("fund.label")} />}
      </Flex>

      {/* The amount reads in the derived kind's sign and colour; the pill names
          the kind read-only, never a control (RF-18). */}
      <Flex direction="column" align="center" gap="2" mb="5">
        <Heading
          size="8"
          color={kindColor}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {`${sign}${format.number(amountPesos ?? 0, "currency")}`}
        </Heading>
        {kindLabel && (
          <Flex align="center" gap="2">
            <Badge color={kindColor} variant="soft" radius="full">
              {kindLabel}
            </Badge>
            <Text size="1" color="gray">
              {t("kindDerivedFrom")}
            </Text>
          </Flex>
        )}
      </Flex>

      {/* The artboard's body from `md` up: the accounts and the figure on the
          fixed track, the splits and the labels on what is left, the date and
          the note under the accounts. Below `md` it is one column, and every
          field keeps the row it already had. */}
      <Grid
        columns={{ initial: "1", md: BODY_COLUMNS }}
        gap="5"
        align="start"
        width="100%"
      >
        <FieldGroup>
          <Controller
            name="fromAccountId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field invalid={fieldState.invalid}>
                <FieldLabel htmlFor="movement-from">{t("fromLabel")}</FieldLabel>
                <Select.Root
                  size="3"
                  value={field.value ?? NO_ACCOUNT}
                  onValueChange={(value) =>
                    field.onChange(value === NO_ACCOUNT ? null : value)
                  }
                  disabled={isPending}
                >
                  <FieldControl>
                    <Select.Trigger id="movement-from" />
                  </FieldControl>
                  <Select.Content position="popper">
                    <Select.Item value={NO_ACCOUNT}>{t("accountNone")}</Select.Item>
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
            name="toAccountId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field invalid={fieldState.invalid}>
                <FieldLabel htmlFor="movement-to">{t("toLabel")}</FieldLabel>
                <Select.Root
                  size="3"
                  value={field.value ?? NO_ACCOUNT}
                  onValueChange={(value) =>
                    field.onChange(value === NO_ACCOUNT ? null : value)
                  }
                  disabled={isPending}
                >
                  <FieldControl>
                    <Select.Trigger id="movement-to" />
                  </FieldControl>
                  <Select.Content position="popper">
                    <Select.Item value={NO_ACCOUNT}>{t("accountNone")}</Select.Item>
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
            name="amount"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field invalid={fieldState.invalid}>
                <FieldLabel htmlFor="movement-amount">{t("amountLabel")}</FieldLabel>
                <FieldControl>
                  <TextField.Root
                    {...field}
                    id="movement-amount"
                    size="3"
                    inputMode="numeric"
                    disabled={isPending}
                  />
                </FieldControl>
                <FieldMessage error={fieldState.error} />
              </Field>
            )}
          />
        </FieldGroup>

        {/* Two rows tall, because the splits grow with the categories while the
            track beside them holds five fields at rest. */}
        <Box gridColumn={{ md: "2" }} gridRow={{ md: "1 / span 2" }} width="100%">
          <FieldGroup>
            {/* Category and splits belong to an income or expense only; a transfer
                carries neither (RF-69). */}
            {(kind === "income" || kind === "expense") && (
              <Controller
                name="splits"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field invalid={fieldState.invalid}>
                    <FieldLabel>{t("categoryLabel")}</FieldLabel>
                    <SplitEditor
                      totalPesos={amount}
                      scope={scope}
                      kind={kind}
                      categories={options.categories}
                      value={field.value}
                      onChange={field.onChange}
                    />
                    <FieldMessage error={fieldState.error} />
                  </Field>
                )}
              />
            )}

            {/* A transfer carries no split but may carry labels, so the picker
                mounts for every derived kind (RF-70). */}
            <Controller
              name="labelIds"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field invalid={fieldState.invalid}>
                  {scopedLabels.length === 0 ? (
                    <>
                      <FieldLabel>{t("labelsLabel")}</FieldLabel>
                      <Text size="2" color="gray">
                        {t("labelsNone")}
                      </Text>
                    </>
                  ) : (
                    <FieldControl>
                      <ChipMultiSelect
                        id="movement-labels"
                        name="labelIds"
                        value={field.value}
                        onValueChange={field.onChange}
                        options={scopedLabels}
                        label={t("labelsLabel")}
                        disabled={isPending}
                      />
                    </FieldControl>
                  )}
                  <FieldMessage error={fieldState.error} />
                </Field>
              )}
            />
          </FieldGroup>
        </Box>

        <FieldGroup>
          <Controller
            name="occurredAt"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field invalid={fieldState.invalid}>
                <FieldLabel htmlFor="movement-date">{t("dateLabel")}</FieldLabel>
                <FieldControl>
                  <TextField.Root
                    {...field}
                    id="movement-date"
                    size="3"
                    type="date"
                    disabled={isPending}
                  />
                </FieldControl>
                <FieldMessage error={fieldState.error} />
              </Field>
            )}
          />

          <Controller
            name="description"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field invalid={fieldState.invalid}>
                <FieldLabel htmlFor="movement-note">
                  <Flex as="span" align="center" gap="1">
                    {t("note")}
                    <Text size="2" weight="regular" color="gray">
                      {tKey("common.optional")}
                    </Text>
                  </Flex>
                </FieldLabel>
                <FieldControl>
                  <TextField.Root
                    id="movement-note"
                    size="3"
                    autoComplete="off"
                    disabled={isPending}
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value || null)}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                </FieldControl>
                <FieldMessage error={fieldState.error} />
              </Field>
            )}
          />
        </FieldGroup>

        <Box gridColumn={{ md: "1 / -1" }} width="100%">
          <FieldGroup>
            <Callout.Root color="jade" variant="soft">
              <Callout.Icon>
                <InfoIcon size={16} />
              </Callout.Icon>
              <Callout.Text>{t("kindDerivedHint")}</Callout.Text>
            </Callout.Root>

            {/* Never dead: while the form is short of something, submitting is what
                makes it say so. */}
            <Button type="submit" size="3" disabled={isPending}>
              {isPending && <Spinner />}
              {isAccept ? tIngest("accept") : t("saveMovement")}
            </Button>
          </FieldGroup>
        </Box>
      </Grid>
    </form>
  );
}
