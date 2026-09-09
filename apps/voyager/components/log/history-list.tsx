"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { readWordStudy, type StudyRow } from "@/lib/log/summary";
import { countRecords } from "@/lib/log/record";
import { Box, Button, Flex, Grid, Link, MetaLabel, Separator, Skeleton, TapTarget, Text } from "@/components/ui";

// Reachable through `useEffect` alone (module 25's own store, IndexedDB),
// never through `lib/dictionary` or `lib/sync` — this screen answers RNL-08
// with no import, not with a check.

type ListState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; rows: StudyRow[]; totalLookups: number; totalWords: number }
  | { kind: "failed" };

function StudyRowItem({ row }: { row: StudyRow }) {
  return (
    <Link asChild underline="none">
      <NextLink href={`/registro/${encodeURIComponent(row.normalised)}`}>
        <TapTarget size={44} direction="column" align="stretch" width="100%">
          {/* `minmax(0, 1fr) auto` on the phone stacks the translation under
              the word; the desktop's third track puts word, translation and
              count on one row (RL-32's board). `gridColumn`/`gridRow` move
              each cell between the two shapes. The `minmax(0, …)` is
              written out, not left to Radix's own `columns` shorthand:
              `grid.props.js`'s `parseValue` only rewrites a bare digit
              count into `repeat(n, minmax(0, 1fr))` — a literal string like
              `"1fr auto"` passes through unchanged, so a `1fr` track alone
              never gets a zero floor.

              A truncated word still needs a second guard past that: CSS
              blockifies a grid item's own display, but not a *grandchild*
              that only sits inside a plain `Box`, so `Text truncate` stayed
              `display: inline` — where `overflow: hidden` does not clip —
              and rendered at its full, un-clamped width regardless of the
              column underneath it. Making the wrapper a `Flex` (a
              container of its own) blockifies the `Text` it holds exactly
              the way module 3's original code had it as the grid item
              directly (docs/voyager/DESIGN.md "What the data forces"). */}
          <Grid
            columns={{ initial: "minmax(0, 1fr) auto", md: "minmax(0, 1fr) minmax(0, 1fr) auto" }}
            gap="3"
            align="center"
          >
            <Flex gridColumn="1" gridRow="1" minWidth="0" overflow="hidden">
              <Text serif truncate>
                {row.display}
              </Text>
            </Flex>
            {row.lastTranslation !== null && (
              <Flex
                gridColumn={{ initial: "1", md: "2" }}
                gridRow={{ initial: "2", md: "1" }}
                minWidth="0"
                overflow="hidden"
              >
                <Text variant="translation" muted truncate>
                  {row.lastTranslation}
                </Text>
              </Flex>
            )}
            <Box gridColumn={{ initial: "2", md: "3" }} gridRow="1" justifySelf="end">
              <MetaLabel>{row.count}</MetaLabel>
            </Box>
          </Grid>
        </TapTarget>
      </NextLink>
    </Link>
  );
}

function StudySkeleton() {
  const t = useTranslations("log");
  return (
    <Flex direction="column" gap="4">
      {Array.from({ length: 4 }, (_, index) => (
        <Flex direction="column" gap="2" key={index}>
          <Skeleton>
            <Text size="5" serif>
              {t("study.skeletonWord")}
            </Text>
          </Skeleton>
          <Skeleton>
            <Text variant="translation">{t("study.skeletonTranslation")}</Text>
          </Skeleton>
        </Flex>
      ))}
    </Flex>
  );
}

export function HistoryList() {
  const t = useTranslations("log");
  const router = useRouter();
  const [state, setState] = useState<ListState>({ kind: "loading" });
  // Bumped by the failed state's own retry, since the read runs in an
  // effect and a click cannot call it directly.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([readWordStudy(), countRecords()])
      .then(([study, totalLookups]) => {
        if (cancelled) return;
        setState(
          study.rows.length === 0
            ? { kind: "empty" }
            : { kind: "ready", rows: study.rows, totalLookups, totalWords: study.total },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.kind === "loading") {
    return <StudySkeleton />;
  }

  if (state.kind === "empty") {
    return (
      <Flex direction="column" gap="3" align="start">
        <Text size="4" weight="bold">
          {t("study.emptyTitle")}
        </Text>
        <Text size="2" muted>
          {t("study.emptyBody")}
        </Text>
        <Button size="2" tap onClick={() => router.push("/")}>
          {t("study.emptyAction")}
        </Button>
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
          {t("study.failedTitle")}
        </Text>
        <Text size="2" muted>
          {t("study.failedBody")}
        </Text>
        <Button
          size="2"
          tap
          onClick={() => {
            setState({ kind: "loading" });
            setAttempt((current) => current + 1);
          }}
        >
          {t("study.failedAction")}
        </Button>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="5">
      <Text size="2" muted>
        {t("study.header", { lookups: state.totalLookups, words: state.totalWords })}
      </Text>

      <Flex direction="column" gap="3">
        {state.rows.map((row, index) => (
          <Flex direction="column" gap="3" key={row.normalised}>
            {index > 0 && <Separator size="4" />}
            <StudyRowItem row={row} />
          </Flex>
        ))}
      </Flex>
    </Flex>
  );
}
