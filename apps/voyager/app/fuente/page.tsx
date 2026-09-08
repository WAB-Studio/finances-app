import NextLink from "next/link";
import { getTranslations } from "next-intl/server";

import manifestJson from "@/public/dictionary/manifest.json";
import { manifestSchema } from "@/lib/dictionary/format";
import { Box, Flex, Headword, Link, MetaLabel, Page, Separator, TapTarget, Text } from "@/components/ui";

// Imported, not fetched: the manifest is on disk at build time, so this route
// pays no request and needs no runtime data source (RL-15).
const manifest = manifestSchema.parse(manifestJson);

export default async function FuentePage() {
  const t = await getTranslations("source");
  const tLog = await getTranslations("log");
  const { source } = manifest;

  return (
    <Page>
      <Flex direction="column" gap="5">
        <Headword>{t("title")}</Headword>

        <Flex direction="column" gap="1">
          <Text size="5" serif>
            {t("dictionary")}
          </Text>
          <Text size="2" muted>
            {source.edition}
          </Text>
        </Flex>

        <Separator size="4" />

        <Flex direction="column" gap="1">
          <MetaLabel>{t("licence")}</MetaLabel>
          <Link href={source.licenceUrl} target="_blank" rel="noreferrer" aria-label={t("licenceLink")}>
            <TapTarget align="center">
              <Text size="5" serif>
                {t("licenceName")}
              </Text>
            </TapTarget>
          </Link>
        </Flex>

        <Link href={source.url} target="_blank" rel="noreferrer">
          <TapTarget align="center">{t("sourceLink")}</TapTarget>
        </Link>

        <Box maxWidth="45ch">
          <Text size="1" muted as="p">
            {source.attribution}
          </Text>
        </Box>

        <Text size="2" muted as="p">
          {t("modified")}
        </Text>

        <Separator size="4" />

        <Link asChild>
          <NextLink href="/registro">
            <TapTarget align="center">{tLog("openLink")}</TapTarget>
          </NextLink>
        </Link>

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
