// RL-28: a miss that is one edit away from a real headword gets offered back.
// Everything here runs on the query's own device — the worker thread that
// already holds `DictionaryIndex` — and touches no network.
import type { DictionaryIndex } from "./index-build";

// Letters only, plus the two marks a normalised headword can carry
// internally (`normaliseHeadword` in format.ts). Space is left out on
// purpose: a single mistyped word should never turn into an offer for a
// two-word headword like "give up" over one lucky insertion.
const ALPHABET = "abcdefghijklmnopqrstuvwxyz'-";

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
// sorted for a stable order on screen — empty only when there is none
// (`zzqqxv`). No cap: decided by the user 2026-09-11, against
// `docs/voyager/DESIGN.md`'s "One edit, no cap" — a real word the
// dictionary lacks (`fettle`) can sit one edit from several headwords at
// once and still surface all of them here; RL-29 is what tells that reader
// none of them is what they meant, not this function withholding the list.
export function suggestCorrection(index: DictionaryIndex, normalised: string): string[] {
  if (normalised.length < 2 || normalised.includes(" ")) return [];

  const hits: string[] = [];
  for (const candidate of editsAtDistanceOne(normalised)) {
    if (index.byHeadword.has(candidate)) hits.push(candidate);
  }
  return hits.sort();
}
