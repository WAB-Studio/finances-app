import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Flex, Text } from "@radix-ui/themes";

// Carries a Field's invalid flag down to its FieldLabel, nothing else.
const FieldInvalidContext = createContext(false);

// One vertical stack of Fields, the gap that separates one form row from the next.
export function FieldGroup({ children }: { children?: ReactNode }) {
  return (
    <Flex direction="column" gap="5" width="100%">
      {children}
    </Flex>
  );
}

// One form row: label, control, description and error stacked together.
export function Field({
  invalid,
  children,
}: {
  invalid?: boolean;
  children?: ReactNode;
}) {
  return (
    <FieldInvalidContext.Provider value={!!invalid}>
      <Flex
        role="group"
        direction="column"
        gap="2"
        width="100%"
        data-invalid={invalid || undefined}
      >
        {children}
      </Flex>
    </FieldInvalidContext.Provider>
  );
}

export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children?: ReactNode;
}) {
  const invalid = useContext(FieldInvalidContext);
  return (
    <Text
      as="label"
      htmlFor={htmlFor}
      size="2"
      weight="medium"
      color={invalid ? "red" : undefined}
    >
      {children}
    </Text>
  );
}

export function FieldDescription({ children }: { children?: ReactNode }) {
  return (
    <Text as="p" size="2" color="gray">
      {children}
    </Text>
  );
}

export function FieldError({
  errors,
  children,
}: {
  errors?: Array<{ message?: string } | undefined>;
  children?: ReactNode;
}) {
  const content = useMemo(() => {
    if (children) {
      return children;
    }

    if (!errors?.length) {
      return null;
    }

    // Same message reported twice (e.g. by two rules) collapses to one.
    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ];

    if (uniqueErrors.length === 1) {
      return uniqueErrors[0]?.message;
    }

    return (
      <ul>
        {uniqueErrors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>,
        )}
      </ul>
    );
  }, [children, errors]);

  if (!content) {
    return null;
  }

  return (
    <Text as="div" role="alert" size="2" color="red">
      {content}
    </Text>
  );
}
