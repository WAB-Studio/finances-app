import NextLink from "next/link";
import { getTranslations } from "next-intl/server";

import { getReader } from "@/lib/session";
import { AccountPanel } from "@/components/account/account-panel";
import { AccountInfo } from "@/components/account/account-info";
import { Flex, Headword, Link, Page, Separator, TapTarget, Text } from "@/components/ui";

type InfoTab = "account" | "info";

function resolveTab(raw: string | string[] | undefined): InfoTab {
  return raw === "info" ? "info" : "account";
}

// `app/auth/confirm/route.ts` sends every invalid or expired link here,
// `?error=linkInvalid`, with no state of its own to carry the reason in.
function isLinkInvalid(raw: string | string[] | undefined): boolean {
  return (Array.isArray(raw) ? raw[0] : raw) === "linkInvalid";
}

// Server-rendered shell alone, like `/registro`: `getReader()` reads the
// verified claims with no round trip to Postgres, so a signed-out visit
// opens no connection at all — the panel below is the only thing that ever
// calls `/api/devices` or `/api/log/sync`, and only once a reader exists
// (RNL-09). No `useDictionary` here: this screen never resolves a word
// (RNL-08). `measure="full"`: Cuenta is a set of controls, not prose, so it
// takes the width it needs (docs/voyager/DESIGN.md "Viewport").
export default async function CuentaPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; error?: string | string[] }>;
}) {
  const t = await getTranslations("account");
  const tInfo = await getTranslations("account.info");
  const reader = await getReader();
  const { tab: rawTab, error: rawError } = await searchParams;
  const tab = resolveTab(rawTab);
  const linkInvalid = isLinkInvalid(rawError);

  return (
    <Page measure="full">
      <Flex direction="column" gap="5">
        <Headword>{t("title")}</Headword>

        {/* Two tabs, `?tab=` on the same route — the box's own `/?q=`
            pattern (search-screen.tsx), so the licence tab is a link, not a
            control, and reads the same signed out as signed in (RL-33). */}
        <Flex gap="5">
          <Link asChild underline="none">
            <NextLink href="/cuenta" aria-current={tab === "account" ? "page" : undefined}>
              <TapTarget>
                <Text size="2" weight={tab === "account" ? "bold" : undefined} muted={tab !== "account"}>
                  {tInfo("tabs.account")}
                </Text>
              </TapTarget>
            </NextLink>
          </Link>
          <Link asChild underline="none">
            <NextLink href="/cuenta?tab=info" aria-current={tab === "info" ? "page" : undefined}>
              <TapTarget>
                <Text size="2" weight={tab === "info" ? "bold" : undefined} muted={tab !== "info"}>
                  {tInfo("tabs.info")}
                </Text>
              </TapTarget>
            </NextLink>
          </Link>
        </Flex>

        {linkInvalid && tab === "account" && (
          // No red in this palette (docs/voyager/DESIGN.md "Failure"): a
          // hairline sets the break off, full-weight ink says it. No retry
          // button of its own — the email form right below is the retry.
          <Flex direction="column" gap="3" align="start">
            <Separator size="4" />
            <Text size="2" weight="bold">
              {t("errors.linkInvalid")}
            </Text>
          </Flex>
        )}

        {tab === "account" ? <AccountPanel readerEmail={reader?.email ?? null} /> : <AccountInfo />}
      </Flex>
    </Page>
  );
}
