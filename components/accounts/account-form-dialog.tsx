"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { createAccountAction, updateAccountAction } from "@/app/actions/accounts";
import {
  Button,
  Dialog,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Flex,
  SegmentedControl,
  Select,
  Spinner,
  Text,
  TextField,
} from "@/components/ui";
import type { AccountRow } from "@/db/queries/accounts";
import { todayInBogota } from "@/lib/dates";
import { centsToPesos } from "@/lib/money";
import {
  createAccountSchema,
  updateAccountSchema,
  type CreateAccountInput,
  type UpdateAccountInput,
} from "@/lib/validation/account";

type Member = { id: string; name: string };

// Radix Select refuses an empty item value, so the fund option crosses the
// wire under this sentinel; both directions convert it back to `null`.
const FUND_OWNER = "fund";

export function AccountFormDialog({
  fundId,
  members,
  open,
  onOpenChange,
  account,
}: {
  fundId: string;
  members: Member[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: AccountRow;
}) {
  const t = useTranslations("accounts");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Dialog.Title>{account ? t("editTitle") : t("addTitle")}</Dialog.Title>
        {account ? (
          // Keyed by account: closing unmounts the form, so switching which
          // account is being edited never leaks the previous one's draft.
          <EditAccountForm
            key={account.id}
            fundId={fundId}
            members={members}
            account={account}
            onOpenChange={onOpenChange}
          />
        ) : (
          <CreateAccountForm
            key="create"
            fundId={fundId}
            members={members}
            onOpenChange={onOpenChange}
          />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

function CreateAccountForm({
  fundId,
  members,
  onOpenChange,
}: {
  fundId: string;
  members: Member[];
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("accounts");
  // Root-scoped: the keys arriving from the schema and the action are full paths.
  const tKey = useTranslations();
  type MessageKey = Parameters<typeof tKey>[0];

  const form = useForm({
    resolver: zodResolver(createAccountSchema),
    defaultValues: {
      fundId,
      name: "",
      kind: "asset",
      memberId: null,
      institution: "",
      amount: "",
      balanceOn: todayInBogota(),
    },
  });

  // Drives the amount label: it reads differently for an asset than for a debt.
  const kind = useWatch({ control: form.control, name: "kind" });
  const amountLabel =
    kind === "liability" ? t("openingOwedLabel") : t("openingBalanceLabel");

  const { execute, isPending } = useAction(createAccountAction, {
    onSuccess() {
      toast.success(t("created"));
      onOpenChange(false);
    },
    onError({ error }) {
      toast.error(
        tKey((error.serverError ?? "errors.unexpected") as MessageKey),
      );
    },
  });

  function onSubmit(values: CreateAccountInput) {
    execute(values);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="account-name">{t("nameLabel")}</FieldLabel>
              <TextField.Root
                {...field}
                id="account-name"
                size="3"
                autoFocus
                autoComplete="off"
                aria-invalid={fieldState.invalid}
                disabled={isPending}
              />
              {fieldState.invalid && (
                <FieldError
                  errors={[
                    { message: tKey(fieldState.error!.message as MessageKey) },
                  ]}
                />
              )}
            </Field>
          )}
        />
        <Controller
          name="kind"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="account-kind">{t("kindLabel")}</FieldLabel>
              <SegmentedControl.Root
                id="account-kind"
                size="3"
                value={field.value}
                onValueChange={field.onChange}
                aria-invalid={fieldState.invalid}
              >
                <SegmentedControl.Item value="asset">
                  {t("kindAsset")}
                </SegmentedControl.Item>
                <SegmentedControl.Item value="liability">
                  {t("kindLiability")}
                </SegmentedControl.Item>
              </SegmentedControl.Root>
              {fieldState.invalid && (
                <FieldError
                  errors={[
                    { message: tKey(fieldState.error!.message as MessageKey) },
                  ]}
                />
              )}
            </Field>
          )}
        />
        <Controller
          name="memberId"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="account-owner">{t("ownerLabel")}</FieldLabel>
              <Select.Root
                size="3"
                value={field.value ?? FUND_OWNER}
                onValueChange={(value) =>
                  field.onChange(value === FUND_OWNER ? null : value)
                }
                disabled={isPending}
              >
                <Select.Trigger
                  id="account-owner"
                  aria-invalid={fieldState.invalid}
                />
                <Select.Content position="popper">
                  <Select.Item value={FUND_OWNER}>{t("ownerFund")}</Select.Item>
                  {members.map((member) => (
                    <Select.Item key={member.id} value={member.id}>
                      {member.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              {fieldState.invalid && (
                <FieldError
                  errors={[
                    { message: tKey(fieldState.error!.message as MessageKey) },
                  ]}
                />
              )}
            </Field>
          )}
        />
        <Controller
          name="institution"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="account-institution">
                <Flex as="span" align="center" gap="1">
                  {t("institutionLabel")}
                  <Text size="2" weight="regular" color="gray">
                    {tKey("common.optional")}
                  </Text>
                </Flex>
              </FieldLabel>
              <TextField.Root
                {...field}
                value={field.value ?? ""}
                id="account-institution"
                size="3"
                autoComplete="organization"
                aria-invalid={fieldState.invalid}
                disabled={isPending}
              />
              {fieldState.invalid && (
                <FieldError
                  errors={[
                    { message: tKey(fieldState.error!.message as MessageKey) },
                  ]}
                />
              )}
            </Field>
          )}
        />
        <Controller
          name="amount"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="account-amount">{amountLabel}</FieldLabel>
              <TextField.Root
                {...field}
                id="account-amount"
                size="3"
                inputMode="numeric"
                aria-invalid={fieldState.invalid}
                disabled={isPending}
              />
              {fieldState.invalid && (
                <FieldError
                  errors={[
                    { message: tKey(fieldState.error!.message as MessageKey) },
                  ]}
                />
              )}
            </Field>
          )}
        />
        <Controller
          name="balanceOn"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="account-balance-on">
                {t("openingBalanceOnLabel")}
              </FieldLabel>
              <TextField.Root
                {...field}
                id="account-balance-on"
                size="3"
                type="date"
                aria-invalid={fieldState.invalid}
                disabled={isPending}
              />
              {fieldState.invalid && (
                <FieldError
                  errors={[
                    { message: tKey(fieldState.error!.message as MessageKey) },
                  ]}
                />
              )}
            </Field>
          )}
        />
        <Field>
          <Flex gap="3" justify="end">
            <Dialog.Close>
              <Button
                type="button"
                size="3"
                variant="soft"
                color="gray"
                disabled={isPending}
              >
                {tKey("common.cancel")}
              </Button>
            </Dialog.Close>
            <Button type="submit" size="3" disabled={isPending}>
              {isPending && <Spinner />}
              {tKey("common.save")}
            </Button>
          </Flex>
        </Field>
      </FieldGroup>
    </form>
  );
}

function EditAccountForm({
  fundId,
  members,
  account,
  onOpenChange,
}: {
  fundId: string;
  members: Member[];
  account: AccountRow;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("accounts");
  const tKey = useTranslations();
  type MessageKey = Parameters<typeof tKey>[0];

  const form = useForm({
    resolver: zodResolver(updateAccountSchema),
    defaultValues: {
      fundId,
      accountId: account.id,
      name: account.name,
      memberId: account.memberId,
      institution: account.institution ?? "",
      amount: String(centsToPesos(Math.abs(account.initialBalanceCents))),
      balanceOn: account.initialBalanceOn,
    },
  });

  const amountLabel =
    account.kind === "liability"
      ? t("openingOwedLabel")
      : t("openingBalanceLabel");

  const { execute, isPending } = useAction(updateAccountAction, {
    onSuccess() {
      toast.success(t("updated"));
      onOpenChange(false);
    },
    onError({ error }) {
      toast.error(
        tKey((error.serverError ?? "errors.unexpected") as MessageKey),
      );
    },
  });

  function onSubmit(values: UpdateAccountInput) {
    execute(values);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="account-name">{t("nameLabel")}</FieldLabel>
              <TextField.Root
                {...field}
                id="account-name"
                size="3"
                autoFocus
                autoComplete="off"
                aria-invalid={fieldState.invalid}
                disabled={isPending}
              />
              {fieldState.invalid && (
                <FieldError
                  errors={[
                    { message: tKey(fieldState.error!.message as MessageKey) },
                  ]}
                />
              )}
            </Field>
          )}
        />
        <Field>
          <FieldLabel htmlFor="account-kind">{t("kindLabel")}</FieldLabel>
          {/* Kind is absent from the update grant: a control here would
              promise a change the database refuses. */}
          <Text id="account-kind" size="3">
            {account.kind === "liability" ? t("kindLiability") : t("kindAsset")}
          </Text>
          <FieldDescription>{t("kindLocked")}</FieldDescription>
        </Field>
        <Controller
          name="memberId"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="account-owner">{t("ownerLabel")}</FieldLabel>
              <Select.Root
                size="3"
                value={field.value ?? FUND_OWNER}
                onValueChange={(value) =>
                  field.onChange(value === FUND_OWNER ? null : value)
                }
                disabled={isPending}
              >
                <Select.Trigger
                  id="account-owner"
                  aria-invalid={fieldState.invalid}
                />
                <Select.Content position="popper">
                  <Select.Item value={FUND_OWNER}>{t("ownerFund")}</Select.Item>
                  {members.map((member) => (
                    <Select.Item key={member.id} value={member.id}>
                      {member.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              {fieldState.invalid && (
                <FieldError
                  errors={[
                    { message: tKey(fieldState.error!.message as MessageKey) },
                  ]}
                />
              )}
            </Field>
          )}
        />
        <Controller
          name="institution"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="account-institution">
                <Flex as="span" align="center" gap="1">
                  {t("institutionLabel")}
                  <Text size="2" weight="regular" color="gray">
                    {tKey("common.optional")}
                  </Text>
                </Flex>
              </FieldLabel>
              <TextField.Root
                {...field}
                value={field.value ?? ""}
                id="account-institution"
                size="3"
                autoComplete="organization"
                aria-invalid={fieldState.invalid}
                disabled={isPending}
              />
              {fieldState.invalid && (
                <FieldError
                  errors={[
                    { message: tKey(fieldState.error!.message as MessageKey) },
                  ]}
                />
              )}
            </Field>
          )}
        />
        <Controller
          name="amount"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="account-amount">{amountLabel}</FieldLabel>
              <TextField.Root
                {...field}
                id="account-amount"
                size="3"
                inputMode="numeric"
                aria-invalid={fieldState.invalid}
                disabled={isPending}
              />
              {fieldState.invalid && (
                <FieldError
                  errors={[
                    { message: tKey(fieldState.error!.message as MessageKey) },
                  ]}
                />
              )}
            </Field>
          )}
        />
        <Controller
          name="balanceOn"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="account-balance-on">
                {t("openingBalanceOnLabel")}
              </FieldLabel>
              <TextField.Root
                {...field}
                id="account-balance-on"
                size="3"
                type="date"
                aria-invalid={fieldState.invalid}
                disabled={isPending}
              />
              {fieldState.invalid && (
                <FieldError
                  errors={[
                    { message: tKey(fieldState.error!.message as MessageKey) },
                  ]}
                />
              )}
            </Field>
          )}
        />
        <Field>
          <Flex gap="3" justify="end">
            <Dialog.Close>
              <Button
                type="button"
                size="3"
                variant="soft"
                color="gray"
                disabled={isPending}
              >
                {tKey("common.cancel")}
              </Button>
            </Dialog.Close>
            <Button type="submit" size="3" disabled={isPending}>
              {isPending && <Spinner />}
              {tKey("common.save")}
            </Button>
          </Flex>
        </Field>
      </FieldGroup>
    </form>
  );
}
