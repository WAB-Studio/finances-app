import { normaliseHeadword } from "./format";
import { groupFor, type DictionaryIndex, type SenseGroup } from "./index-build";
import { lemmaCandidates, type InflectionRule } from "./inflect";

export type InflectedHit = {
  surface: string;
  lemma: string;
  rule: InflectionRule;
  group: SenseGroup;
};

export type WordAnswer = {
  query: string;
  exact: SenseGroup | null;
  viaInflection: readonly InflectedHit[];
};

const MAX_INFLECTED_HITS = 3;

// The only one-letter normalised forms the dictionary means to answer: the
// indefinite article and the pronoun "I" (which normalises to "i"). Every
// other one-letter key in the index — "b", "p", "c", "e", "o", "s", "u",
// "x", "y", "4" — is an abbreviation's stripped period, a bare letter-name
// entry or a suffix list, not a headword a reader typing one key meant to
// reach.
const ANSWERABLE_SINGLE_CHAR_HEADWORDS: ReadonlySet<string> = new Set(["a", "i"]);

function isAnswerableHeadword(normalised: string): boolean {
  return normalised.length !== 1 || ANSWERABLE_SINGLE_CHAR_HEADWORDS.has(normalised);
}

// Stripping "-er"/"-r" off any word that ends that way, then checking the
// result is a headword, catches a noun or a pronoun whose stem happens to
// coincide with a real word: "her" -> "he", "beer" -> "be"/"bee", "baker"
// -> "bake" all pass that test despite naming no comparative at all. Only
// comparative and superlative run this second check, on the group already
// fetched for the exists test above, so it costs no further lookup: a
// grammatical category (adj) the group must carry for the guess to stand.
function isImplausible(rule: InflectionRule, group: SenseGroup): boolean {
  if (rule !== "comparative" && rule !== "superlative") return false;
  return !group.senses.some((sense) => sense.pos === "adj");
}

// The exact headword when the index carries it, and inflection candidates
// only when it does not. A word the dictionary already answers is answered,
// not guessed at: `bed` is its own entry, and the candidates it also
// matched were "a form of `b`" and "a form of `be`", one of them
// translating to "n.". Guessing is what a miss earns, never a hit.
export function lookupWord(index: DictionaryIndex, query: string): WordAnswer {
  const normalised = normaliseHeadword(query);
  if (normalised.length === 0) return { query, exact: null, viaInflection: [] };
  if (!isAnswerableHeadword(normalised)) return { query, exact: null, viaInflection: [] };

  const exact = groupFor(index, normalised);
  if (exact) return { query, exact, viaInflection: [] };

  const viaInflection: InflectedHit[] = [];
  for (const candidate of lemmaCandidates(query)) {
    if (candidate.lemma === normalised) continue;
    const group = groupFor(index, candidate.lemma);
    if (!group) continue;
    if (isImplausible(candidate.rule, group)) continue;
    viaInflection.push({ surface: normalised, lemma: candidate.lemma, rule: candidate.rule, group });
    if (viaInflection.length === MAX_INFLECTED_HITS) break;
  }

  return { query, exact, viaInflection };
}

// Lowest index whose entry is not less than target, so a prefix's matches
// sit in one contiguous run starting here.
function lowerBound(sorted: readonly string[], target: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function suggest(index: DictionaryIndex, prefix: string, limit: number): string[] {
  const normalised = normaliseHeadword(prefix);
  if (normalised.length === 0 || limit <= 0) return [];

  const { sortedHeadwords } = index;
  const results: string[] = [];
  for (let i = lowerBound(sortedHeadwords, normalised); i < sortedHeadwords.length && results.length < limit; i++) {
    const headword = sortedHeadwords[i];
    if (!headword.startsWith(normalised)) break;
    // A one-letter headword lookupWord no longer answers is not a suggestion
    // either: offering "b" only to have the reader tap it and see nothing
    // change is worse than one fewer item in the list.
    if (!isAnswerableHeadword(headword)) continue;
    results.push(headword);
  }
  return results;
}

export function hasEntry(index: DictionaryIndex, text: string): boolean {
  const answer = lookupWord(index, text);
  return answer.exact !== null || answer.viaInflection.length > 0;
}
