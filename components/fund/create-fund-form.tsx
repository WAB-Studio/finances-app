"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { Controller, useForm } from "react-hook-form";

import { createGroupAction } from "@/app/actions/fund";
import {
  Button,
  Field,
  FieldControl,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldMessage,
  Spinner,
  TextField,
} from "@/components/ui";
import { useActionErrorToast } from "@/lib/use-action-toast";
import { createFundSchema, type CreateFundInput } from "@/lib/validation/fund";

export function CreateFundForm() {
  const t = useTranslations("onboarding");

  const form = useForm({
    resolver: zodResolver(createFundSchema),
    defaultValues: { name: "", memberName: "" },
  });

  const { execute, isPending } = useAction(createGroupAction, {
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
              <FieldControl>
                <TextField.Root
                  {...field}
                  id="fund-name"
                  size="3"
                  autoFocus
                  autoComplete="off"
                  placeholder={t("fundNamePlaceholder")}
                  disabled={isPending}
                />
              </FieldControl>
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
              <FieldControl>
                <TextField.Root
                  {...field}
                  id="member-name"
                  size="3"
                  autoComplete="name"
                  disabled={isPending}
                />
              </FieldControl>
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
