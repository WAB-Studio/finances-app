import type { ReactNode } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";

// The signed amount only turns green for income; an expense and a transfer both
// read in the plain ink of the row (per the ledger designs).
type MovementTone = "expense" | "income" | "transfer";

// One ledger line: a leading tile, the title over an optional subtitle, and the
// caller-formatted amount. Pure — every string and the sign arrive as props.
export function MovementRow({
  tile,
  title,
  subtitle,
  amount,
  tone = "expense",
}: {
  tile: ReactNode;
  title: string;
  subtitle?: string;
  amount: ReactNode;
  tone?: MovementTone;
}) {
  return (
    <Flex align="center" gap="3">
      {tile}
      <Box flexGrow="1" minWidth="0">
        <Text as="div" size="3" weight="medium" truncate>
          {title}
        </Text>
        {subtitle && (
          <Text as="div" size="2" color="gray" truncate>
            {subtitle}
          </Text>
        )}
      </Box>
      <Text
        size="3"
        weight="medium"
        color={tone === "income" ? "grass" : undefined}
        style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
      >
        {amount}
      </Text>
    </Flex>
  );
}
