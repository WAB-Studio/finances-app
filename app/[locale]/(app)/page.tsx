import { Banknote, CreditCard, Landmark, Plus, Wallet } from "lucide-react";
import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { notFound } from "next/navigation";

import { WithdrawCashCard } from "@/components/cash/withdraw-dialog";
import { WithdrawPanel } from "@/components/cash/withdraw-panel";
import { DashboardSummary } from "@/components/reports/dashboard-summary";
import {
  RecentMovements,
  rowColor,
  rowSubtitle,
  rowTitle,
  rowTone,
  type KindLabels,
} from "@/components/reports/recent-movements";
import { QuickEntryPill } from "@/components/transactions/quick-entry-pill";
import {
  Box,
  Button,
  Card,
  CategoryTile,
  EmptyState,
  Flex,
  Heading,
  Link,
  MovementRow,
  Page,
  ScreenHeader,
  TapTarget,
  Text,
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

// The three classes an account opens as, each its own tile in the first-account
// guide. The names are the accounts screen's own (RF-56 names the cash one), and
// the key rides the query the accounts screen opens its form from.
// The desktop list runs the eight rows of the Inicio artboard; the phone's cards
// keep the three it has always shown.
const RECENT_LIMIT = 8;
const PHONE_RECENT_LIMIT = 3;

const ACCOUNT_KINDS = [
  { key: "bancaria", label: "subtypeBancaria", surface: "var(--blue-3)", ink: "var(--blue-11)" },
  { key: "efectivo", label: "subtypeEfectivo", surface: "var(--jade-3)", ink: "var(--jade-11)" },
  { key: "tarjeta", label: "subtypeTarjeta", surface: "var(--violet-3)", ink: "var(--violet-11)" },
] as const;

// The signed-in landing. A user may run personal-only (RF-55), so an absent
// group is expected, not a redirect to create one. With no account yet the
// create-first-account guide stands (FLOWS §9); once an account exists the screen
// leads with the per-owner net-worth and month summary (RF-88, RF-67; per-account
// balances stay off the dashboard) over the quick-entry pill and the most recent
// lines (RF-23).
//
// The summary re-flows into its two cards from `md` up; everything under it is a
// pair — the phone's cards and the desktop's panel and rows — of which exactly
// one is displayed at any width.
export default async function HomePage(props: PageProps<"/[locale]">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  // requireUser stays the auth guard. The form options carry the account and
  // category names a row reads for its title and subtitle, the same pairing the
  // movements list fans out (RF-23); the amount is formatted for display only.
  const [, group, dashboardData, rows, options, withdrawal, t, td, ta, format] =
    await Promise.all([
      requireUser(),
      getUserGroup(),
      getDashboardData(),
      listTransactions({}, { limit: RECENT_LIMIT }),
      getTransactionFormOptions(),
      resolveWithdrawalTarget(),
      getTranslations("transactions"),
      getTranslations("dashboard"),
      getTranslations("accounts"),
      getFormatter(),
    ]);

  if (dashboardData.hasAccounts === false) {
    return (
      <Page gutter="flush">
        <Box display={{ initial: "none", md: "block" }}>
          <ScreenHeader title={td("title")} />
        </Box>

        <Flex
          display={{ initial: "flex", md: "none" }}
          direction="column"
          flexGrow="1"
        >
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
        </Flex>

        {/* One tile per account class, each a way into the accounts screen: the
            guide of the InicioVacio artboard. */}
        <Flex
          display={{ initial: "none", md: "flex" }}
          direction="column"
          flexGrow="1"
          align="center"
          justify="center"
          gap="6"
          px="6"
        >
          <Flex direction="column" align="center" gap="4">
            <CategoryTile
              color="var(--accent-3)"
              size={62}
              icon={<Wallet size={29} strokeWidth={1.8} color="var(--accent-11)" />}
            />
            <Heading size="7">{td("firstAccountTitle")}</Heading>
          </Flex>

          <Flex align="stretch" justify="center" gap="4" wrap="wrap">
            {ACCOUNT_KINDS.map((kind) => (
              <Card key={kind.key} asChild>
                <LocaleLink
                  href={`/settings/accounts?new=${kind.key}`}
                  style={{ width: 240, textDecoration: "none", color: "inherit" }}
                >
                  <Flex direction="column" align="center" gap="3">
                    <CategoryTile
                      color={kind.surface}
                      size={46}
                      icon={<AccountKindIcon kind={kind.key} color={kind.ink} />}
                    />
                    <Text size="3" weight="medium">
                      {ta(kind.label)}
                    </Text>
                    <Flex align="center" gap="1">
                      <Plus size={14} strokeWidth={2.4} color="var(--accent-11)" />
                      <Text size="2" weight="medium" color="jade">
                        {td("addAccountKind")}
                      </Text>
                    </Flex>
                  </Flex>
                </LocaleLink>
              </Card>
            ))}
          </Flex>

          {!group && (
            <Link asChild size="2" weight="medium">
              <LocaleLink href="/onboarding">{td("createFund")}</LocaleLink>
            </Link>
          )}
        </Flex>
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
    <Page gutter="flush">
      <Box display={{ initial: "none", md: "block" }}>
        <ScreenHeader title={td("title")} />
      </Box>

      <Flex direction="column" gap="4">
        <DashboardSummary
          data={dashboardData}
          cash={
            <WithdrawPanel
              sources={withdrawal.sourceAccounts}
              destinationName={withdrawDestinationName}
              willCreate={willCreateCash}
            />
          }
        />

        <Box display={{ initial: "block", md: "none" }}>
          <Flex direction="column" gap="4">
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
              {rows.slice(0, PHONE_RECENT_LIMIT).map((row) => (
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
        </Box>

        <Box display={{ initial: "none", md: "block" }} px="6">
          <RecentMovements
            rows={rows}
            kindLabels={kindLabels}
            accountNames={accountNames}
            categoryNames={categoryNames}
            categoryColors={categoryColors}
          />
        </Box>
      </Flex>
    </Page>
  );
}

// The glyph of one account class, drawn at the size the guide's tile holds.
function AccountKindIcon({
  kind,
  color,
}: {
  kind: (typeof ACCOUNT_KINDS)[number]["key"];
  color: string;
}) {
  if (kind === "bancaria") return <Landmark size={22} strokeWidth={1.8} color={color} />;
  if (kind === "efectivo") return <Banknote size={22} strokeWidth={1.8} color={color} />;
  return <CreditCard size={22} strokeWidth={1.8} color={color} />;
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
