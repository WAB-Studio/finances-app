import { useTranslations } from "next-intl";

import { Box, Flex, Heading, Link, Text } from "@/components/ui";
import { Link as LocaleLink } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations();

  return (
    <Flex
      asChild
      direction="column"
      align="center"
      justify="center"
      gap="4"
      flexGrow="1"
      p="6"
    >
      <main>
        <Heading size="6" align="center">
          {t("errors.notFoundTitle")}
        </Heading>
        <Box maxWidth="65ch">
          <Text color="gray" align="center">
            {t("errors.notFoundDescription")}
          </Text>
        </Box>
        <Link asChild>
          <LocaleLink href="/">{t("common.backHome")}</LocaleLink>
        </Link>
      </main>
    </Flex>
  );
}
