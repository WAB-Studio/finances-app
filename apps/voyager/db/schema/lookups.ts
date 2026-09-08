import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgPolicy,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

import { reading } from "./_schema";

// A search a reader stopped on, copied up from a device's own IndexedDB record
// (apps/voyager/lib/log/types.ts). Never rewritten: a merge only inserts, which
// is what makes retrying it after a crash safe (RL-24).
export const lookups = reading.table(
  "lookups",
  {
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    // Minted once per device, kept in the `sync` store of `reading-log` v2.
    deviceId: uuid().notNull(),
    // The device's own autoincrement (record.ts's keyPath): unique per device, not globally.
    localId: integer().notNull(),
    // The device's clock, kept as reported and never corrected.
    at: timestamp({ withTimezone: true }).notNull(),
    // The server's clock — monotonic by construction, unlike `at` — and the download cursor.
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    text: text().notNull(),
    normalised: text().notNull(),
    kind: text({ enum: ["word", "phrase"] }).notNull(),
    outcome: text({
      enum: ["exact", "inflected", "miss", "translated", "untranslated"],
    }).notNull(),
    headword: text(),
    rule: text(),
    senses: integer().notNull().default(0),
    // The translation taught to the reader, so `/registro` draws a row without
    // reopening the dictionary (RL-36). Bounded at 120: see module 23.
    translation: text(),
    dictionaryReady: boolean().notNull(),
    // A sentence lookup only; a word lookup never touches the network and carries none.
    origin: text({ enum: ["device", "network"] }),
    // LOOKUP_SCHEMA off the row that produced it, not the database's own version.
    recordSchema: smallint().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.deviceId, t.localId] }),
    index("lookups_user_id_received_at_idx").on(t.userId, t.receivedAt),
    check("lookups_local_id_positive", sql`${t.localId} > 0`),
    check("lookups_senses_non_negative", sql`${t.senses} >= 0`),
    check("lookups_translation_length", sql`length(${t.translation}) <= 120`),
    // `authUid` is `(select auth.uid())`: evaluated once per query, not once per row.
    pgPolicy("lookups_select_self", {
      for: "select",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy("lookups_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${authUid} = ${t.userId}`,
    }),
    // No UPDATE policy: a copied row is never edited (RL-24).
    // DELETE is scoped to the owner only; the statement that runs it narrows
    // further by device_id when a device is retired (RL-25) — this policy just
    // keeps the caller off rows that are not theirs.
    pgPolicy("lookups_delete_self", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
  ],
);

export type Lookup = typeof lookups.$inferSelect;
export type NewLookup = typeof lookups.$inferInsert;
