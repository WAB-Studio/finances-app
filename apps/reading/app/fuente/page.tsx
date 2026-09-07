import NextLink from "next/link";
import { getTranslations } from "next-intl/server";

import manifestJson from "@/public/dictionary/manifest.json";
import { manifestSchema } from "@/lib/dictionary/format";
import { Box, Flex, Heading, Link, Page, Separator, TapTarget, Text } from "@/components/ui";

// Imported, not fetched: the manifest is on disk at build time, so this route
// pays no request and needs no runtime data source (RL-15).
const manifest = manifestSchema.parse(manifestJson);

export default async function FuentePage() {
  const t = await getTranslations("source");
  const { source } = manifest;

  return (
    <Page>
      <Flex direction="column" gap="5">
        <Heading size="6">{t("title")}</Heading>

        <Flex direction="column" gap="1">
          <Text size="4" weight="bold">
            {t("dictionary")}
          </Text>
          <Text size="2" color="gray">
            {source.edition}
          </Text>
        </Flex>

        <Separator size="4" />

        <Flex direction="column" gap="1">
          <Text size="2" color="gray">
            {t("licence")}
          </Text>
          <Link href={source.licenceUrl} target="_blank" rel="noreferrer" aria-label={t("licenceLink")}>
            <TapTarget align="center">{t("licenceName")}</TapTarget>
          </Link>
        </Flex>

        <Link href={source.url} target="_blank" rel="noreferrer">
          <TapTarget align="center">{t("sourceLink")}</TapTarget>
        </Link>

        <Box maxWidth="45ch">
          <Text size="1" color="gray" as="p">
            {source.attribution}
          </Text>
        </Box>

        <Text size="2" as="p">
          {t("modified")}
        </Text>

        <Link asChild>
          <NextLink href="/">
            <TapTarget align="center" justify="center" px="2">
              {t("back")}
            </TapTarget>
          </NextLink>
        </Link>
      </Flex>
    </Page>
  );
}
