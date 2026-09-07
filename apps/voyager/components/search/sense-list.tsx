import { useTranslations } from "next-intl";

import type { Sense } from "@/lib/dictionary/index-build";
import type { WordAnswer } from "@/lib/dictionary/lookup";
import { Flex, Headword, PosLabel, Separator, Text } from "@/components/ui";

// One sense: its part of speech, its IPA when the entry carries one, every
// translation on its own line, and its definition when the entry carries one.
// Never a card, never a border box (docs/voyager/DESIGN.md); the caller rules
// it against the next sense with a hairline instead.
function SenseCard({ sense, t }: { sense: Sense; t: ReturnType<typeof useTranslations> }) {
  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="2">
        <PosLabel>{t(`pos.${sense.pos}`)}</PosLabel>
        {sense.ipa !== null && (
          <Text size="2" color="gray">
            {sense.ipa}
          </Text>
        )}
      </Flex>
      <Flex direction="column" gap="1">
        <Text size="1" color="gray">
          {t("translations")}
        </Text>
        {sense.translations.map((translation) => (
          <Text variant="translation" key={translation}>
            {translation}
          </Text>
        ))}
      </Flex>
      {sense.definition !== null && (
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

// A group of senses ruled apart with a hairline, one per headword or
// inflected form.
function SenseGroup({
  senses,
  t,
}: {
  senses: readonly Sense[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Flex direction="column" gap="3">
      {senses.map((sense, index) => (
        <Flex direction="column" gap="3" key={index}>
          {index > 0 && <Separator size="4" />}
          <SenseCard sense={sense} t={t} />
        </Flex>
      ))}
    </Flex>
  );
}

// A headword's full answer: its own senses first, then every inflected form
// that reached one, each carrying its own senses in turn (RL-04, RL-06).
export function SenseList({ answer }: { answer: WordAnswer }) {
  const t = useTranslations("word");
  const tSearch = useTranslations("search");

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
          <Headword>{answer.exact.headword}</Headword>
          <SenseGroup senses={answer.exact.senses} t={t} />
        </Flex>
      )}

      {answer.viaInflection.map((hit) => (
        <Flex direction="column" gap="3" key={`${hit.surface}-${hit.lemma}`}>
          <Separator size="4" />
          <Text size="2" color="gray">
            {t("viaInflection", { surface: hit.surface, lemma: hit.lemma })}
          </Text>
          <SenseGroup senses={hit.group.senses} t={t} />
        </Flex>
      ))}
    </Flex>
  );
}
