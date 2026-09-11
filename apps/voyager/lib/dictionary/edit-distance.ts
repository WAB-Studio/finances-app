// RL-28: a miss that is one edit away from a real headword gets offered back.
// Everything here runs on the query's own device — the worker thread that
// already holds `DictionaryIndex` — and touches no network.
import type { DictionaryIndex } from "./index-build";

// Letters only, plus the two marks a normalised headword can carry
// internally (`normaliseHeadword` in format.ts). Space is left out on
// purpose: a single mistyped word should never turn into an offer for a
// two-word headword like "give up" over one lucky insertion.
const ALPHABET = "abcdefghijklmnopqrstuvwxyz'-";

// More than this many headwords sit one edit from the query and the offer
// stops meaning anything: `fettle` sits one substitution from `kettle`,
// `mettle`, `nettle` and `settle` alike, and showing all four hands the
// reader four guesses with the same confident face as `receive` gets for
// `recieve`'s one guess. Measured against a 1,939-word synthetic sample
// (`private/reportes/sugerir-errata.md`): capping here still shows the
// right word for 93.7% of one-edit misses, and only ever withholds it —
// never shows the wrong one instead.
const MAX_CANDIDATES = 3;

// Every string one delete, one transposition, one substitution or one
// insertion away from `word` — the classic four-operation edit-1 set,
// generated once per miss rather than compared word-by-word against the
// dictionary's ~59,000 headwords.
function editsAtDistanceOne(word: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i <= word.length; i++) {
    const left = word.slice(0, i);
    const right = word.slice(i);
    if (right.length > 0) out.add(left + right.slice(1)); // delete
    if (right.length > 1) out.add(left + right[1] + right[0] + right.slice(2)); // transpose
    if (right.length > 0) {
      for (const letter of ALPHABET) out.add(left + letter + right.slice(1)); // substitute
    }
    for (const letter of ALPHABET) out.add(left + letter + right); // insert
  }
  out.delete(word);
  return out;
}

// Every headword one edit from `normalised` that the index actually has,
// sorted for a stable order on screen — empty when there are none
// (`zzqqxv`) or when there are too many to mean anything (`fettle`).
export function suggestCorrection(index: DictionaryIndex, normalised: string): string[] {
  if (normalised.length < 2 || normalised.includes(" ")) return [];

  const hits: string[] = [];
  for (const candidate of editsAtDistanceOne(normalised)) {
    if (index.byHeadword.has(candidate)) hits.push(candidate);
  }
  if (hits.length === 0 || hits.length > MAX_CANDIDATES) return [];
  return hits.sort();
}
