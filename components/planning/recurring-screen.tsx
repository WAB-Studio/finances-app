"use client";

import { Info, Pencil, Plus, Repeat, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import {
  pauseRecurringRuleAction,
  resumeRecurringRuleAction,
} from "@/app/actions/recurring-rules";
import { RecurringFormDialog } from "@/components/planning/recurring-form-dialog";
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Flex,
  FundChip,
  Heading,
  IconButton,
  Switch,
  Text,
} from "@/components/ui";
import type { RecurringRuleRow } from "@/db/queries/recurring-rules";
import type { TransactionFormOptions } from "@/db/queries/transaction-form";
import { Link as LocaleLink } from "@/i18n/navigation";
import { civilDateToDate } from "@/lib/dates";
import { centsToPesos } from "@/lib/money";
import { useActionErrorToast } from "@/lib/use-action-toast";

/**
 * The recurring-rules area: every readable rule read as an "Auto" card, soonest
 * next run first (RF-29), each carrying a frequency + next-run subtitle. A rule's
 * switch pauses or resumes it in place (RF-32); a paused rule reads muted. The
 * amber banner counts the generated movements still awaiting review (RF-31) and
 * hides when none are. Money stays integer cents; the peso figure is display only.
 */
export function RecurringScreen({
  rules,
  unreviewedCount,
  options,
  hasGroup,
}: {
  rules: RecurringRuleRow[];
  unreviewedCount: number;
  options: TransactionFormOptions;
  hasGroup: boolean;
}) {
  const t = useTranslations("recurringRules");
  const tKey = useTranslations();

  // "new" and a row share one dialog instance; its own key resets the form.
  const [formTarget, setFormTarget] = useState<RecurringRuleRow | "new" | null>(
    null,
  );

  const addButton = (
    <Button type="button" onClick={() => setFormTarget("new")}>
      <Plus size={16} />
      {t("add")}
    </Button>
  );

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center" gap="3" wrap="wrap">
        <Flex align="center" gap="2">
          <Heading size="5">{t("title")}</Heading>
          {hasGroup && <FundChip label={tKey("fund.label")} />}
        </Flex>
        {addButton}
      </Flex>

      {/* Generated movements land marked automatic until confirmed (RF-31); the
          banner leads to the ledger to review them, and stays hidden at zero. */}
      {unreviewedCount > 0 && (
        <LocaleLink href="/movements" style={{ textDecoration: "none" }}>
          <Callout.Root color="amber" variant="soft">
            <Callout.Icon>
              <TriangleAlert size={16} aria-hidden />
            </Callout.Icon>
            <Callout.Text>
              {t("unreviewedBanner", { count: unreviewedCount })}
            </Callout.Text>
          </Callout.Root>
        </LocaleLink>
      )}

      {rules.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={addButton}
        />
      ) : (
        <Flex direction="column" gap="3">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onEdit={() => setFormTarget(rule)}
            />
          ))}
        </Flex>
      )}

      <Callout.Root color="jade" variant="soft">
        <Callout.Icon>
          <Info size={16} aria-hidden />
        </Callout.Icon>
        <Callout.Text>{t("autoHint")}</Callout.Text>
      </Callout.Root>

      <RecurringFormDialog
        open={formTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFormTarget(null);
        }}
        options={options}
        rule={formTarget === "new" ? undefined : (formTarget ?? undefined)}
      />
    </Flex>
  );
}

function RuleCard({
  rule,
  onEdit,
}: {
  rule: RecurringRuleRow;
  onEdit: () => void;
}) {
  const t = useTranslations("recurringRules");
  const tKey = useTranslations();
  const format = useFormatter();
  const onActionError = useActionErrorToast();

  // Two hooks, not one behind a ternary: rules of hooks forbid picking which one
  // to call, and pausing and resuming report their own toast.
  const pause = useAction(pauseRecurringRuleAction, {
    onSuccess() {
      toast.success(t("pausedToast"));
    },
    onError: onActionError,
  });
  const resume = useAction(resumeRecurringRuleAction, {
    onSuccess() {
      toast.success(t("resumedToast"));
    },
    onError: onActionError,
  });
  const isPending = pause.isPending || resume.isPending;

  function onToggle(active: boolean) {
    if (active) resume.execute({ id: rule.id });
    else pause.execute({ id: rule.id });
  }

  const nextLabel = format.dateTime(civilDateToDate(rule.nextRunOn), {
    day: "numeric",
    month: "short",
  });
  // "cada N" only surfaces when the interval spans more than one period.
  const subtitle =
    rule.intervalN > 1
      ? t(`subtitleEvery.${rule.frequency}`, {
          n: rule.intervalN,
          date: nextLabel,
        })
      : t(`subtitle.${rule.frequency}`, { date: nextLabel });

  // A destination-only rule is income, a source-only rule an expense (RF-29).
  const isIncome = rule.toAccountId !== null;

  return (
    <Card>
      <Flex
        align="center"
        gap="3"
        style={{ opacity: rule.isActive ? 1 : 0.55 }}
      >
        <Flex
          align="center"
          justify="center"
          flexShrink="0"
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            background: "var(--accent-a3)",
            color: "var(--accent-11)",
          }}
        >
          <Repeat size={19} />
        </Flex>
        <Flex direction="column" gap="1" flexGrow="1" minWidth="0">
          <Flex align="center" gap="2">
            <Text size="3" weight="medium" truncate>
              {rule.description ?? t("noConcept")}
            </Text>
            <Badge color="jade" variant="soft" radius="full">
              {t("autoBadge")}
            </Badge>
          </Flex>
          <Text size="2" color="gray" truncate>
            {subtitle}
          </Text>
        </Flex>
        <Text
          size="3"
          weight="medium"
          color={isIncome ? "grass" : undefined}
          style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
        >
          {format.number(centsToPesos(rule.amountCents), "currency")}
        </Text>
      </Flex>
      <Flex align="center" justify="end" gap="3" mt="3">
        <Flex align="center" gap="2">
          <Switch
            checked={rule.isActive}
            onCheckedChange={onToggle}
            disabled={isPending}
            aria-label={t("activeToggle")}
          />
          <Text size="2" color="gray">
            {rule.isActive ? t("stateActive") : t("statePaused")}
          </Text>
        </Flex>
        <IconButton
          type="button"
          variant="ghost"
          color="gray"
          onClick={onEdit}
          aria-label={tKey("common.edit")}
        >
          <Pencil size={16} />
        </IconButton>
      </Flex>
    </Card>
  );
}
