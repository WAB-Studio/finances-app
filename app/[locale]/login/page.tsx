import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { CircleAlertIcon } from "lucide-react";
import { notFound } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { Box, Callout, Card, Flex, Heading, Text } from "@/components/ui";
import { routing } from "@/i18n/routing";

// A path the proxy put in `?next=`, or nothing: a repeated parameter arrives as
// an array and is not a destination.
function firstValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function generateMetadata(
  props: PageProps<"/[locale]/login">,
): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "metadata" });

  return {
    title: t("loginTitle"),
    description: t("loginDescription"),
  };
}

export default async function LoginPage(props: PageProps<"/[locale]/login">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  const searchParams = await props.searchParams;
  const t = await getTranslations();

  // Set by `/auth/confirm` when the magic link is expired or already spent.
  const linkInvalid = firstValue(searchParams.error) === "linkInvalid";

  return (
    <Flex asChild flexGrow="1" align="center" justify="center" p="4">
      <main>
        <Box width="100%" maxWidth="24rem">
          <Card>
            <Flex direction="column" gap="4">
              <Flex direction="column" gap="1">
                <Heading size="5">{t("auth.signIn")}</Heading>
                <Text color="gray">{t("auth.loginDescription")}</Text>
              </Flex>
              {linkInvalid && (
                <Callout.Root color="red" role="alert">
                  <Callout.Icon>
                    <CircleAlertIcon size={16} aria-hidden />
                  </Callout.Icon>
                  <Callout.Text>{t("errors.linkInvalid")}</Callout.Text>
                </Callout.Root>
              )}
              <LoginForm next={firstValue(searchParams.next)} />
            </Flex>
          </Card>
        </Box>
      </main>
    </Flex>
  );
}
