import { sql } from "drizzle-orm";
import { check, integer, text, timestamp } from "drizzle-orm/pg-core";

import { reading } from "./_schema";

// One row per headword the photo route (RL-36) has ever resolved, `found` or
// `none`: the second lookup on any word is a single select, never a second
// call to Openverse. Not a reader's record — RLS is on with no policy, and
// only db/client.ts's owner role reaches this table.
export const wordPhotos = reading.table(
  "word_photos",
  {
    headword: text().primaryKey(),
    status: text({ enum: ["found", "none"] }).notNull(),
    objectPath: text(),
    width: integer(),
    height: integer(),
    author: text(),
    licence: text(),
    licenceUrl: text(),
    sourceUrl: text(),
    resolvedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("word_photos_none_has_no_path", sql`${t.status} <> 'none' OR ${t.objectPath} IS NULL`),
    // The attribution a redistributed file carries is what makes re-serving it
    // lawful: a `found` row missing any of these is a file this table cannot
    // prove permission to serve.
    check(
      "word_photos_found_has_attribution",
      sql`${t.status} <> 'found' OR (${t.objectPath} IS NOT NULL AND ${t.author} IS NOT NULL AND ${t.licence} IS NOT NULL AND ${t.sourceUrl} IS NOT NULL)`,
    ),
  ],
);

export type WordPhotoRow = typeof wordPhotos.$inferSelect;
export type NewWordPhotoRow = typeof wordPhotos.$inferInsert;
