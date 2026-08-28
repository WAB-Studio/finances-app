"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { createFundAction } from "@/app/actions/fund";
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Spinner,
  TextField,
} from "@/components/ui";
import { createFundSchema, type CreateFundInput } from "@/lib/validation/fund";

export function CreateFundForm() {
  const t = useTranslations("onboarding");
  // Root-scoped: the keys arriving from the schema and the action are full paths.
  const tKey = useTranslations();
  type MessageKey = Parameters<typeof tKey>[0];

  const form = useForm({
    resolver: zodResolver(createFundSchema),
    defaultValues: { name: "", memberName: "" },
  });

  const { execute, isPending } = useAction(createFundAction, {
    onError({ error }) {
      toast.error(
        tKey((error.serverError ?? "errors.unexpected") as MessageKey),
      );
    },
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
              <TextField.Root
                {...field}
                id="fund-name"
                size="3"
                autoFocus
                autoComplete="off"
                placeholder={t("fundNamePlaceholder")}
                aria-invalid={fieldState.invalid}
                disabled={isPending}
              />
              {fieldState.invalid && (
                // The Zod message is a key; `FieldError` prints whatever string it gets.
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
          name="memberName"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="member-name">
                {t("memberNameLabel")}
              </FieldLabel>
              <TextField.Root
                {...field}
                id="member-name"
                size="3"
                autoComplete="name"
                aria-invalid={fieldState.invalid}
                disabled={isPending}
              />
              <FieldDescription>{t("memberNameDescription")}</FieldDescription>
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
          <Button type="submit" size="3" disabled={isPending}>
            {isPending && <Spinner />}
            {isPending ? t("submitting") : t("submit")}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}
