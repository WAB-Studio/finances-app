import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";

import { CategoriesScreen } from "@/components/categories/categories-screen";
import { Flex } from "@/components/ui";
import {
  listCategories,
  listParentCategories,
  listUsedCategoryColors,
} from "@/db/queries/categories";
import { getFundForUser } from "@/db/queries/funds";
import { routing } from "@/i18n/routing";
import { CATEGORY_KINDS } from "@/lib/validation/category";

// Written out, not `PageProps<...>`: the route is new in this slot, and a
// stale `.next/types` from another slot would not know it yet.
type Params = Promise<{ locale: string; fundId: string }>;
type SearchParams = Promise<{ kind?: string | string[] }>;

// A mistyped tab is not a missing page: an unknown `kind` opens `expense`, not a 404.
function parseKind(value: string | string[] | undefined) {
  const result = z.enum(CATEGORY_KINDS).safeParse(value);
  return result.success ? result.data : "expense";
}

export async function generateMetadata(props: {
  params: Params;
}): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "categories" });

  return { title: t("title") };
}

export default async function CategoriesPage(props: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale, fundId } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  // An invalid uuid must never reach Postgres, which answers `22P02`.
  if (!z.uuid().safeParse(fundId).success) notFound();

  const fund = await getFundForUser(fundId);
  if (!fund) notFound();

  const { kind: kindParam } = await props.searchParams;
  const kind = parseKind(kindParam);

  // Both kinds count toward the default colour: it belongs to the fund, not the open tab.
  const [categories, parents, usedColors] = await Promise.all([
    listCategories(fundId, kind),
    listParentCategories(fundId, kind),
    listUsedCategoryColors(fundId),
  ]);

  return (
    <Flex asChild direction="column" flexGrow="1" p="6">
      <main>
        <CategoriesScreen
          fundId={fundId}
          kind={kind}
          categories={categories}
          parents={parents}
          usedColors={usedColors}
        />
      </main>
    </Flex>
  );
}
