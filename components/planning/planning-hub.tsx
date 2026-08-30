import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  ChartColumnBig,
  ChevronRight,
  CreditCard,
  Repeat,
  Target,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card, Flex, FundChip, Heading, Text } from "@/components/ui";
import { Link as LocaleLink } from "@/i18n/navigation";

/**
 * The Planeación hub: one card per area, each carrying a live one-line summary
 * derived on the server and a link into its screen.
 */
export async function PlanningHub({
  groupName,
  budgetsSummary,
  goalsSummary,
  paymentsSummary,
  debtsSummary,
  recurringSummary,
}: {
  groupName: string | null;
  budgetsSummary: string;
  goalsSummary: string;
  paymentsSummary: string;
  debtsSummary: string;
  recurringSummary: string;
}) {
  const t = await getTranslations("planning");
  const tKey = await getTranslations();

  return (
    <Flex direction="column" gap="4">
      <Flex align="center" gap="2">
        <Heading size="6">{t("title")}</Heading>
        {groupName !== null && <FundChip label={tKey("fund.label")} />}
      </Flex>

      <Flex direction="column" gap="3">
        <HubCard
          icon={ChartColumnBig}
          tint="jade"
          title={t("budgetsTitle")}
          summary={budgetsSummary}
          href="/planning/budgets"
        />
        <HubCard
          icon={Target}
          tint="grass"
          title={t("goalsTitle")}
          summary={goalsSummary}
          href="/planning/goals"
        />
        <HubCard
          icon={CalendarDays}
          tint="amber"
          title={t("paymentsTitle")}
          summary={paymentsSummary}
          href="/planning/payments"
        />
        <HubCard
          icon={CreditCard}
          tint="indigo"
          title={t("debtsTitle")}
          summary={debtsSummary}
          href="/planning/debts"
        />
        <HubCard
          icon={Repeat}
          tint="violet"
          title={t("recurringTitle")}
          summary={recurringSummary}
          href="/planning/recurring"
        />
      </Flex>
    </Flex>
  );
}

// A row card: enabled when it names an href, muted with no chevron when it does
// not. The icon rides a soft tinted disc; the summary carries the derived line.
function HubCard({
  icon: Icon,
  tint,
  title,
  summary,
  href,
}: {
  icon: LucideIcon;
  tint: string;
  title: string;
  summary: string;
  href?: string;
}) {
  const body = (
    <Card>
      <Flex align="center" gap="3">
        <Flex
          align="center"
          justify="center"
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--radius-5)",
            background: href ? `var(--${tint}-a3)` : "var(--gray-a3)",
            color: href ? `var(--${tint}-11)` : "var(--gray-9)",
            flexShrink: 0,
          }}
        >
          <Icon size={21} />
        </Flex>
        <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
          <Text weight="bold" color={href ? undefined : "gray"} truncate>
            {title}
          </Text>
          <Text size="2" color="gray" truncate>
            {summary}
          </Text>
        </Flex>
        {href && <ChevronRight size={18} color="var(--gray-9)" />}
      </Flex>
    </Card>
  );

  if (!href) return body;

  return (
    <LocaleLink href={href} style={{ textDecoration: "none", color: "inherit" }}>
      {body}
    </LocaleLink>
  );
}
