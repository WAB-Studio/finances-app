import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  pgPolicy,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { accounts } from "./accounts";

// A liability's statement history (RF-84): one immutable snapshot per period with its bounds, its
// payment due date and the balance, minimum and interest captured at the cut-off. Materialised for a
// past period and never rewritten — no UPDATE policy. No scope of its own — the account's scope gates it.
export const debtStatements = pgTable(
  "debt_statements",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // Date-only bounds, interpreted in America/Bogota (RNF-06): YYYY-MM-DD strings, never a JS Date.
    periodStart: date({ mode: "string" }).notNull(),
    cutOffDate: date({ mode: "string" }).notNull(),
    paymentDueDate: date({ mode: "string" }).notNull(),
    // The one persisted balance figure, signed like the account, frozen at the cut-off (RNF-07 stands: no
    // running balance column — this is a snapshot, never kept in sync with later movements).
    statementBalanceCents: bigint({ mode: "number" }).notNull(),
    minimumPaymentCents: bigint({ mode: "number" }).notNull(),
    interestEstimateCents: bigint({ mode: "number" }).notNull(),
    closedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("debt_statements_period_before_cut_off", sql`${table.periodStart} <= ${table.cutOffDate}`),
    check(
      "debt_statements_due_after_cut_off",
      sql`${table.paymentDueDate} >= ${table.cutOffDate}`,
    ),
    check("debt_statements_minimum_non_negative", sql`${table.minimumPaymentCents} >= 0`),
    check("debt_statements_interest_non_negative", sql`${table.interestEstimateCents} >= 0`),
    // One statement per account per cut-off.
    unique("debt_statements_account_cut_off_unique").on(table.accountId, table.cutOffDate),
    // Readable and writable exactly when the account it belongs to is — the scope is the account's.
    pgPolicy("debt_statements_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select private.can_read_account(${table.accountId}))`,
    }),
    pgPolicy("debt_statements_insert", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select private.can_write_account(${table.accountId}))`,
    }),
    // No UPDATE policy: a statement is an immutable historical snapshot.
    pgPolicy("debt_statements_delete", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select private.can_write_account(${table.accountId}))`,
    }),
  ],
);

export type DebtStatement = typeof debtStatements.$inferSelect;
export type NewDebtStatement = typeof debtStatements.$inferInsert;
