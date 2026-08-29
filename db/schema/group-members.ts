import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { appUsers } from "./app-users";
import { groups } from "./groups";

// A person in a group, with or without a login (RF-07): `user_id` is null until they accept an invite.
export const groupMembers = pgTable(
  "group_members",
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid().references(() => appUsers.id, { onDelete: "set null" }),
    name: text().notNull(),
    role: text({ enum: ["leader", "member"] }).notNull().default("member"),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("group_members_name_length", sql`length(btrim(${table.name})) between 1 and 80`),
    check("group_members_role_valid", sql`${table.role} in ('leader', 'member')`),
    // The §2 invariant "only a member with a user can be leader", as a constraint.
    check("group_members_leader_has_user", sql`${table.role} <> 'leader' or ${table.userId} is not null`),
    // One group per user: a live claim on any group blocks a second, across the whole table.
    uniqueIndex("group_members_user_unique")
      .on(table.userId)
      .where(sql`${table.userId} is not null and ${table.archivedAt} is null`),
    index("group_members_group_id_idx").on(table.groupId),
    index("group_members_user_id_idx").on(table.userId),
    // The self-disjunct mirrors the owner exception on accounts and categories:
    // you can always read your own membership, including the leader claim's INSERT ... RETURNING.
    pgPolicy("group_members_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.userId} = ${authUid} or (select private.is_group_member(${table.groupId}))`,
    }),
    // RF-59: exactly one member in an unclaimed group, it is you, and you are its leader.
    pgPolicy("group_members_insert_leader_claim", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${authUid} = ${table.userId} and ${table.role} = 'leader' and (select private.group_is_unclaimed(${table.groupId}))`,
    }),
    // RF-07: a member of the group records a person who has no login of their own.
    pgPolicy("group_members_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select private.is_group_member(${table.groupId})) and ${table.userId} is null and ${table.role} = 'member'`,
    }),
    // Renaming your own row is fine; leaving it archived while claiming it back is not.
    pgPolicy("group_members_update_member", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select private.is_group_member(${table.groupId}))`,
      withCheck: sql`(select private.is_group_member(${table.groupId})) and (${table.userId} is distinct from ${authUid} or ${table.archivedAt} is null)`,
    }),
    // RF-11: a member with movements is archived elsewhere; this policy only lets the row be dropped, never you.
    pgPolicy("group_members_delete_member", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select private.is_group_member(${table.groupId})) and ${table.userId} is distinct from ${authUid}`,
    }),
  ],
);

export type GroupMember = typeof groupMembers.$inferSelect;
export type NewGroupMember = typeof groupMembers.$inferInsert;
