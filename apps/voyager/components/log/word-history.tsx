"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";

import { readWordHistory, type WordHistoryRow } from "@/lib/log/summary";
import type { LookupOutcome } from "@/lib/log/types";
import {
  Button,
  Flex,
  Grid,
  Headword,
  Link,
  MetaLabel,
  Separator,
  Skeleton,
  TapTarget,
  Text,
} from "@/components/ui";

// The other half of RL-32: one word's own searches, read off the same
// `normalised` index `HistoryList` groups by (RNL-08 — no `lib/dictionary`
// import, no Worker mounted here either).

type ViewState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; rows: WordHistoryRow[]; total: number }
  | { kind: "failed" };

type OutcomeKey = "exact" | "inflected" | "translated" | "miss";

// Mirrors `history-list.tsx`'s own fold: `untranslated` reads the same as
// `miss` to a reader, neither found an answer.
function outcomeKey(outcome: LookupOutcome): OutcomeKey {
  return outcome === "untranslated" ? "miss" : outcome;
}

function BackLink({ label }: { label: string }) {
  return (
    <Link asChild underline="none">
      <NextLink href="/registro">
        <TapTarget align="center">← {label}</TapTarget>
      </NextLink>
    </Link>
  );
}

function WordHistorySkeleton() {
  const t = useTranslations("log");
  return (
    <Flex direction="column" gap="5">
      <Skeleton>
        <Text size="2">← {t("word.back")}</Text>
      </Skeleton>
      <Flex direction="column" gap="2">
        <Skeleton>
          <Headword>{t("word.skeletonHeadword")}</Headword>
        </Skeleton>
        <Skeleton>
          <Text size="2">{t("word.skeletonSubtitle")}</Text>
        </Skeleton>
      </Flex>
      <Flex direction="column" gap="3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index}>
            <Text size="2">{t("word.skeletonDate")}</Text>
          </Skeleton>
        ))}
      </Flex>
    </Flex>
  );
}

export function WordHistory({ normalised }: { normalised: string }) {
  const t = useTranslations("log");
  const format = useFormatter();
  const router = useRouter();
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  // Bumped by the failed state's own retry, since the read runs in an
  // effect and a click cannot call it directly.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    readWordHistory(normalised)
      .then(({ rows, total }) => {
        if (cancelled) return;
        setState(rows.length === 0 ? { kind: "empty" } : { kind: "ready", rows, total });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [normalised, attempt]);

  if (state.kind === "loading") {
    return <WordHistorySkeleton />;
  }

  if (state.kind === "empty") {
    // Reachable only by a hand-typed URL for a word never searched — the
    // study's own empty copy already says exactly that (module 7's
    // `RegistroEstudioEstados`), so this reuses it rather than adding a
    // second pair of strings for the same idea.
    return (
      <Flex direction="column" gap="5">
        <BackLink label={t("word.back")} />
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
      </Flex>
    );
  }

  if (state.kind === "failed") {
    // No red in this palette (docs/voyager/DESIGN.md "Failure"): a hairline
    // sets the break off, full-weight ink says it, the accent lives in
    // retry — the same treatment `history-list.tsx` gives its own failure.
    return (
      <Flex direction="column" gap="5">
        <BackLink label={t("word.back")} />
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
      </Flex>
    );
  }

  const latest = state.rows[0];
  const earliest = state.rows[state.rows.length - 1];

  return (
    <Flex direction="column" gap="5">
      <BackLink label={t("word.back")} />

      <Flex direction="column" gap="1">
        <Headword>{latest.text}</Headword>
        <Text size="2" muted>
          {t("word.subtitle", {
            translation: latest.translation ?? "",
            count: state.total,
            date: format.dateTime(new Date(earliest.at), { dateStyle: "medium" }),
          })}
        </Text>
      </Flex>

      <Separator size="4" />

      <Flex direction="column" gap="3">
        {state.rows.map((row, index) => (
          <Flex direction="column" gap="3" key={`${row.at}-${index}`}>
            {index > 0 && <Separator size="4" />}
            <Grid columns="1fr auto" gap="3" align="center">
              <Text size="2" muted>
                {format.dateTime(new Date(row.at), { dateStyle: "medium" })}
              </Text>
              <MetaLabel>{t(`outcome.${outcomeKey(row.outcome)}`)}</MetaLabel>
            </Grid>
          </Flex>
        ))}
      </Flex>
    </Flex>
  );
}
