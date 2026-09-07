import { normaliseHeadword } from "@/lib/dictionary/format";

export type QueryKind =
  | { kind: "empty" }
  | { kind: "word"; text: string }
  | { kind: "phrase"; text: string; tokens: number };

// A phrase below this is still a phrase; the module that declines to
// translate it is the one that reads this number.
export const PHRASE_MIN_TOKENS = 3;

// A string above this is still a phrase; the module that refuses to send it
// over the network is the one that reads this number.
export const PHRASE_MAX_TOKENS = 60;

// The box takes a word or a sentence and never asks which (RL-02). The whole
// string is tried against the dictionary before it is ever counted in
// tokens, so a multi-word headword like "give up" answers as a word (RL-03).
export function classify(raw: string, isEntry: (normalised: string) => boolean): QueryKind {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text === "") {
    return { kind: "empty" };
  }
  if (isEntry(normaliseHeadword(text))) {
    return { kind: "word", text };
  }
  const tokens = text.split(" ").length;
  if (tokens > 1) {
    return { kind: "phrase", text, tokens };
  }
  return { kind: "word", text };
}
