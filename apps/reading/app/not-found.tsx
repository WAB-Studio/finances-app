import NextLink from "next/link";
import { useTranslations } from "next-intl";

import { Box, Flex, Heading, Link, Page, TapTarget, Text } from "@/components/ui";

export default function NotFound() {
  const t = useTranslations("notFound");

  return (
    <Page>
      <Flex direction="column" align="center" justify="center" gap="4" flexGrow="1">
        <Heading size="6" align="center">
          {t("title")}
        </Heading>
        <Box maxWidth="45ch">
          <Text color="gray" align="center" as="p">
            {t("description")}
          </Text>
        </Box>
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
