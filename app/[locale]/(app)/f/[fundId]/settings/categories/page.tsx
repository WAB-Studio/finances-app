import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";

import { CategoriesScreen } from "@/components/categories/categories-screen";
import { Page } from "@/components/ui";
import {
  listCategories,
  listParentCategories,
  listUsedCategoryColors,
} from "@/db/queries/categories";
import { getFundForUser } from "@/db/queries/funds";
import { routing } from "@/i18n/routing";
import { CATEGORY_KINDS } from "@/lib/validation/category";

// A mistyped tab is not a missing page: an unknown `kind` opens `expense`, not a 404.
function parseKind(value: string | string[] | undefined) {
  const result = z.enum(CATEGORY_KINDS).safeParse(value);
  return result.success ? result.data : "expense";
}

export async function generateMetadata(
  props: PageProps<"/[locale]/f/[fundId]/settings/categories">,
): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "categories" });

  return { title: t("title") };
}

export default async function CategoriesPage(
  props: PageProps<"/[locale]/f/[fundId]/settings/categories">,
) {
  const { locale, fundId } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  // An invalid uuid must never reach Postgres, which answers `22P02`.
  if (!z.uuid().safeParse(fundId).success) notFound();

  const { kind: kindParam } = await props.searchParams;
  const kind = parseKind(kindParam);

  // The fund check rides along instead of gating: the policies filter the rows
  // below anyway, so a fund the user cannot see comes back empty and then 404s.
  // Both kinds count toward the default colour: it belongs to the fund, not the open tab.
  const [fund, categories, parents, usedColors] = await Promise.all([
    getFundForUser(fundId),
    listCategories(fundId, kind),
    listParentCategories(fundId, kind),
    listUsedCategoryColors(fundId),
  ]);
  if (!fund) notFound();

  return (
    <Page>
      <CategoriesScreen
        fundId={fundId}
        kind={kind}
        categories={categories}
        parents={parents}
        usedColors={usedColors}
      />
    </Page>
  );
}
