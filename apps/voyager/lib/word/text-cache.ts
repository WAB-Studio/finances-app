import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { WordText } from "@/lib/word/protocol";

type CachedRow = { definition: string | null; example_en: string; example_es: string };

/** The one round trip the hot path pays. A miss returns `null`, never throws. */
export async function readCachedText(headword: string): Promise<WordText | null> {
  const [row] = await db.execute<CachedRow>(sql`
    select definition, example_en, example_es
    from reading.word_texts
    where headword = ${headword}
  `);
  if (!row) return null;
  return { definition: row.definition, example: { en: row.example_en, es: row.example_es } };
}

/**
 * Written once, on an accepted model answer alone — a failure leaves no row,
 * so the daily cap is what bounds a word that keeps failing, never a bad
 * row on disk. `on conflict do nothing`: two cold readers racing the same
 * headword both pay the call (no lock added, the same trade module 4 makes
 * for photos), and whichever insert lands first is the one every later
 * reader sees.
 */
export async function writeCachedText(
  headword: string,
  model: string,
  definition: string | null,
  exampleEn: string,
  exampleEs: string,
): Promise<void> {
  await db.execute(sql`
    insert into reading.word_texts (headword, definition, example_en, example_es, model)
    values (${headword}, ${definition}, ${exampleEn}, ${exampleEs}, ${model})
    on conflict (headword) do nothing
  `);
}
