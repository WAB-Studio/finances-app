import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { appUsers } from "./app-users";
import { funds } from "./funds";

// A person in a fund, with or without a login (RF-07): `user_id` is null until they accept an invite.
export const members = pgTable(
  "members",
  {
    id: uuid().primaryKey().defaultRandom(),
    fundId: uuid()
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    userId: uuid().references(() => appUsers.id, { onDelete: "set null" }),
    name: text().notNull(),
    role: text({ enum: ["owner", "member"] }).notNull().default("member"),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("members_name_length", sql`length(btrim(${table.name})) between 1 and 80`),
    check("members_role_valid", sql`${table.role} in ('owner', 'member')`),
    // The §2 invariant "only a member with a user can be owner", as a constraint.
    check("members_owner_has_user", sql`${table.role} <> 'owner' or ${table.userId} is not null`),
    // What lets accounts pin a composite (member_id, fund_id) foreign key to this row.
    unique("members_id_fund_id_unique").on(table.id, table.fundId),
    // One user is at most one member per fund.
    uniqueIndex("members_fund_user_unique")
      .on(table.fundId, table.userId)
      .where(sql`${table.userId} is not null`),
    index("members_fund_id_idx").on(table.fundId),
    index("members_user_id_fund_id_idx").on(table.userId, table.fundId),
    pgPolicy("members_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select private.is_fund_member(${table.fundId}))`,
    }),
    // RF-05: exactly one member in an unclaimed fund, it is you, and you are its owner.
    pgPolicy("members_insert_owner_claim", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${authUid} = ${table.userId} and ${table.role} = 'owner' and (select private.fund_is_unclaimed(${table.fundId}))`,
    }),
  ],
);

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
