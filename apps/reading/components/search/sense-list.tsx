import { useTranslations } from "next-intl";

import type { Sense } from "@/lib/dictionary/index-build";
import type { WordAnswer } from "@/lib/dictionary/lookup";
import { Badge, Card, Flex, Heading, Separator, Text } from "@/components/ui";

// One sense: its part of speech, its IPA when the entry carries one, every
// translation on its own line, and its definition when the entry carries one.
function SenseCard({ sense, t }: { sense: Sense; t: ReturnType<typeof useTranslations> }) {
  return (
    <Card>
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2">
          <Badge>{t(`pos.${sense.pos}`)}</Badge>
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
            <Text size="3" key={translation}>
              {translation}
            </Text>
          ))}
        </Flex>
        {sense.definition !== null && (
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">
              {t("definition")}
            </Text>
            <Text size="2">{sense.definition}</Text>
          </Flex>
        )}
      </Flex>
    </Card>
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
          <Heading size="5">{answer.exact.headword}</Heading>
          {answer.exact.senses.map((sense, index) => (
            <SenseCard sense={sense} t={t} key={index} />
          ))}
        </Flex>
      )}

      {answer.viaInflection.map((hit) => (
        <Flex direction="column" gap="3" key={`${hit.surface}-${hit.lemma}`}>
          <Separator size="4" />
          <Text size="2" color="gray">
            {t("viaInflection", { surface: hit.surface, lemma: hit.lemma })}
          </Text>
          {hit.group.senses.map((sense, index) => (
            <SenseCard sense={sense} t={t} key={index} />
          ))}
        </Flex>
      ))}
    </Flex>
  );
}
