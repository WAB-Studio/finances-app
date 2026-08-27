import type { ReactNode } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";

// Matches the dashboard's empty state so no screen invents its own.
export function EmptyState({
  title,
  description,
  action,
}: {
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
