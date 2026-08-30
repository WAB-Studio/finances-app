import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { MovementDetail } from "@/components/transactions/movement-detail";
import { Page } from "@/components/ui";
import {
  getTransactionFormOptions,
  resolveCreatorNames,
} from "@/db/queries/transaction-form";
import { getTransactionById } from "@/db/queries/transactions";
import { routing } from "@/i18n/routing";

export async function generateMetadata(
  props: PageProps<"/[locale]/movements/[id]">,
): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "transactions" });

  return { title: t("detailTitle") };
}

export default async function MovementPage(
  props: PageProps<"/[locale]/movements/[id]">,
) {
  const { locale, id } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  // The read is scoped by RLS, so a movement the caller may not see returns null;
  // the form options ride the same fan-out for the edit dialog and the
  // account/category names the detail reads.
  const [movement, options] = await Promise.all([
    getTransactionById(id),
    getTransactionFormOptions(),
  ]);

  if (!movement) notFound();

  // The creator's id names the row; the map turns it into a member's name (an
  // archived member included) or, only for the caller's own id, their email.
  const creatorNames = await resolveCreatorNames([movement.createdBy]);

  return (
    <Page>
      <MovementDetail
        movement={movement}
        options={options}
        creatorName={creatorNames.get(movement.createdBy) ?? null}
      />
    </Page>
  );
}
