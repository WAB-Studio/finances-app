"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";

import { readWordHistory, type WordHistoryRow } from "@/lib/log/summary";
import type { LookupOutcome } from "@/lib/log/types";
import { useDictionary } from "@/lib/dictionary/use-dictionary";
import type { WordAnswer } from "@/lib/dictionary/lookup";
import { InstallStatus } from "@/components/search/install-status";
import { SenseList } from "@/components/search/sense-list";
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
// `normalised` index `HistoryList` groups by. The reader came here to see
// again what the search box showed them, so this mounts the same
// dictionary `SenseList` draws for `/?q=` — its own Worker, its own lookup,
// keyed on the segment's own `normalised` rather than on a box this screen
// never has.

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
  const { status: dictionaryStatus, lookup, retry: retryDictionary } = useDictionary();
  // Set once the Worker answers, however long that takes — `dictionaryStatus`
  // is what the render below reads meanwhile.
  const [answer, setAnswer] = useState<WordAnswer | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    lookup(normalised)
      .then((result) => {
        if (!cancelled) setAnswer(result);
      })
      .catch(() => {
        // Only reachable in the instant before this hook's own mount
        // effect builds its Worker. A lookup issued after a failed install
        // sits queued instead — no rejection, nothing to show here beyond
        // what `InstallStatus`'s own failed branch already says.
      });
    return () => {
      cancelled = true;
    };
  }, [normalised, lookup]);

  if (state.kind === "loading") {
    return <WordHistorySkeleton />;
  }

  if (state.kind === "empty") {
    // Reachable by a hand-typed URL, or a stale link, for a word this
    // record never held — not the same thing as an empty record
    // (`study.empty*`, `RegistroEstudioEstados`): the reader may have
    // searched plenty, just never this one (`PalabraHistorialVacio`).
    // The headword stays up top as it does in the full state below.
    return (
      <Flex direction="column" gap="5">
        <BackLink label={t("word.back")} />
        <Headword>{normalised}</Headword>
        <Separator size="4" />
        <Flex direction="column" gap="3" align="start">
          <Text size="2" muted>
            {t("word.emptyBody", { word: normalised })}
          </Text>
          <Button size="2" tap onClick={() => router.push(`/?q=${encodeURIComponent(normalised)}`)}>
            {t("word.emptyAction")}
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
  // Every row for one `normalised` shares its `kind` — it is fixed at
  // write time by what the reader typed, not by any one search's outcome.
  const isPhrase = latest.kind === "phrase";
  // Most recent search that actually reached a translation: a later retry
  // that failed must not blank out an answer an earlier one already stored.
  const phraseTranslation = isPhrase
    ? (state.rows.find((row) => row.translation !== null)?.translation ?? null)
    : null;

  return (
    <Flex direction="column" gap="5">
      <BackLink label={t("word.back")} />

      <Flex direction="column" gap="1">
        <Headword>{latest.text}</Headword>
        <Text size="2" muted>
          {t("word.subtitle", {
            count: state.total,
            date: format.dateTime(new Date(earliest.at), { dateStyle: "medium" }),
          })}
        </Text>
      </Flex>

      <Separator size="4" />

      {/* RL-34: a sentence's own answer is the translation already stored
          on its rows, never a dictionary lookup — `he holds a grudge
          against me` is never a headword and asking the Worker for one
          only reproduces the "no tiene esa palabra" miss the record never
          had. The reason the reader opened this screen on a word stays the
          same answer the box gave them, `showExactHeadword` off since the
          heading above already names this word. */}
      {isPhrase ? (
        phraseTranslation !== null ? (
          <Text variant="translation">{phraseTranslation}</Text>
        ) : (
          <Text size="2" muted>
            {t("word.phraseMissing")}
          </Text>
        )
      ) : dictionaryStatus.state !== "ready" ? (
        <InstallStatus status={dictionaryStatus} onRetry={retryDictionary} query="" hasBox={false} />
      ) : answer ? (
        <SenseList answer={answer} showExactHeadword={false} />
      ) : (
        <Skeleton>
          <Text size="2">{t("word.skeletonAnswer")}</Text>
        </Skeleton>
      )}

      <Separator size="4" />

      {/* Every past search, kept below the answer rather than above it or
          folded away: the answer is why the reader tapped this word, the
          count and dates in the line above already answer "how many, since
          when" for a reader who stops there, and this list stays a plain
          scroll rather than a second tap for the reader who wants every
          date. Each one now carries its own time, not only its own day —
          `dateStyle` alone read identically across a same-day run and told
          the reader nothing the count above had not already said. */}
      <Flex direction="column" gap="3">
        {state.rows.map((row, index) => (
          <Flex direction="column" gap="3" key={`${row.at}-${index}`}>
            {index > 0 && <Separator size="4" />}
            <Grid columns="1fr auto" gap="3" align="center">
              <Text size="2" muted>
                {format.dateTime(new Date(row.at), { dateStyle: "medium", timeStyle: "short" })}
              </Text>
              <MetaLabel>{t(`outcome.${outcomeKey(row.outcome)}`)}</MetaLabel>
            </Grid>
          </Flex>
        ))}
      </Flex>
    </Flex>
  );
}
