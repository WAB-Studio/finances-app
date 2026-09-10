"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { readCredits, type Credit } from "@/lib/word/credits-store";
import { Flex, Link, MetaLabel, Separator, Text } from "@/components/ui";

/**
 * `CuentaInformacionFotosOscuroMovil`: one row per image already shown, most
 * recent first — the per-file credit CC BY-SA's redistribution clause
 * requires. Reads its own IndexedDB in an effect; no session, no `fetch`.
 */
export function PhotoCredits() {
  const t = useTranslations("account.info");
  // `null` until the effect resolves: neither the rows nor the empty line
  // draws before then, since the board names no third state for this list.
  const [credits, setCredits] = useState<Credit[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readCredits().then((rows) => {
      if (!cancelled) setCredits(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Separator size="4" />

      <Flex direction="column" gap="1">
        <MetaLabel>{t("photosLabel")}</MetaLabel>
        <Text size="2" as="p">
          {t("photosIntro")}
        </Text>

        {credits?.length === 0 && (
          <Text size="2" muted>
            {t("photosEmpty")}
          </Text>
        )}

        {credits?.map((credit) => {
          // The route's own enum (`by`, `by-sa`, `cc0`, `pdm`) names no
          // licence a reader would recognise; `photoLicence` is the map
          // that turns the code into "CC BY-SA".
          const licenceName = t(`photoLicence.${credit.licence}`);
          const licenceLink = (chunks: ReactNode) => (
            <Link href={credit.licenceUrl} target="_blank" rel="noreferrer">
              {chunks}
            </Link>
          );
          const hasAuthor = credit.author.trim().length > 0;

          return (
            <Flex key={credit.headword} direction="column" gap="1">
              <Link href={credit.sourceUrl} target="_blank" rel="noreferrer">
                <Text size="2">{t("photoLink", { headword: credit.headword })}</Text>
              </Link>
              <Text size="2" muted>
                {hasAuthor
                  ? t.rich("photoAttribution", { author: credit.author, licence: licenceName, licenceLink })
                  : t.rich("photoAttributionNoAuthor", { licence: licenceName, licenceLink })}
              </Text>
            </Flex>
          );
        })}
      </Flex>
    </>
  );
}
