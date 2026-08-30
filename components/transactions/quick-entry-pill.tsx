"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { useQuickEntry } from "@/components/transactions/quick-entry-provider";
import { Card, CategoryTile, Flex, Text } from "@/components/ui";

// The dashboard's one tap into expense quick entry (RF-22): a card that reads like
// the sheet's field but raises it in place, no route change. The provider wraps
// the app layout, so the hook is always in scope wherever this renders.
export function QuickEntryPill() {
  const t = useTranslations("transactions");
  const { openQuick } = useQuickEntry();

  return (
    <Card asChild>
      <button
        type="button"
        onClick={openQuick}
        style={{ width: "100%", textAlign: "start", font: "inherit", cursor: "pointer" }}
      >
        <Flex align="center" gap="3">
          <CategoryTile
            color="var(--accent-9)"
            size={34}
            icon={<Plus size={19} strokeWidth={2.4} color="var(--accent-contrast)" />}
          />
          <Text size="3" color="gray">
            {t("quickPlaceholder")}
          </Text>
        </Flex>
      </button>
    </Card>
  );
}
