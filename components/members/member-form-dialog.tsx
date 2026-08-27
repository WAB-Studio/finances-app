"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useEffect } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";

import { createMemberAction, updateMemberAction } from "@/app/actions/members";
import {
  Button,
  Dialog,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Flex,
  Spinner,
  TextField,
} from "@/components/ui";
import { createMemberSchema, updateMemberSchema } from "@/lib/validation/member";

type FormValues = { fundId: string; memberId?: string; name: string };

export function MemberFormDialog({
  fundId,
  open,
  onOpenChange,
  member,
}: {
  fundId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member?: { id: string; name: string };
}) {
  const t = useTranslations("members");
  // Root-scoped: the keys arriving from the schema and the action are full paths.
  const tKey = useTranslations();
  type MessageKey = Parameters<typeof tKey>[0];

  const mode = member ? "edit" : "create";
  const schema = member ? updateMemberSchema : createMemberSchema;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: member
      ? { fundId, memberId: member.id, name: member.name }
      : { fundId, name: "" },
  });

  // Reopening for a create must not show the name left over from an edit.
  useEffect(() => {
    if (!open) return;
    form.reset(
      member
        ? { fundId, memberId: member.id, name: member.name }
        : { fundId, name: "" },
    );
  }, [open, fundId, member, form]);

  function onError({ error }: { error: { serverError?: string } }) {
    toast.error(tKey((error.serverError ?? "errors.unexpected") as MessageKey));
  }

  // Both hooks stay mounted regardless of mode: React forbids a conditional call.
  const createState = useAction(createMemberAction, {
    onSuccess() {
      toast.success(t("created"));
      onOpenChange(false);
    },
    onError,
  });
  const updateState = useAction(updateMemberAction, {
    onSuccess() {
      toast.success(t("updated"));
      onOpenChange(false);
    },
    onError,
  });

  const isPending =
    mode === "edit" ? updateState.isPending : createState.isPending;

  function onSubmit(values: FormValues) {
    if (mode === "edit") {
      updateState.execute({
        fundId: values.fundId,
        memberId: values.memberId!,
        name: values.name,
      });
    } else {
      createState.execute({ fundId: values.fundId, name: values.name });
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Flex direction="column" gap="4">
          <Dialog.Title>
            {t(mode === "edit" ? "editTitle" : "addTitle")}
          </Dialog.Title>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FieldGroup>
              <Controller
                name="name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="member-name">
                      {t("nameLabel")}
                    </FieldLabel>
                    <TextField.Root
                      {...field}
                      id="member-name"
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
              <Flex gap="3" justify="end">
                <Dialog.Close>
                  <Button
                    type="button"
                    variant="soft"
                    color="gray"
                    disabled={isPending}
                  >
                    {tKey("common.cancel")}
                  </Button>
                </Dialog.Close>
                <Button type="submit" disabled={isPending}>
                  {isPending && <Spinner />}
                  {tKey("common.save")}
                </Button>
              </Flex>
            </FieldGroup>
          </form>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
