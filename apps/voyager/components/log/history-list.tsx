"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { useTranslations } from "next-intl";

import { readHistoryPage, type HistoryCursor, type HistoryRow } from "@/lib/log/history";
import type { LookupOutcome } from "@/lib/log/types";
import { Button, Flex, Grid, Link, MetaLabel, Separator, Spinner, TapTarget, Text } from "@/components/ui";

// Reachable through `useEffect` alone (module 25's own store, IndexedDB),
// never through `lib/dictionary` or `lib/sync` — this screen answers RNL-08
// with no import, not with a check.

type ListState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; rows: HistoryRow[]; next: HistoryCursor | null; loadingMore: boolean }
  | { kind: "failed" };

type OutcomeKey = "exact" | "inflected" | "translated" | "miss";

// Five outcomes, four labels: `miss` and `untranslated` read the same to a
// reader — neither found an answer — so both take `log.outcome.miss`
// (docs/voyager/DESIGN.md "Metadata labels").
function outcomeKey(outcome: LookupOutcome): OutcomeKey {
  return outcome === "untranslated" ? "miss" : outcome;
}

function HistoryRowItem({ row, t }: { row: HistoryRow; t: ReturnType<typeof useTranslations> }) {
  return (
    <Flex direction="column" gap="1">
      {/* `1fr auto`: the label's own width is fixed, so the track beside it
          is what has to clamp — Grid's `minmax(0, 1fr)` governs it where a
          Flex sibling's `flex-shrink: 0` would not (docs/voyager/DESIGN.md
          "What the data forces"). */}
      <Grid columns="1fr auto" gap="3" align="center">
        <Text serif truncate>
          {row.text}
        </Text>
        <MetaLabel>{t(`outcome.${outcomeKey(row.outcome)}`)}</MetaLabel>
      </Grid>
      {row.translation !== null && (
        <Grid>
          <Text variant="translation" truncate>
            {row.translation}
          </Text>
        </Grid>
      )}
    </Flex>
  );
}

export function HistoryList() {
  const t = useTranslations("log");
  const [state, setState] = useState<ListState>({ kind: "loading" });
  // Bumped by the failed state's own retry, since `readHistoryPage` runs in
  // an effect and a click cannot call it directly.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    readHistoryPage(null)
      .then((page) => {
        if (cancelled) return;
        setState(
          page.rows.length === 0
            ? { kind: "empty" }
            : { kind: "ready", rows: page.rows, next: page.next, loadingMore: false },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function handleMore(): Promise<void> {
    if (state.kind !== "ready" || state.next === null || state.loadingMore) return;
    const cursor = state.next;
    setState({ ...state, loadingMore: true });
    try {
      const page = await readHistoryPage(cursor);
      setState((current) =>
        current.kind === "ready"
          ? { kind: "ready", rows: [...current.rows, ...page.rows], next: page.next, loadingMore: false }
          : current,
      );
    } catch {
      setState((current) => (current.kind === "ready" ? { ...current, loadingMore: false } : current));
    }
  }

  if (state.kind === "loading") {
    return (
      <Flex align="center" justify="center" p="4">
        <Spinner size="3" />
      </Flex>
    );
  }

  if (state.kind === "empty") {
    return (
      <Flex direction="column" gap="3" align="start">
        <Text size="2" muted>
          {t("empty")}
        </Text>
        <Link asChild>
          <NextLink href="/">
            <TapTarget align="center" justify="center" px="2">
              {t("emptyAction")}
            </TapTarget>
          </NextLink>
        </Link>
      </Flex>
    );
  }

  if (state.kind === "failed") {
    // No red in this palette (docs/voyager/DESIGN.md "Failure"): a hairline
    // sets the break off, full-weight ink says it, the accent lives in
    // retry — the same treatment as install-status.tsx and phrase-answer.tsx.
    return (
      <Flex direction="column" gap="3" align="start">
        <Separator size="4" />
        <Text size="2" weight="bold">
          {t("listFailed")}
        </Text>
        <Button
          size="2"
          tap
          onClick={() => {
            setState({ kind: "loading" });
            setAttempt((current) => current + 1);
          }}
        >
          {t("retry")}
        </Button>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="3">
        {state.rows.map((row, index) => (
          <Flex direction="column" gap="3" key={row.id}>
            {index > 0 && <Separator size="4" />}
            <HistoryRowItem row={row} t={t} />
          </Flex>
        ))}
      </Flex>

      {/* A control the reader presses, never a scroll listener: 10,003 rows
          with no virtualisation is the defect a page-at-a-time avoids. */}
      {state.next !== null && (
        <Button size="2" tap onClick={() => void handleMore()} disabled={state.loadingMore}>
          {state.loadingMore ? <Spinner /> : t("more")}
        </Button>
      )}
    </Flex>
  );
}
