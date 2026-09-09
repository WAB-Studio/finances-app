"use client";

import NextLink from "next/link";
import { useTranslations } from "next-intl";

import type { WordAnswer } from "@/lib/dictionary/lookup";
import { Flex, Headword, Link, Separator, Spinner, TapTarget, Text } from "@/components/ui";
import { SenseList } from "./sense-list";

export type NoEntryPart = { token: string; answer: WordAnswer | null };

// RL-31's miss and RL-37's translation failure draw the same blocks below
// the title; only the title names which one happened, so both carry a reason.
export type NoEntryReason = "noEntry" | "translationFailed";

export type NoEntryState =
  | { kind: "words"; query: string; parts: NoEntryPart[]; reason: NoEntryReason }
  | { kind: "tooLong"; query: string; tokens: number }
  | { kind: "resolving"; query: string };

// Sixty answers are not an answer, and eight is already a lot to read on a
// bus: the rest folds into one line (docs/voyager/DESIGN.md "Settled").
const MAX_BLOCKS = 8;

// `search-screen.tsx`'s own query name: every door this screen opens is
// `/?q=<word>`.
const QUERY_PARAM = "q";

function wordHref(token: string): string {
  return `/?${QUERY_PARAM}=${encodeURIComponent(token)}`;
}

function hasHit(answer: WordAnswer | null): answer is WordAnswer {
  return answer !== null && (answer.exact !== null || answer.viaInflection.length > 0);
}

// docs/voyager/DESIGN.md "Viewport": stroke-width 1.75, round caps and
// joins, fill none — `sense-list.tsx` draws the same shape for its own
// headword's door; this file has no import onto that one to share it.
function ChevronGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// A single word's block: SenseList's own headword and senses when the
// dictionary has one, its own heading and its own line — never SenseList's
// generic "not found" copy — when it does not, so the reader reads "tampoco"
// under the word that hit it and not a second "no tiene esa palabra" that
// already answered the phrase above it. The block that carries the
// breakdown's answer draws `compact`: translations alone, no IPA, no
// definition, no voice control (docs/voyager/DESIGN.md "A word block on
// `SinEntradaFrase` carries its translations alone").
function NoEntryWord({ part, t }: { part: NoEntryPart; t: ReturnType<typeof useTranslations> }) {
  if (!hasHit(part.answer)) {
    return (
      <Flex direction="column" gap="3">
        <Link asChild underline="always">
          <NextLink href={wordHref(part.token)}>
            <TapTarget align="center" gap="1">
              <Headword>{part.token}</Headword>
              <ChevronGlyph />
            </TapTarget>
          </NextLink>
        </Link>
        <Text size="3">{t("noEntry.wordMiss")}</Text>
      </Flex>
    );
  }
  return <SenseList answer={part.answer} variant="compact" wordHref={wordHref(part.token)} />;
}

// RL-31: the screen a typed word or a short phrase used to leave blank.
// Every branch draws something — that silence is the defect this replaces.
export function NoEntryAnswer({ state }: { state: NoEntryState }) {
  const t = useTranslations("search");

  if (state.kind === "resolving") {
    return (
      <Flex align="center" gap="2">
        <Spinner />
        <Text size="2" muted>
          {t("noEntry.resolving")}
        </Text>
      </Flex>
    );
  }

  if (state.kind === "tooLong") {
    return <Text size="3">{t("noEntry.tooLong", { count: state.tokens })}</Text>;
  }

  const shown = state.parts.slice(0, MAX_BLOCKS);
  const cut = state.parts.slice(MAX_BLOCKS);
  const remaining = cut.length;
  const titleKey = state.reason === "translationFailed" ? "noEntry.titleTranslationFailed" : "noEntry.title";

  return (
    <Flex direction="column" gap="4">
      <Text size="3">{t(titleKey, { query: state.query })}</Text>

      {shown.map((part, index) => (
        <Flex direction="column" gap="3" key={`${part.token}-${index}`}>
          {index > 0 && <Separator size="4" />}
          <NoEntryWord part={part} t={t} />
        </Flex>
      ))}

      {remaining > 0 && (
        <Flex direction="column" gap="3">
          <Separator size="4" />
          {/* Names every cut word, matching `SinEntradaFraseEnlaces`: the
              line wraps on a narrow phone rather than overflow it, checked
              against `docs/voyager/DESIGN.md`'s own 52-word worst case
              (`PHRASE_MAX_TOKENS` minus `MAX_BLOCKS`). One door, to the
              first of them — the same order the blocks above already read
              in. */}
          <Link asChild underline="always">
            <NextLink href={wordHref(cut[0].token)}>
              <TapTarget align="center" gap="1">
                <Text size="2">{t("noEntry.more", { count: remaining, words: cut.map((part) => part.token).join(", ") })}</Text>
                <ChevronGlyph />
              </TapTarget>
            </NextLink>
          </Link>
        </Flex>
      )}
    </Flex>
  );
}
