"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import type { Sense } from "@/lib/dictionary/index-build";
import type { WordAnswer } from "@/lib/dictionary/lookup";
import { speak, speechSupported } from "@/lib/speech/speak";
import { Flex, Grid, Headword, IconButton, PosLabel, Separator, Text } from "@/components/ui";

// The glyph docs/voyager/DESIGN.md "Settled" fixes exactly: a play triangle
// and two sound arcs, 1.75px strokes, round caps and joins. Drawn here
// rather than pulled from lucide because the path itself is what the board
// settles, not a stand-in for "speaker".
function SpeakerGlyph() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 8.5a5 5 0 010 7" />
      <path d="M19.5 6a8.5 8.5 0 010 12" />
    </svg>
  );
}

// `speechSupported()` never changes within one page life, so there is
// nothing to subscribe to — only a snapshot to read, which is what tells
// `useSyncExternalStore` to skip the effect-driven setState this needs to
// stay SSR-safe: false on the server (no `window`), the real answer once
// the client itself renders.
function subscribeNever(): () => void {
  return () => {};
}

function getServerSnapshot(): boolean {
  return false;
}

// RL-26: a headword can be heard. Asked of the browser fresh on every open —
// never inferred from its name or version — so a browser with no
// `speechSynthesis` shows no control at all, rather than one that does
// nothing when pressed.
function SpeakButton({ headword, t }: { headword: string; t: ReturnType<typeof useTranslations> }) {
  const supported = useSyncExternalStore(subscribeNever, speechSupported, getServerSnapshot);

  if (!supported) return null;

  return (
    <IconButton
      type="button"
      size="2"
      variant="ghost"
      color="gray"
      tap={44}
      aria-label={t("listen", { headword })}
      onClick={() => speak(headword)}
    >
      <SpeakerGlyph />
    </IconButton>
  );
}

// One sense's own body: every translation on its own line, its definition
// when the entry carries one, and its own IPA only when it differs from the
// one already drawn on its segment's label row — repeating an identical IPA
// on every sense would say nothing a reader does not already have.
// `compact` drops the IPA and the definition (docs/voyager/DESIGN.md
// "A word block on `SinEntradaFrase` carries its translations alone"):
// only `NoEntryAnswer`'s per-word breakdown ever sets it.
function SenseDetail({
  sense,
  segmentIpa,
  compact,
  t,
}: {
  sense: Sense;
  segmentIpa: string | null;
  compact: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const ownIpa = !compact && sense.ipa !== null && sense.ipa !== segmentIpa ? sense.ipa : null;

  return (
    <Flex direction="column" gap="2">
      <Flex direction="column" gap="1">
        {ownIpa !== null && (
          <Text size="2" color="gray" truncate>
            {ownIpa}
          </Text>
        )}
        <Text size="1" color="gray">
          {t("translations")}
        </Text>
        {sense.translations.map((translation) => (
          <Text variant="translation" key={translation}>
            {translation}
          </Text>
        ))}
      </Flex>
      {!compact && sense.definition !== null && (
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            {t("definition")}
          </Text>
          <Text size="2" serif>
            {sense.definition}
          </Text>
        </Flex>
      )}
    </Flex>
  );
}

// A contiguous run of same-part-of-speech senses: one `PosLabel`, one IPA
// taken from the run's first sense, and every sense's own body ruled apart
// with a hairline. Never a card, never a border box (docs/voyager/DESIGN.md).
function PosSegment({
  segment,
  compact,
  t,
}: {
  segment: SenseSegment;
  compact: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const segmentIpa = segment.senses[0].ipa;

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" gap="2">
        <PosLabel>{t(`pos.${segment.pos}`)}</PosLabel>
        {!compact && segmentIpa !== null && (
          // IPA runs past 120 characters with no space to break on, and it is
          // metadata beside the headword, not the headword itself — one
          // clamped line reads better than four wrapped ones. `PosLabel` has
          // no intrinsic width limit of its own, so the row's flex-shrink
          // alone would starve it too; the clamp has to come from `Grid`,
          // whose `minmax(0, 1fr)` governs the item regardless
          // (docs/voyager/DESIGN.md "What the data forces").
          <Grid flexGrow="1" minWidth="0">
            <Text size="2" color="gray" align="right" truncate>
              {segmentIpa}
            </Text>
          </Grid>
        )}
      </Flex>
      {segment.senses.map((sense, index) => (
        <Flex direction="column" gap="3" key={index}>
          {index > 0 && <Separator size="4" />}
          <SenseDetail sense={sense} segmentIpa={segmentIpa} compact={compact} t={t} />
        </Flex>
      ))}
    </Flex>
  );
}

type SenseSegment = { pos: Sense["pos"]; senses: Sense[] };

// `groupFor` (lib/dictionary/index-build.ts) already sorts senses by
// POS_RANK, so every sense of one part of speech arrives contiguous: this
// only draws its label once instead of once per sense (RL-04).
function segmentByPos(senses: readonly Sense[]): SenseSegment[] {
  const segments: SenseSegment[] = [];
  for (const sense of senses) {
    const open = segments.at(-1);
    if (open !== undefined && open.pos === sense.pos) open.senses.push(sense);
    else segments.push({ pos: sense.pos, senses: [sense] });
  }
  return segments;
}

// A group of part-of-speech segments ruled apart with a hairline, one per
// headword or inflected form.
function SenseGroup({
  senses,
  compact,
  t,
}: {
  senses: readonly Sense[];
  compact: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const segments = segmentByPos(senses);

  return (
    <Flex direction="column" gap="3">
      {segments.map((segment, index) => (
        <Flex direction="column" gap="3" key={index}>
          {index > 0 && <Separator size="4" />}
          <PosSegment segment={segment} compact={compact} t={t} />
        </Flex>
      ))}
    </Flex>
  );
}

// `full` is a direct lookup's own answer — IPA, definition, voice, the lot.
// `compact` is a word block inside the no-entry breakdown
// (`no-entry-answer.tsx`): headword, category and translations alone
// (docs/voyager/DESIGN.md "A word block on `SinEntradaFrase` carries its
// translations alone"), and no voice control — that belongs to the word
// screen's own four boards, never to the breakdown (docs/voyager/DESIGN.md
// "RL-26").
export type SenseListVariant = "full" | "compact";

// A headword's full answer: its own senses first, then every inflected form
// that reached one, each carrying its own senses in turn (RL-04, RL-06).
export function SenseList({
  answer,
  variant = "full",
}: {
  answer: WordAnswer;
  variant?: SenseListVariant;
}) {
  const t = useTranslations("word");
  const tSearch = useTranslations("search");
  const compact = variant === "compact";

  const hasAnswer = answer.exact !== null || answer.viaInflection.length > 0;
  if (!hasAnswer) {
    return (
      <Flex direction="column" gap="1">
        <Text size="3">{tSearch("notFound")}</Text>
        <Text size="2" color="gray">
          {tSearch("notFoundHint")}
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="4">
      {answer.exact !== null && (
        <Flex direction="column" gap="3">
          <Flex align="center" gap="1">
            <Headword>{answer.exact.headword}</Headword>
            {!compact && <SpeakButton headword={answer.exact.headword} t={t} />}
          </Flex>
          <SenseGroup senses={answer.exact.senses} compact={compact} t={t} />
        </Flex>
      )}

      {answer.viaInflection.map((hit) => (
        <Flex direction="column" gap="3" key={`${hit.surface}-${hit.lemma}`}>
          <Separator size="4" />
          {/* "Lead with the English headword" (docs/voyager/DESIGN.md "The
              direction: Impreso") holds for a lemma reached through an
              inflection too — the form line explains it, it does not replace
              it. */}
          <Flex direction="column" gap="1">
            <Headword>{hit.lemma}</Headword>
            <Text size="1" color="gray">
              {t("viaInflection", { surface: hit.surface, lemma: hit.lemma })}
            </Text>
          </Flex>
          <SenseGroup senses={hit.group.senses} compact={compact} t={t} />
        </Flex>
      ))}
    </Flex>
  );
}
