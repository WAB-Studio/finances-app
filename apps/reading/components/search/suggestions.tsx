import { useTranslations } from "next-intl";

import { Button, Flex, TapTarget, VisuallyHidden } from "@/components/ui";

// Headwords that begin with the string being typed, offered while it is
// still being treated as a word (RL-05). Silent when there is nothing to
// offer, so an empty prefix never leaves a hollow list on the screen.
export function Suggestions({
  items,
  onPick,
}: {
  items: readonly string[];
  onPick: (headword: string) => void;
}) {
  const t = useTranslations("word");

  if (items.length === 0) return null;

  return (
    <Flex direction="column" gap="1">
      <VisuallyHidden>{t("suggestions")}</VisuallyHidden>
      {items.map((item) => (
        <TapTarget key={item} width="100%">
          <Button variant="ghost" tap onClick={() => onPick(item)}>
            {item}
          </Button>
        </TapTarget>
      ))}
    </Flex>
  );
}
