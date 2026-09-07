import NextLink from "next/link";
import { useTranslations } from "next-intl";

import { Link, TapTarget, Text } from "@/components/ui";

// Under the box in every state, ready or not: the licence stays one tap away
// even mid-install or mid-failure (RL-15). Muted on the Text inside, never
// on the Link itself: Link has no muted variant to ask for.
export function SourceNote() {
  const t = useTranslations("source");

  return (
    <Link asChild size="2">
      <NextLink href="/fuente">
        <TapTarget align="center" gap="1">
          <Text size="2" muted>
            {t("open")}
          </Text>
        </TapTarget>
      </NextLink>
    </Link>
  );
}
