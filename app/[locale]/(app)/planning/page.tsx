import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { PlanningHub } from "@/components/planning/planning-hub";
import { Page } from "@/components/ui";
import { listBudgetsWithStatus } from "@/db/queries/budgets";
import { getDebtsScreenData } from "@/db/queries/debts-screen";
import { getUserGroup } from "@/db/queries/groups";
import { listPlannedPayments } from "@/db/queries/planned-payments";
import { listRecurringRules } from "@/db/queries/recurring-rules";
import { listGoalsWithProgress } from "@/db/queries/savings-goals";
import { civilDateToDate } from "@/lib/dates";
import { centsToPesos } from "@/lib/money";
import { routing } from "@/i18n/routing";

export async function generateMetadata(
  props: PageProps<"/[locale]/planning">,
): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "planning" });

  return { title: t("title") };
}

export default async function PlanningPage(
  props: PageProps<"/[locale]/planning">,
) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  const [budgets, goals, payments, debts, rules, group, t, format] =
    await Promise.all([
      listBudgetsWithStatus(),
      listGoalsWithProgress(),
      listPlannedPayments({ status: "pending" }),
      getDebtsScreenData(),
      listRecurringRules(),
      getUserGroup(),
      getTranslations({ locale, namespace: "planning" }),
      getFormatter({ locale }),
    ]);

  // Every summary is derived here from the same reads the areas use; money is
  // formatted for display only, never re-stored, and cents stay integer.
  const spentCents = budgets.reduce((sum, b) => sum + b.spentCents, 0);
  const limitCents = budgets.reduce((sum, b) => sum + b.limitCents, 0);
  const budgetsSummary = t("budgetsSummary", {
    count: budgets.length,
    spent: format.number(centsToPesos(spentCents), "currency"),
    limit: format.number(centsToPesos(limitCents), "currency"),
  });

  const savedCents = goals.reduce((sum, g) => sum + g.savedCents, 0);
  const goalsSummary = t("goalsSummary", {
    count: goals.length,
    saved: format.number(centsToPesos(savedCents), "currency"),
  });

  // The list arrives soonest due first, so the head is the next pending payment.
  const soonest = payments[0];
  const paymentsSummary = soonest
    ? t("paymentsSummary", {
        concept: soonest.description ?? t("noConcept"),
        date: format.dateTime(civilDateToDate(soonest.dueDate), {
          day: "numeric",
          month: "short",
        }),
      })
    : t("paymentsEmpty");

  // Three states: no debts reads the empty line; a debt with a next payment names
  // its total and date; a debt without a due date names its total alone, since the
  // dated message cannot carry a missing date.
  const total = format.number(centsToPesos(debts.totals.owedCents), "currency");
  const hasDebts = debts.withTerms.length > 0 || debts.withoutTerms.length > 0;
  const debtsSummary = !hasDebts
    ? t("debtsEmpty")
    : debts.totals.nextPayment !== null
      ? t("debtsSummary", {
          total,
          date: format.dateTime(
            civilDateToDate(debts.totals.nextPayment.date),
            { day: "numeric", month: "short" },
          ),
        })
      : t("debtsSummaryNoDate", { total });

  // The list arrives soonest next run first, so the head names the nearest rule.
  const nextRule = rules[0];
  const recurringSummary = nextRule
    ? t("recurringSummary", {
        count: rules.length,
        concept: nextRule.description ?? t("noConcept"),
        date: format.dateTime(civilDateToDate(nextRule.nextRunOn), {
          day: "numeric",
          month: "short",
        }),
      })
    : t("recurringEmpty");

  return (
    <Page>
      <PlanningHub
        groupName={group?.name ?? null}
        budgetsSummary={budgetsSummary}
        goalsSummary={goalsSummary}
        paymentsSummary={paymentsSummary}
        debtsSummary={debtsSummary}
        recurringSummary={recurringSummary}
      />
    </Page>
  );
}
