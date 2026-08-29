import { sql } from "drizzle-orm";
import { bigint, check, index, pgPolicy, pgTable, unique, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { savingsGoals } from "./savings-goals";
import { transactions } from "./transactions";

// The movements a savings goal earmarks (RF-77): a goal's progress sums these and is never stored.
export const goalContributions = pgTable(
  "goal_contributions",
  {
    id: uuid().primaryKey().defaultRandom(),
    goalId: uuid()
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    transactionId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
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
    pgPolicy("goal_contributions_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`exists (select 1 from ${savingsGoals} g where g.id = ${table.goalId} and (g.owner_user_id = ${authUid} or private.is_group_member(g.group_id)))`,
    }),
    pgPolicy("goal_contributions_delete_member", {
      for: "delete",
      to: authenticatedRole,
      using: sql`exists (select 1 from ${savingsGoals} g where g.id = ${table.goalId} and (g.owner_user_id = ${authUid} or private.is_group_member(g.group_id)))`,
    }),
  ],
);

export type GoalContribution = typeof goalContributions.$inferSelect;
