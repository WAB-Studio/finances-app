"use client";

import { Download, FileSpreadsheet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import {
  Button,
  Card,
  Flex,
  Heading,
  Switch,
  Text,
  TextField,
} from "@/components/ui";
import type { SheetEntity } from "@/lib/spreadsheet/schema";

/**
 * The export half of the Data screen (RF-49, RF-50). The entity picks and the
 * optional civil-date range compose the query the export route reads; the
 * template route ignores both. Each action is a plain anchor so the browser runs
 * a real file download instead of a client navigation.
 */
export function DataScreen({
  entities,
}: {
  entities: readonly SheetEntity[];
}) {
  const t = useTranslations("data");
  const locale = useLocale();

  const [selected, setSelected] = useState<Set<SheetEntity>>(
    () => new Set(entities),
  );
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  function toggle(entity: SheetEntity, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(entity);
      else next.delete(entity);
      return next;
    });
  }

  // Only picked entities and set bounds ride the query; an empty selection drops
  // its key so the route falls back to all five (RF-50).
  const exportQuery = new URLSearchParams();
  const picked = entities.filter((entity) => selected.has(entity));
  if (picked.length > 0) exportQuery.set("entities", picked.join(","));
  if (from) exportQuery.set("from", from);
  if (to) exportQuery.set("to", to);
  const query = exportQuery.toString();

  const exportHref = `/${locale}/settings/data/export${query ? `?${query}` : ""}`;
  const templateHref = `/${locale}/settings/data/template`;

  return (
    <Flex direction="column" gap="4">
      <Heading size="5">{t("screen.title")}</Heading>

      <Card>
        <Flex direction="column" gap="4">
          <Heading size="3">{t("screen.exportHeading")}</Heading>

          <Flex direction="column" gap="1">
            <Text size="2" weight="medium" color="gray">
              {t("screen.entitiesLabel")}
            </Text>
            <Flex direction="column" gap="2" mt="1">
              {entities.map((entity) => (
                <Text key={entity} as="label" size="2">
                  <Flex align="center" gap="2">
                    <Switch
                      checked={selected.has(entity)}
                      onCheckedChange={(checked) => toggle(entity, checked)}
                    />
                    {t(`sheets.${entity}`)}
                  </Flex>
                </Text>
              ))}
            </Flex>
          </Flex>

          <Flex gap="3" wrap="wrap">
            <Flex direction="column" gap="1" flexGrow="1" minWidth="0">
              <Text size="2" weight="medium" color="gray">
                {t("screen.rangeFrom")}
              </Text>
              <TextField.Root
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </Flex>
            <Flex direction="column" gap="1" flexGrow="1" minWidth="0">
              <Text size="2" weight="medium" color="gray">
                {t("screen.rangeTo")}
              </Text>
              <TextField.Root
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </Flex>
          </Flex>

          <Button asChild>
            <a href={exportHref}>
              <Download size={16} />
              {t("screen.download")}
            </a>
          </Button>
        </Flex>
      </Card>

      <Card>
        <Flex direction="column" gap="3">
          <Heading size="3">{t("screen.templateHeading")}</Heading>
          <Text size="2" color="gray">
            {t("screen.templateDescription")}
          </Text>
          <Button asChild variant="soft">
            <a href={templateHref}>
              <FileSpreadsheet size={16} />
              {t("screen.downloadTemplate")}
            </a>
          </Button>
        </Flex>
      </Card>
    </Flex>
  );
}
