import NextLink from "next/link";
import { getTranslations } from "next-intl/server";

import { ExportPanel } from "@/components/log/export-panel";
import { Flex, Headword, Link, Page, TapTarget } from "@/components/ui";

// Server-rendered shell alone, like `/fuente`: the count and the download
// belong to the client component this mounts. No `useDictionary` here, so
// no second Worker parses the payload on a screen that never looks a word
// up (RNL-08).
export default async function RegistroPage() {
  const t = await getTranslations("log");

  return (
    <Page>
      <Flex direction="column" gap="5">
        <Headword>{t("title")}</Headword>

        <ExportPanel />

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
