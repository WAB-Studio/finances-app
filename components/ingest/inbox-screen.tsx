"use client";

import { useTranslations } from "next-intl";

import { DeliveryCard } from "@/components/ingest/delivery-card";
import { EmptyState, Flex, Heading } from "@/components/ui";
import type { PendingDeliveryRow } from "@/db/queries/ingest-review";
import type { TransactionFormOptions } from "@/db/queries/transaction-form";

export function InboxScreen({
  deliveries,
  options,
}: {
  deliveries: PendingDeliveryRow[];
  options: TransactionFormOptions;
}) {
  const t = useTranslations("ingest");

  return (
    <Flex direction="column" gap="4">
      <Heading size="5">{t("title")}</Heading>

      {deliveries.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <Flex direction="column" gap="3">
          {deliveries.map((delivery) => (
            <DeliveryCard
              key={delivery.id}
              delivery={delivery}
              options={options}
            />
          ))}
        </Flex>
      )}
    </Flex>
  );
}
