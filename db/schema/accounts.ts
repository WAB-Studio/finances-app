import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { funds } from "./funds";
import { members } from "./members";

// Where money sits: an asset or a liability, belonging to the fund and optionally to a member.
export const accounts = pgTable(
  "accounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    fundId: uuid()
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    // Null is a shared fund account, not a stand-in member — RF-08.
    memberId: uuid(),
    name: text().notNull(),
    kind: text({ enum: ["asset", "liability"] }).notNull(),
    institution: text(),
    // The opening balance only (RNF-05). No running balance column exists anywhere (RNF-07).
    initialBalanceCents: bigint({ mode: "number" }).notNull().default(0),
    initialBalanceOn: date().notNull(),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("accounts_name_length", sql`length(btrim(${table.name})) between 1 and 80`),
    check("accounts_kind_valid", sql`${table.kind} in ('asset', 'liability')`),
    // Null member_id skips the check; a set one is pinned to the same fund as the account.
    foreignKey({
      columns: [table.memberId, table.fundId],
      foreignColumns: [members.id, members.fundId],
    }),
    index("accounts_fund_id_idx").on(table.fundId),
    index("accounts_member_id_idx").on(table.memberId),
    pgPolicy("accounts_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select private.is_fund_member(${table.fundId}))`,
    }),
    pgPolicy("accounts_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select private.is_fund_member(${table.fundId}))`,
    }),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
