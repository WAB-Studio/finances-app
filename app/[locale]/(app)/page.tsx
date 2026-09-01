import { Wallet } from "lucide-react";
import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { notFound } from "next/navigation";

import { WithdrawCashCard } from "@/components/cash/withdraw-dialog";
import { DashboardSummary } from "@/components/reports/dashboard-summary";
import { QuickEntryPill } from "@/components/transactions/quick-entry-pill";
import {
  Button,
  Card,
  CategoryTile,
  EmptyState,
  Flex,
  Heading,
  Link,
  MovementRow,
  Page,
  TapTarget,
} from "@/components/ui";
import { resolveWithdrawalTarget } from "@/db/queries/cash";
import { getUserGroup } from "@/db/queries/groups";
import { getDashboardData } from "@/db/queries/reports/dashboard";
import { getTransactionFormOptions } from "@/db/queries/transaction-form";
import { listTransactions } from "@/db/queries/transactions";
import type { TransactionListRow } from "@/db/queries/transactions";
import { requireUser } from "@/db/session";
import { Link as LocaleLink } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { PERSONAL_CASH_ACCOUNT_NAME } from "@/lib/fund/seed";
import { centsToPesos } from "@/lib/money";

export async function generateMetadata(
  props: PageProps<"/[locale]">,
): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const group = await getUserGroup();
  if (group) return { title: group.name };

  const t = await getTranslations({ locale, namespace: "common" });
  return { title: t("appName") };
}

// A transfer carries neither category nor sign; an income and an expense read
// their first split's category and lean on the kind word only when none is set.
type KindLabels = { transfer: string; income: string; expense: string };

// The signed-in landing. A user may run personal-only (RF-55), so an absent
// group is expected, not a redirect to create one. With no account yet the
// create-first-account guide stands (FLOWS §9); once an account exists the screen
// leads with the per-owner net-worth and month summary (RF-88, RF-67; per-account
// balances stay off the dashboard) over the quick-entry pill and the three most
// recent lines (RF-23).
export default async function HomePage(props: PageProps<"/[locale]">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  // requireUser stays the auth guard. The form options carry the account and
  // category names a row reads for its title and subtitle, the same pairing the
  // movements list fans out (RF-23); the amount is formatted for display only.
  const [, group, dashboardData, rows, options, withdrawal, t, td, format] =
    await Promise.all([
      requireUser(),
      getUserGroup(),
      getDashboardData(),
      listTransactions({}, { limit: 3 }),
      getTransactionFormOptions(),
      resolveWithdrawalTarget(),
      getTranslations("transactions"),
      getTranslations("dashboard"),
      getFormatter(),
    ]);

  if (dashboardData.hasAccounts === false) {
    return (
      <Page>
        <EmptyState
          icon={<Wallet size={44} strokeWidth={1.6} />}
          title={td("emptyTitle")}
          description={td("emptyDescription")}
          action={
            <Flex direction="column" align="center" gap="3" mt="2">
              <Button asChild size="3">
                <LocaleLink href="/settings/accounts">
                  {td("createAccount")}
                </LocaleLink>
              </Button>
              {!group && (
                <Link asChild>
                  <LocaleLink href="/onboarding">
                    <TapTarget align="center" justify="center" px="2">
                      {td("createFund")}
                    </TapTarget>
                  </LocaleLink>
                </Link>
              )}
            </Flex>
          }
        />
      </Page>
    );
  }

  // A name and colour per account and per category id — children included — so a
  // row reads its title, subtitle and tile without a second lookup.
  const accountNames = new Map(options.accounts.map((a) => [a.id, a.name]));
  const categoryNames = new Map<string, string>();
  const categoryColors = new Map<string, string | null>();
  for (const category of options.categories) {
    categoryNames.set(category.id, category.name);
    categoryColors.set(category.id, category.color);
    for (const child of category.children) {
      categoryNames.set(child.id, child.name);
      categoryColors.set(child.id, child.color);
    }
  }

  const kindLabels: KindLabels = {
    transfer: t("kindTransfer"),
    income: t("kindIncome"),
    expense: t("kindExpense"),
  };

  // The withdrawal's destination read-only: the caller's resolved cash by name,
  // or the personal cash create-on-demand will open when they have none (RF-68).
  const willCreateCash = withdrawal.reason === "no-cash-account";
  const withdrawDestinationName =
    (withdrawal.targetCashAccountId &&
      accountNames.get(withdrawal.targetCashAccountId)) ||
    PERSONAL_CASH_ACCOUNT_NAME[locale];

  return (
    <Page>
      <Flex direction="column" gap="4">
        <DashboardSummary data={dashboardData} />

        <QuickEntryPill />

        <WithdrawCashCard
          sources={withdrawal.sourceAccounts}
          destinationName={withdrawDestinationName}
          willCreate={willCreateCash}
        />

        <Flex justify="between" align="baseline" gap="3">
          <Heading as="h2" size="4">{t("listTitle")}</Heading>
          <Link asChild size="2" weight="medium">
            <LocaleLink href="/movements">{t("seeAll")}</LocaleLink>
          </Link>
        </Flex>

        <Flex direction="column" gap="2">
          {rows.map((row) => (
            <Card key={row.id} asChild>
              <LocaleLink href={`/movements/${row.id}`}>
                <MovementRow
                  tile={<CategoryTile color={rowColor(row, categoryColors)} />}
                  title={rowTitle(row, categoryNames, kindLabels)}
                  subtitle={rowSubtitle(row, accountNames)}
                  amount={rowAmount(row, format)}
                  tone={rowTone(row)}
                />
              </LocaleLink>
            </Card>
          ))}
        </Flex>
      </Flex>
    </Page>
  );
}

// A transfer names no category, so its title is the fixed kind word; an income or
// expense reads its first split's category (RF-19).
function rowTitle(
  row: TransactionListRow,
  categoryNames: Map<string, string>,
  kindLabels: KindLabels,
): string {
  if (row.kind === "transfer") return kindLabels.transfer;
  const first = row.splits[0]?.categoryId;
  const fallback = row.kind === "income" ? kindLabels.income : kindLabels.expense;
  return (first && categoryNames.get(first)) || fallback;
}

// A transfer reads "origin → destination"; an income names its destination, an
// expense its source.
function rowSubtitle(
  row: TransactionListRow,
  accountNames: Map<string, string>,
): string | undefined {
  if (row.kind === "transfer") {
    const from = (row.fromAccountId && accountNames.get(row.fromAccountId)) ?? "";
    const to = (row.toAccountId && accountNames.get(row.toAccountId)) ?? "";
    return `${from} → ${to}`;
  }
  const accountId = row.kind === "income" ? row.toAccountId : row.fromAccountId;
  return (accountId && accountNames.get(accountId)) ?? undefined;
}

function rowColor(
  row: TransactionListRow,
  categoryColors: Map<string, string | null>,
): string | null {
  if (row.kind === "transfer") return null;
  const first = row.splits[0]?.categoryId;
  return (first && categoryColors.get(first)) ?? null;
}

// Income reads with a leading +, expense with a −, a transfer with neither; the
// figure is the peso view of the stored cents, formatted for display only.
function rowAmount(
  row: TransactionListRow,
  format: Awaited<ReturnType<typeof getFormatter>>,
): string {
  const sign = row.kind === "income" ? "+" : row.kind === "expense" ? "−" : "";
  return `${sign}${format.number(centsToPesos(row.amountCents), "currency")}`;
}

function rowTone(row: TransactionListRow): "income" | "expense" | "transfer" {
  if (row.kind === "income") return "income";
  if (row.kind === "transfer") return "transfer";
  return "expense";
}
