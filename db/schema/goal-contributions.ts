import { sql } from "drizzle-orm";
import { bigint, check, index, pgPolicy, pgTable, unique, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { savingsGoals } from "./savings-goals";
import { transactions } from "./transactions";

// The amounts a savings goal sets aside (RF-87): a goal's progress sums these and is never stored.
// A row names a movement only when one earmarks it; the amount alone is enough.
export const goalContributions = pgTable(
  "goal_contributions",
  {
    id: uuid().primaryKey().defaultRandom(),
    goalId: uuid()
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    transactionId: uuid().references(() => transactions.id, { onDelete: "cascade" }),
    amountCents: bigint({ mode: "number" }).notNull(),
  },
  (table) => [
    check("goal_contributions_amount_positive", sql`${table.amountCents} > 0`),
    // A movement counts once toward a goal.
    unique("goal_contributions_goal_transaction_unique").on(table.goalId, table.transactionId),
    index("goal_contributions_goal_id_idx").on(table.goalId),
    index("goal_contributions_transaction_id_idx").on(table.transactionId),
    // Readable when the goal it earmarks is readable — an inline mirror of savings_goals_select_member.
    pgPolicy("goal_contributions_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`exists (select 1 from ${savingsGoals} g where g.id = ${table.goalId} and (g.owner_user_id = ${authUid} or private.is_group_member(coalesce(g.group_id, private.owner_group_id(g.owner_user_id)))))`,
    }),
    // Writable when the goal it earmarks is writable — an inline mirror of the savings_goals write rule.
    // An archived goal is closed to new aportes (RF-120): removing the button left the client as the
    // only guard, and progress must not move under a goal a person has put away.
    pgPolicy("goal_contributions_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`exists (select 1 from ${savingsGoals} g where g.id = ${table.goalId} and g.archived_at is null and (g.owner_user_id = ${authUid} or private.is_group_member(g.group_id)))`,
    }),
    pgPolicy("goal_contributions_delete_member", {
      for: "delete",
      to: authenticatedRole,
      using: sql`exists (select 1 from ${savingsGoals} g where g.id = ${table.goalId} and (g.owner_user_id = ${authUid} or private.is_group_member(g.group_id)))`,
    }),
  ],
);

export type GoalContribution = typeof goalContributions.$inferSelect;
