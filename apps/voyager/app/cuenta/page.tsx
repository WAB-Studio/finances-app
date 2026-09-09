import NextLink from "next/link";
import { getTranslations } from "next-intl/server";

import { getReader } from "@/lib/session";
import { AccountPanel } from "@/components/account/account-panel";
import { Flex, Headword, Link, Page, TapTarget } from "@/components/ui";

// Server-rendered shell alone, like `/registro`: `getReader()` reads the
// verified claims with no round trip to Postgres, so a signed-out visit
// opens no connection at all — the panel below is the only thing that ever
// calls `/api/devices` or `/api/log/sync`, and only once a reader exists
// (RNL-09). No `useDictionary` here: this screen never resolves a word
// (RNL-08). `measure="full"`: Cuenta is a set of controls, not prose, so it
// takes the width it needs (docs/voyager/DESIGN.md "Viewport").
export default async function CuentaPage() {
  const t = await getTranslations("account");
  const reader = await getReader();

  return (
    <Page measure="full">
      <Flex direction="column" gap="5">
        <Headword>{t("title")}</Headword>

        <AccountPanel readerEmail={reader?.email ?? null} />

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
