import NextLink from "next/link";
import { useTranslations } from "next-intl";

import { Link, TapTarget } from "@/components/ui";

// Under the box in every state, ready or not: the licence stays one tap away
// even mid-install or mid-failure (RL-15).
export function SourceNote() {
  const t = useTranslations("source");

  return (
    <Link asChild size="2" color="gray">
      <NextLink href="/fuente">
        <TapTarget align="center" gap="1">
          {t("open")}
        </TapTarget>
      </NextLink>
    </Link>
  );
}
