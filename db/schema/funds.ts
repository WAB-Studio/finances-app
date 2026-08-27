import { sql } from "drizzle-orm";
import { check, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

// The root of the tree: every other fund table carries a `fund_id` back to this one.
export const funds = pgTable(
  "funds",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    currency: text().notNull().default("COP"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("funds_name_length", sql`length(btrim(${table.name})) between 1 and 80`),
    // Membership, not ownership, gates read access — see RF-04.
    pgPolicy("funds_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select private.is_fund_member(${table.id}))`,
    }),
    // Anyone signed in may start a fund; RF-05 makes them its owner on the members insert.
    pgPolicy("funds_insert_any", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`true`,
    }),
  ],
);

export type Fund = typeof funds.$inferSelect;
export type NewFund = typeof funds.$inferInsert;
