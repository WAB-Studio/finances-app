import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { appUsers } from "./app-users";
import { groups } from "./groups";

// Where money sits: an asset or a liability, owned by a user XOR held by a group.
export const accounts = pgTable(
  "accounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Exactly one of these is set: a personal account names its owner, a group account names its group.
    ownerUserId: uuid().references(() => appUsers.id, { onDelete: "restrict" }),
    groupId: uuid().references(() => groups.id, { onDelete: "cascade" }),
    // A group account any member may write; a personal account stays owner-only (accounts_personal_not_shared).
    isShared: boolean().notNull().default(false),
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
    // A liability's opening balance is stored negative; an asset's is stored non-negative.
    check(
      "accounts_initial_balance_sign",
      sql`(${table.kind} = 'asset' and ${table.initialBalanceCents} >= 0) or (${table.kind} = 'liability' and ${table.initialBalanceCents} <= 0)`,
    ),
    // An account belongs to a user or a group, never both and never neither — mirrors categories.
    check("accounts_owner_xor_group", sql`num_nonnulls(${table.ownerUserId}, ${table.groupId}) = 1`),
    // A personal account is never shared; only a group account carries is_shared.
    check("accounts_personal_not_shared", sql`${table.ownerUserId} is null or ${table.isShared} = false`),
    index("accounts_group_id_idx").on(table.groupId),
    index("accounts_owner_user_id_idx").on(table.ownerUserId),
    // Universal read inside the group: your own personal account, plus every account of the group you belong to.
    pgPolicy("accounts_select_group", {
      for: "select",
      to: authenticatedRole,
      using: sql`(${table.ownerUserId} = ${authUid} or (select private.is_group_member(coalesce(${table.groupId}, private.owner_group_id(${table.ownerUserId})))))`,
    }),
    // Write is bounded to own-or-shared; the leader holds no write exception here.
    // The INSERT WITH CHECK reads the NEW row's own columns inline: can_write_account looks the row up by
    // id, which the not-yet-visible NEW row fails, so it mirrors the group_members/categories inline pattern.
    pgPolicy("accounts_insert_writable", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(${table.ownerUserId} = ${authUid} or (${table.isShared} and (select private.is_group_member(${table.groupId}))))`,
    }),
    pgPolicy("accounts_update_writable", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select private.can_write_account(${table.id}))`,
      withCheck: sql`(select private.can_write_account(${table.id}))`,
    }),
    pgPolicy("accounts_delete_writable", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select private.can_write_account(${table.id}))`,
    }),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
