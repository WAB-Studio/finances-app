// The stable key `ingest_counterparties` (Module 5, RF-135) learns an account
// against — a normalised span of a statement-row description, not an SMS. Kept
// out of `lib/ingest/fingerprint.ts` on purpose: that file's mask feeds a shape
// hash with its own stability clause, for a different source. It is pure: no
// DB, no async, no side effect.

// A token carrying a digit is an amount, a date or a reference tail — masked
// whole. A token of only letters is kept, case folded: it is a word of the
// pattern, whether it opens the description (`RECARGA`) or names who or what
// is on the other side (`RUSHBET`). Consequence: a trailing named span is
// never masked away. `RECARGA DESDE` (no name yet) and `RECARGA DESDE: RUSHBET`
// (a name) must stay two keys — folding them into one would let a single
// RUSHBET payout teach the pattern for every unrelated `RECARGA DESDE` row,
// marking two dozen legitimate rows ambiguous for good.
const HAS_DIGIT = /\d/;

const NOT_WORD_CHARACTER = /[^\p{L}\p{N}]+/gu;

const MASK = "#";

export function counterpartyPatternKey(description: string): string {
  const parts: string[] = [];

  for (const rawToken of description.trim().split(/\s+/)) {
    const token = rawToken.replace(NOT_WORD_CHARACTER, "");
    if (token.length === 0) {
      continue;
    }

    if (HAS_DIGIT.test(token)) {
      // Adjacent masked tokens collapse into one, so a two-digit reference and
      // an eight-digit account tail reach the same key.
      if (parts[parts.length - 1] !== MASK) {
        parts.push(MASK);
      }
      continue;
    }

    parts.push(token.toLowerCase());
  }

  return parts.join(" ");
}
