"use client";

import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { switchFundAction } from "@/app/actions/fund";
import { Box, Flex, Select, Spinner, Text } from "@/components/ui";
import type { FundSummary } from "@/db/queries/funds";
import { usePathname } from "@/i18n/navigation";

// `/f/<id>/…`, locale already stripped by `usePathname`.
function activeFundId(pathname: string): string | undefined {
  const [, root, id] = pathname.split("/");
  return root === "f" ? id : undefined;
}

export function FundSwitcher({ funds }: { funds: FundSummary[] }) {
  const t = useTranslations("fund");
  // Root-scoped: the action's error is a full catalogue path.
  const tKey = useTranslations();
  type MessageKey = Parameters<typeof tKey>[0];
  const pathname = usePathname();
  const [picked, setPicked] = useState<string | null>(null);

  const { execute } = useAction(switchFundAction, {
    onError({ error }) {
      setPicked(null);
      toast.error(
        tKey((error.serverError ?? "errors.unexpected") as MessageKey),
      );
    },
  });

  const active = activeFundId(pathname);
  // The server owns the redirect, so the URL arriving is what ends the wait.
  const switching = picked !== null && picked !== active;

  if (funds.length === 0) {
    return (
      <Box flexGrow="1" minWidth="0" asChild>
        <Text weight="bold" truncate>
          {tKey("common.appName")}
        </Text>
      </Box>
    );
  }

  if (funds.length === 1) {
    return (
      <Box flexGrow="1" minWidth="0" asChild>
        <Text weight="bold" truncate>
          {funds[0].name}
        </Text>
      </Box>
    );
  }

  function onValueChange(fundId: string) {
    setPicked(fundId);
    execute({ fundId });
  }

  const selected = funds.find((fund) => fund.id === (picked ?? active));

  return (
    <Select.Root
      value={picked ?? active ?? ""}
      onValueChange={onValueChange}
      disabled={switching}
    >
      {/* Elastic, not fixed: the trigger fills the free width `ToolbarSelect` doesn't leave. */}
      <Box flexGrow="1" flexShrink="1" minWidth="0" asChild>
        <Select.Trigger aria-label={t("label")}>
          <Flex
            as="span"
            align="center"
            justify="between"
            gap="2"
            width="100%"
          >
            <Box asChild flexGrow="1" minWidth="0">
              <Text truncate>{selected?.name}</Text>
            </Box>
            {switching && <Spinner />}
          </Flex>
        </Select.Trigger>
      </Box>
      <Select.Content position="popper">
        {funds.map((fund) => (
          <Select.Item key={fund.id} value={fund.id}>
            {fund.name}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
