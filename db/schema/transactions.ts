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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { accounts } from "./accounts";
import { appUsers } from "./app-users";
import { groups } from "./groups";
import { recurringRules } from "./recurring-rules";

// A movement of money (RF-17): income names only a destination, expense only a source, a transfer both.
export const transactions = pgTable(
  "transactions",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Exactly one of these is set: a personal movement names its owner, a group movement names its group.
    // The scope is derived from the accounts by a trigger (migration assignment), never chosen by the user.
    ownerUserId: uuid().references(() => appUsers.id, { onDelete: "restrict" }),
    groupId: uuid().references(() => groups.id, { onDelete: "cascade" }),
    fromAccountId: uuid().references(() => accounts.id, { onDelete: "restrict" }),
    toAccountId: uuid().references(() => accounts.id, { onDelete: "restrict" }),
    amountCents: bigint({ mode: "number" }).notNull(),
    // The ISO 4217 code the movement happened in, in whose minor unit `amount_cents` is expressed
    // (RF-121). Left unset it is derived from the accounts by `set_transaction_currency`, so an
    // account holds several currencies at once and every insert path that names none keeps working.
    currency: text().notNull(),
    // The same movement in the other side's settlement currency (RF-122), an integer in its own
    // minor unit. The rate is the quotient of the two: derived to be read, never stored — a stored
    // rate would be money in floating point.
    counterAmountCents: bigint({ mode: "number" }),
    // True while the counter amount is what a person expects, not what the issuer billed (RF-123).
    // The statement replaces the estimate and clears this, and the balance moves currency with it.
    counterIsEstimate: boolean().notNull().default(false),
    // The type is derived, never chosen (RF-18): a stored generated column no INSERT can target.
    kind: text().generatedAlwaysAs(
      sql`case when from_account_id is null then 'income' when to_account_id is null then 'expense' else 'transfer' end`,
    ),
    // Date-only, interpreted in America/Bogota (RNF-06): a YYYY-MM-DD string end to end, never a JS Date.
    occurredAt: date({ mode: "string" }).notNull(),
    description: text(),
    // The rule that generated this movement (RF-31); cleared if the rule is deleted, keeping its history.
    recurringRuleId: uuid().references(() => recurringRules.id, { onDelete: "set null" }),
    // Set once a generated movement has been reviewed; null until then (RF-31).
    reviewedAt: timestamp({ withTimezone: true }),
    externalRef: text(),
    createdBy: uuid()
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The amount is always positive; direction supplies the sign (RF-20).
    check("transactions_amount_positive", sql`${table.amountCents} > 0`),
    // At least one account, so income and expense stay one-sided and a transfer keeps both (RF-20).
    check(
      "transactions_at_least_one_account",
      sql`num_nonnulls(${table.fromAccountId}, ${table.toAccountId}) >= 1`,
    ),
    // A movement belongs to a user or a group, never both and never neither — mirrors accounts.
    check(
      "transactions_owner_xor_group",
      sql`(${table.ownerUserId} is not null)::int + (${table.groupId} is not null)::int = 1`,
    ),
    // A transfer names two different accounts (RF-101). `is distinct from` leaves a one-sided
    // movement legal: one side is null, so the pair still differs.
    check(
      "transactions_accounts_distinct",
      sql`${table.fromAccountId} is distinct from ${table.toAccountId}`,
    ),
    // The shape of ISO 4217, not a list of codes: which ones a person may pick is an interface question.
    check("transactions_currency_iso", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    // The counter amount is an amount like any other: absent, or positive with the direction carrying the sign.
    check(
      "transactions_counter_amount_positive",
      sql`${table.counterAmountCents} is null or ${table.counterAmountCents} > 0`,
    ),
    // Nothing is an estimate of an amount nobody named.
    check(
      "transactions_estimate_needs_counter",
      sql`${table.counterIsEstimate} = false or ${table.counterAmountCents} is not null`,
    ),
    check("transactions_description_length", sql`length(${table.description}) <= 200`),
    check("transactions_external_ref_length", sql`length(${table.externalRef}) <= 200`),
    index("transactions_occurred_at_idx").on(table.occurredAt),
    // `account_balances` sums each side of an account with no scope column in the
    // predicate, so the scope-leading composites below cannot serve it; without
    // these two it reads the table once per side, per account.
    index("transactions_from_account_id_idx")
      .on(table.fromAccountId)
      .where(sql`from_account_id is not null`),
    index("transactions_to_account_id_idx")
      .on(table.toAccountId)
      .where(sql`to_account_id is not null`),
    index("transactions_created_by_idx").on(table.createdBy),
    index("transactions_recurring_rule_id_idx").on(table.recurringRuleId),
    index("transactions_owner_user_id_idx")
      .on(table.ownerUserId)
      .where(sql`${table.ownerUserId} is not null`),
    index("transactions_group_id_idx")
      .on(table.groupId)
      .where(sql`${table.groupId} is not null`),
    // `external_ref` is unique within a scope, so re-importing the same row updates instead of
    // duplicating (RF-52); an accepted delivery carries its own ref under the same key (RF-90).
    uniqueIndex("transactions_owner_external_ref_unique")
      .on(table.ownerUserId, table.externalRef)
      .where(sql`${table.externalRef} is not null`),
    uniqueIndex("transactions_group_external_ref_unique")
      .on(table.groupId, table.externalRef)
      .where(sql`${table.externalRef} is not null`),
    // Universal read inside the group: your own personal movements, plus every movement of the group you belong to.
    pgPolicy("transactions_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`(${authUid} = ${table.ownerUserId} or (select private.is_group_member(coalesce(${table.groupId}, private.owner_group_id(${table.ownerUserId})))))`,
    }),
    // Write is bounded to own-or-shared accounts (RF-62). The USING/WITH CHECK body
    // `private.can_write_transaction` is defined in the migration assignment.
    pgPolicy("transactions_insert_writable", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select private.can_write_transaction(${table.fromAccountId}, ${table.toAccountId}))`,
    }),
    pgPolicy("transactions_update_writable", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select private.can_write_transaction(${table.fromAccountId}, ${table.toAccountId}))`,
      withCheck: sql`(select private.can_write_transaction(${table.fromAccountId}, ${table.toAccountId}))`,
    }),
    pgPolicy("transactions_delete_writable", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select private.can_write_transaction(${table.fromAccountId}, ${table.toAccountId}))`,
    }),
  ],
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
