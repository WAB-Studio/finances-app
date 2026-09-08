import { normaliseHeadword, type DictionaryPayload, type PartOfSpeech, type RawEntry } from "./format";

export type Sense = {
  pos: PartOfSpeech;
  ipa: string | null;
  translations: readonly string[];
  definition: string | null;
};

export type SenseGroup = { headword: string; senses: readonly Sense[] };

// Opaque to callers: reach it only through buildIndex, groupFor, lookupWord
// and suggest. byHeadword and sortedHeadwords answer a lookup and a prefix
// search without ever re-scanning the entries array.
export type DictionaryIndex = {
  readonly entries: readonly RawEntry[];
  readonly byHeadword: Map<string, number[]>;
  readonly sortedHeadwords: string[];
};

// v before n before adj before adv before pn before phraseologicalUnit, so
// "leave" shows its verb before its noun.
const POS_RANK: Record<PartOfSpeech, number> = {
  v: 0,
  n: 1,
  adj: 2,
  adv: 3,
  pn: 4,
  phraseologicalUnit: 5,
};

function senseFromEntry(entry: RawEntry): Sense {
  const [, pos, ipa, translations, definition] = entry;
  return { pos, ipa, translations, definition };
}

export function buildIndex(payload: DictionaryPayload): DictionaryIndex {
  const entries = payload.entries;
  const byHeadword = new Map<string, number[]>();

  entries.forEach((entry, offset) => {
    const key = normaliseHeadword(entry[0]);
    const offsets = byHeadword.get(key);
    if (offsets) offsets.push(offset);
    else byHeadword.set(key, [offset]);
  });

  const sortedHeadwords = Array.from(byHeadword.keys()).sort();

  return { entries, byHeadword, sortedHeadwords };
}

// A headword is a group of senses, never a row: every entry sharing a
// normalised headword answers together, ordered by part of speech.
export function groupFor(index: DictionaryIndex, normalisedHeadword: string): SenseGroup | null {
  const offsets = index.byHeadword.get(normalisedHeadword);
  if (!offsets) return null;
  const senses = offsets
    .map((offset) => senseFromEntry(index.entries[offset]))
    .sort((a, b) => POS_RANK[a.pos] - POS_RANK[b.pos]);
  return { headword: normalisedHeadword, senses };
}
