import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { funds } from "./funds";

// How a transaction is classified; RF-26 nests one level of subcategory under a parent.
export const categories = pgTable(
  "categories",
  {
    id: uuid().primaryKey().defaultRandom(),
    fundId: uuid()
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    parentId: uuid(),
    name: text().notNull(),
    kind: text({ enum: ["expense", "income"] }).notNull(),
    color: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("categories_name_length", sql`length(btrim(${table.name})) between 1 and 80`),
    check("categories_kind_valid", sql`${table.kind} in ('expense', 'income')`),
    // What lets a subcategory's foreign key pin it to the same fund as its parent.
    unique("categories_id_fund_id_unique").on(table.id, table.fundId),
    foreignKey({
      columns: [table.parentId, table.fundId],
      foreignColumns: [table.id, table.fundId],
    }).onDelete("cascade"),
    index("categories_fund_id_idx").on(table.fundId),
    index("categories_parent_id_idx").on(table.parentId),
    pgPolicy("categories_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select private.is_fund_member(${table.fundId}))`,
    }),
    pgPolicy("categories_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select private.is_fund_member(${table.fundId}))`,
    }),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
