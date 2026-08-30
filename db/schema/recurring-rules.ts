import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { accounts } from "./accounts";
import { appUsers } from "./app-users";
import { categories } from "./categories";
import { groups } from "./groups";

// A rule that generates a repeating income or expense (RF-29): its account, amount, category and
// cadence, advancing `next_run_on` each run. Always one-sided — one account, one category, never a
// transfer. A generation lands a transaction the rule stamps and reviews (RF-31); pausing or ending a
// rule leaves its history intact (RF-32).
export const recurringRules = pgTable(
  "recurring_rules",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Exactly one of these is set: a personal rule names its owner, a group rule names its group.
    // The scope is derived from the accounts, never chosen by the user — mirrors transactions.
    ownerUserId: uuid().references(() => appUsers.id, { onDelete: "restrict" }),
    groupId: uuid().references(() => groups.id, { onDelete: "cascade" }),
    // Exactly one is set: a destination means income, a source means expense — never both.
    fromAccountId: uuid().references(() => accounts.id, { onDelete: "restrict" }),
    toAccountId: uuid().references(() => accounts.id, { onDelete: "restrict" }),
    amountCents: bigint({ mode: "number" }).notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    description: text(),
    frequency: text({ enum: ["monthly", "weekly", "yearly"] }).notNull(),
    // Every N periods of the frequency (>= 1).
    intervalN: smallint().notNull(),
    // The month-anchor day for monthly and yearly, clamped to month-end at generation; null for weekly.
    dayOfMonth: smallint(),
    // Date-only, interpreted in America/Bogota (RNF-06): a YYYY-MM-DD string end to end, never a JS Date.
    nextRunOn: date({ mode: "string" }).notNull(),
    endsOn: date({ mode: "string" }),
    isActive: boolean().notNull().default(true),
    createdBy: uuid()
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("recurring_rules_amount_positive", sql`${table.amountCents} > 0`),
    // Exactly one account, so the scope and the movement's direction can be derived — mirrors transactions.
    check(
      "recurring_rules_exactly_one_account",
      sql`num_nonnulls(${table.fromAccountId}, ${table.toAccountId}) = 1`,
    ),
    check(
      "recurring_rules_owner_xor_group",
      sql`num_nonnulls(${table.ownerUserId}, ${table.groupId}) = 1`,
    ),
    check(
      "recurring_rules_frequency_valid",
      sql`${table.frequency} in ('monthly', 'weekly', 'yearly')`,
    ),
    check("recurring_rules_interval_positive", sql`${table.intervalN} >= 1`),
    check(
      "recurring_rules_day_of_month_range",
      sql`${table.dayOfMonth} is null or ${table.dayOfMonth} between 1 and 31`,
    ),
    // Weekly advances from `next_run_on` and carries no day anchor; monthly and yearly keep one.
    check(
      "recurring_rules_day_of_month_by_frequency",
      sql`case when ${table.frequency} = 'weekly' then ${table.dayOfMonth} is null else ${table.dayOfMonth} is not null end`,
    ),
    // An end date never falls before the next run.
    check(
      "recurring_rules_ends_on_after_next_run",
      sql`${table.endsOn} is null or ${table.endsOn} >= ${table.nextRunOn}`,
    ),
    check("recurring_rules_description_length", sql`length(${table.description}) <= 200`),
    index("recurring_rules_owner_user_id_idx")
      .on(table.ownerUserId)
      .where(sql`${table.ownerUserId} is not null`),
    index("recurring_rules_group_id_idx")
      .on(table.groupId)
      .where(sql`${table.groupId} is not null`),
    index("recurring_rules_next_run_on_idx").on(table.nextRunOn),
    index("recurring_rules_category_id_idx").on(table.categoryId),
    // Universal read inside the group: your own personal rules, plus every rule of the group you belong to.
    pgPolicy("recurring_rules_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`(${authUid} = ${table.ownerUserId} or (select private.is_group_member(coalesce(${table.groupId}, private.owner_group_id(${table.ownerUserId})))))`,
    }),
    // Write is bounded to own-or-shared accounts (RF-62), the same as the transactions it will generate.
    pgPolicy("recurring_rules_insert_writable", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select private.can_write_transaction(${table.fromAccountId}, ${table.toAccountId}))`,
    }),
    pgPolicy("recurring_rules_update_writable", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select private.can_write_transaction(${table.fromAccountId}, ${table.toAccountId}))`,
      withCheck: sql`(select private.can_write_transaction(${table.fromAccountId}, ${table.toAccountId}))`,
    }),
    pgPolicy("recurring_rules_delete_writable", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select private.can_write_transaction(${table.fromAccountId}, ${table.toAccountId}))`,
    }),
  ],
);

export type RecurringRule = typeof recurringRules.$inferSelect;
export type NewRecurringRule = typeof recurringRules.$inferInsert;
