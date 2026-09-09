"use client";

import { useTranslations } from "next-intl";

import type { WordAnswer } from "@/lib/dictionary/lookup";
import { Flex, Headword, Separator, Spinner, Text } from "@/components/ui";
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

function hasHit(answer: WordAnswer | null): answer is WordAnswer {
  return answer !== null && (answer.exact !== null || answer.viaInflection.length > 0);
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
        <Headword>{part.token}</Headword>
        <Text size="3">{t("noEntry.wordMiss")}</Text>
      </Flex>
    );
  }
  return <SenseList answer={part.answer} variant="compact" />;
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
  const remaining = state.parts.length - shown.length;
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
          <Text size="2" muted>
            {t("noEntry.more", { count: remaining })}
          </Text>
        </Flex>
      )}
    </Flex>
  );
}
