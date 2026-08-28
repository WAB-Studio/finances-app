"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import {
  Controller,
  useForm,
  type ControllerRenderProps,
  type Resolver,
} from "react-hook-form";
import { toast } from "sonner";

import { createMemberAction, updateMemberAction } from "@/app/actions/members";
import {
  Button,
  Dialog,
  Field,
  FieldGroup,
  FieldLabel,
  FieldMessage,
  Flex,
  Spinner,
  TextField,
  useFieldControl,
} from "@/components/ui";
import { useActionErrorToast } from "@/lib/use-action-toast";
import { createMemberSchema, updateMemberSchema } from "@/lib/validation/member";

type FormValues = { fundId: string; memberId?: string; name: string };

type Member = { id: string; name: string };

export function MemberFormDialog({
  fundId,
  open,
  onOpenChange,
  member,
}: {
  fundId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member?: Member;
}) {
  const t = useTranslations("members");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Flex direction="column" gap="4">
          <Dialog.Title>{t(member ? "editTitle" : "addTitle")}</Dialog.Title>
          {/* Closing unmounts the content, and the key remounts on a change of
              subject, so the form below is always born with fresh defaults. */}
          <MemberForm
            key={member?.id ?? "create"}
            fundId={fundId}
            member={member}
            onOpenChange={onOpenChange}
          />
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function MemberForm({
  fundId,
  member,
  onOpenChange,
}: {
  fundId: string;
  member?: Member;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("members");
  // Root-scoped: `common` is a full catalogue path, not this component's namespace.
  const tKey = useTranslations();
  const onError = useActionErrorToast();

  const mode = member ? "edit" : "create";
  const schema = member ? updateMemberSchema : createMemberSchema;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: member
      ? { fundId, memberId: member.id, name: member.name }
      : { fundId, name: "" },
  });

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
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.invalid}>
              <FieldLabel htmlFor="member-name">{t("nameLabel")}</FieldLabel>
              <NameField field={field} disabled={isPending} />
              <FieldMessage error={fieldState.error} />
            </Field>
          )}
        />
        <Field>
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
        </Field>
      </FieldGroup>
    </form>
  );
}

// A named component, not an inline render callback: `useFieldControl` reads
// the enclosing Field's context, and only a component may call a hook.
function NameField({
  field,
  disabled,
}: {
  field: ControllerRenderProps<FormValues, "name">;
  disabled: boolean;
}) {
  const controlProps = useFieldControl();

  return (
    <TextField.Root
      {...field}
      {...controlProps}
      id="member-name"
      size="3"
      autoFocus
      autoComplete="off"
      disabled={disabled}
    />
  );
}
