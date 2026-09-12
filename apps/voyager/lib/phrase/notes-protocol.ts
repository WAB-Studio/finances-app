import { z } from "zod";

import { admitWord } from "@/lib/word/admit";

// Shared with the route handler and the check script, so the body a caller
// sends is exactly the body the handler accepts — one schema, not two
// hand-kept in sync. No `server-only` here: `admitWord` carries none either
// (docs/TRAPS.md, "server-only resolves under Next and nowhere else").

export const NOTES_ENDPOINT = "/api/phrase/notes";

export const notesRequestSchema = z.object({
  source: z.string().min(1).max(200),
  translation: z.string().min(1).max(200),
});
export type NotesRequest = z.infer<typeof notesRequestSchema>;

export const phraseNoteSchema = z.object({
  term: z.string().min(1).max(64),
  note: z.string().min(1).max(280),
});
export type PhraseNoteAnswer = z.infer<typeof phraseNoteSchema>;

export const notesResponseSchema = z.object({
  notes: z.array(phraseNoteSchema).max(3),
});
export type NotesResponse = z.infer<typeof notesResponseSchema>;

const MAX_CHARS = 200;
const MIN_TOKENS = 2;
const MAX_SOURCE_TOKENS = 12;

// Whitespace and `.,;:'"?!` both break a token — this is the one place a
// contraction or a quoted word costs the gate: "don't" splits into "don"
// and "t", and "t" never passes `admitWord`. A sentence, not a word list, is
// what this route is for, and the reader's own translation still fails it
// the same way a word list would.
const SEPARATOR = /[\s.,;:'"?!]+/;

export function tokenisePhrase(s: string): string[] {
  return s.split(SEPARATOR).filter(Boolean);
}

/**
 * The gate this route's first paragraph promises: a closed shape, never a
 * lookup, so nothing reaches the cache or the model that is not already a
 * short sentence of real words. Returns the source's own tokens on success
 * — the caller's one pass over them, reused for the hints below rather than
 * re-split — or `null` on any failure, in the order the contract lists.
 */
export function admitPhrase(source: string, translation: string): string[] | null {
  if (source.length > MAX_CHARS || translation.length > MAX_CHARS) return null;

  const sourceTokens = tokenisePhrase(source);
  const translationTokens = tokenisePhrase(translation);
  if (sourceTokens.length < MIN_TOKENS || translationTokens.length < MIN_TOKENS) return null;

  for (const token of sourceTokens) {
    if (admitWord(token) === null) return null;
  }

  if (/\d/.test(source) || /\d/.test(translation)) return null;
  if (sourceTokens.length > MAX_SOURCE_TOKENS) return null;

  return sourceTokens;
}
