import type { ReactNode } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";

// Matches the dashboard's empty state so no screen invents its own.
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Flex
      direction="column"
      flexGrow="1"
      align="center"
      justify="center"
      gap="2"
    >
      {icon && (
        <Flex
          align="center"
          justify="center"
          mb="2"
          style={{
            width: 96,
            height: 96,
            borderRadius: "9999px",
            background: "var(--gray-a3)",
            color: "var(--gray-9)",
          }}
        >
          {icon}
        </Flex>
      )}
      <Text size="4" weight="medium" align="center">
        {title}
      </Text>
      {description && (
        <Box maxWidth="65ch">
          <Text color="gray" align="center">
            {description}
          </Text>
        </Box>
      )}
      {action}
    </Flex>
  );
}
