"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import type { ComponentProps } from "react";
import { Controller, useForm } from "react-hook-form";

import { createFundAction } from "@/app/actions/fund";
import {
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldMessage,
  Spinner,
  TextField,
  useFieldControl,
} from "@/components/ui";
import { useActionErrorToast } from "@/lib/use-action-toast";
import { createFundSchema, type CreateFundInput } from "@/lib/validation/fund";

// Field's own child, not Controller's: `useFieldControl` reads the invalid
// state Field provides, which only reaches components nested inside it.
function FieldTextField(props: ComponentProps<typeof TextField.Root>) {
  return <TextField.Root {...props} {...useFieldControl()} />;
}

export function CreateFundForm() {
  const t = useTranslations("onboarding");

  const form = useForm({
    resolver: zodResolver(createFundSchema),
    defaultValues: { name: "", memberName: "" },
  });

  const { execute, isPending } = useAction(createFundAction, {
    onError: useActionErrorToast(),
  });

  function onSubmit(values: CreateFundInput) {
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
              <FieldLabel htmlFor="fund-name">{t("fundNameLabel")}</FieldLabel>
              <FieldTextField
                {...field}
                id="fund-name"
                size="3"
                autoFocus
                autoComplete="off"
                placeholder={t("fundNamePlaceholder")}
                disabled={isPending}
              />
              <FieldMessage error={fieldState.error} />
            </Field>
          )}
        />
        <Controller
          name="memberName"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="member-name">
                {t("memberNameLabel")}
              </FieldLabel>
              <FieldTextField
                {...field}
                id="member-name"
                size="3"
                autoComplete="name"
                disabled={isPending}
              />
              <FieldDescription>{t("memberNameDescription")}</FieldDescription>
              <FieldMessage error={fieldState.error} />
            </Field>
          )}
        />
        <Field>
          <Button type="submit" disabled={isPending}>
            {isPending && <Spinner />}
            {isPending ? t("submitting") : t("submit")}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}
