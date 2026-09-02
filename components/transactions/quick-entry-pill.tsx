"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { useQuickEntry } from "@/components/transactions/quick-entry-provider";
import { Card, CategoryTile, Flex, TapTarget, Text } from "@/components/ui";

// A control that carries no chrome of its own: the row around it is the surface.
const PLAIN_BUTTON = {
  padding: 0,
  border: 0,
  background: "none",
  font: "inherit",
  textAlign: "start",
  cursor: "pointer",
} as const;

// The dashboard's one tap into expense quick entry (RF-22): a card that reads like
// the sheet's field but raises it in place, no route change. The provider wraps
// the app layout, so the hook is always in scope wherever this renders.
//
// `wide` is the row the Inicio artboard draws on the desktop: the same tap, plus
// the income-or-transfer hand-off the sheet also offers (RF-18), which is a
// button of its own so no control nests inside another.
export function QuickEntryPill({
  variant = "compact",
}: {
  variant?: "compact" | "wide";
}) {
  const t = useTranslations("transactions");
  const { openQuick, openFull } = useQuickEntry();

  if (variant === "wide") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "13px 18px",
          backgroundColor: "var(--color-panel-solid)",
          border: "1px solid var(--gray-a4)",
          borderRadius: 16,
        }}
      >
        <Flex asChild align="center" gap="3" flexGrow="1" minWidth="0">
          <button type="button" onClick={openQuick} style={PLAIN_BUTTON}>
            <CategoryTile
              color="var(--accent-9)"
              size={36}
              icon={<Plus size={19} strokeWidth={2.4} color="var(--accent-contrast)" />}
            />
            <Text size="3" color="gray" truncate>
              {t("quickPlaceholder")}
            </Text>
          </button>
        </Flex>
        <button type="button" onClick={openFull} style={PLAIN_BUTTON}>
          <TapTarget align="center" px="1">
            <Text size="2" weight="medium" color="jade">
              {t("quickTypeLink")}
            </Text>
          </TapTarget>
        </button>
      </div>
    );
  }

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
