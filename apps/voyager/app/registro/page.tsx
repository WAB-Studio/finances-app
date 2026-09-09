import { getTranslations } from "next-intl/server";

import { ExportPanel } from "@/components/log/export-panel";
import { HistoryList } from "@/components/log/history-list";
import { Flex, Headword, Page } from "@/components/ui";

// Server-rendered shell alone, like `/fuente`: the count and the download
// belong to the client component this mounts. No `useDictionary` here, so
// no second Worker parses the payload on a screen that never looks a word
// up (RNL-08). `measure="full"`: Registro is a list, not prose, so it takes
// the width it needs (docs/voyager/DESIGN.md "Viewport").
export default async function RegistroPage() {
  const t = await getTranslations("log");

  return (
    <Page measure="full">
      <Flex direction="column" gap="5">
        <Headword>{t("title")}</Headword>

        <ExportPanel />

        <HistoryList />
      </Flex>
    </Page>
  );
}
