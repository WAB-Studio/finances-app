import { text, timestamp } from "drizzle-orm/pg-core";

import { reading } from "./_schema";

// One row per headword RL-29's route has ever answered for: a word the
// dictionary carries no entry for at all, never one `word_texts` already
// reaches. Only an accepted model answer lands here, same as `word_texts` —
// a bad day never blocks a retry. Not a reader's record — RLS is on with no
// policy, owner role only.
export const wordAnswers = reading.table("word_answers", {
  headword: text().primaryKey(),
  answer: text().notNull(),
  model: text().notNull(),
  resolvedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type WordAnswerRow = typeof wordAnswers.$inferSelect;
export type NewWordAnswerRow = typeof wordAnswers.$inferInsert;
