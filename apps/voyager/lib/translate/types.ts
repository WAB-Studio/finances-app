// Which path answered a sentence, so the interface can say so (RL-09).
export type TranslationOrigin = "device" | "network";

export type TranslationResult = {
  text: string;
  origin: TranslationOrigin;
};
