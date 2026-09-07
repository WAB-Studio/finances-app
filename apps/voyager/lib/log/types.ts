// Persisted shape only. No IO here: `record.ts` owns the database.

export const LOOKUP_SCHEMA = 1;

export type LookupOutcome =
  | "exact" // the string was a headword
  | "inflected" // reached through a lemma candidate
  | "miss" // the dictionary carries nothing for it
  | "translated" // a sentence, answered
  | "untranslated"; // a sentence the translation failed on

export type LookupRecord = {
  id?: number; // autoIncrement, assigned by the store
  schema: typeof LOOKUP_SCHEMA; // on the row, not the database: rows outlive versions
  at: number; // Date.now(), epoch ms
  text: string; // as typed, trimmed and whitespace-collapsed, case preserved
  normalised: string; // normaliseHeadword(text) — the join key a deck is built on
  kind: "word" | "phrase";
  outcome: LookupOutcome;
  headword: string | null; // the headword actually reached; the lemma when inflected
  rule: string | null; // the InflectionRule value that reached it, as a plain string
  senses: number; // how many senses the group carried; 0 on a miss
  dictionaryReady: boolean; // was the dictionary installed when the query was typed
  origin: "device" | "network" | null; // a sentence only
};
