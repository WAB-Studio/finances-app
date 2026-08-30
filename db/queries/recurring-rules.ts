import "server-only";

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { recurringRules, transactions } from "@/db/schema";
import type { RecurringRule } from "@/db/schema";
import { withUserDb } from "@/db/session";

type Frequency = RecurringRule["frequency"];

export type RecurringRuleRow = {
  id: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  amountCents: number;
  categoryId: string;
  description: string | null;
  frequency: Frequency;
  intervalN: number;
  dayOfMonth: number | null;
  nextRunOn: string;
  endsOn: string | null;
  isActive: boolean;
};

// Every readable rule, soonest next run first, in ONE round trip (RF-29); scope is
// the policy's job.
export async function listRecurringRules(): Promise<RecurringRuleRow[]> {
  return withUserDb(async (tx) =>
    tx
      .select({
        id: recurringRules.id,
        fromAccountId: recurringRules.fromAccountId,
        toAccountId: recurringRules.toAccountId,
        amountCents: recurringRules.amountCents,
        categoryId: recurringRules.categoryId,
        description: recurringRules.description,
        frequency: recurringRules.frequency,
        intervalN: recurringRules.intervalN,
        dayOfMonth: recurringRules.dayOfMonth,
        nextRunOn: recurringRules.nextRunOn,
        endsOn: recurringRules.endsOn,
        isActive: recurringRules.isActive,
      })
      .from(recurringRules)
      .orderBy(asc(recurringRules.nextRunOn)),
  );
}

// The scope and `created_by` are set by the `set_recurring_rule_scope` trigger and
// absent from the INSERT grant, so no write here names them; drizzle types
// `createdBy` required, so the payload is cast past it. `is_active` starts true.
export type CreateRecurringRuleArgs = {
  fromAccountId: string | null;
  toAccountId: string | null;
  amountCents: number;
  categoryId: string;
  description: string | null;
  frequency: Frequency;
  intervalN: number;
  dayOfMonth: number | null;
  nextRunOn: string;
  endsOn: string | null;
};

export async function createRecurringRule({
  fromAccountId,
  toAccountId,
  amountCents,
  categoryId,
  description,
  frequency,
  intervalN,
  dayOfMonth,
  nextRunOn,
  endsOn,
}: CreateRecurringRuleArgs): Promise<{ recurringRuleId: string }> {
  return withUserDb(async (tx) => {
    const [row] = await tx
      .insert(recurringRules)
      .values({
        fromAccountId,
        toAccountId,
        amountCents,
        categoryId,
        description,
        frequency,
        intervalN,
        dayOfMonth,
        nextRunOn,
        endsOn,
      } as typeof recurringRules.$inferInsert)
      .returning({ id: recurringRules.id });

    return { recurringRuleId: row.id };
  });
}

// `is_active`, `next_run_on` and the end date are the pause/resume and generation
// paths' to write, so a plain edit touches only the definition fields; the boolean
// reports whether the policy admitted it.
export type UpdateRecurringRuleArgs = {
  id: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  amountCents: number;
  categoryId: string;
  description: string | null;
  frequency: Frequency;
  intervalN: number;
  dayOfMonth: number | null;
  nextRunOn: string;
  endsOn: string | null;
};

export async function updateRecurringRule({
  id,
  fromAccountId,
  toAccountId,
  amountCents,
  categoryId,
  description,
  frequency,
  intervalN,
  dayOfMonth,
  nextRunOn,
  endsOn,
}: UpdateRecurringRuleArgs): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(recurringRules)
      .set({
        fromAccountId,
        toAccountId,
        amountCents,
        categoryId,
        description,
        frequency,
        intervalN,
        dayOfMonth,
        nextRunOn,
        endsOn,
      })
      .where(eq(recurringRules.id, id))
      .returning({ id: recurringRules.id });

    return rows.length > 0;
  });
}

export async function deleteRecurringRule({ id }: { id: string }): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .delete(recurringRules)
      .where(eq(recurringRules.id, id))
      .returning({ id: recurringRules.id });

    return rows.length > 0;
  });
}

// Pausing or resuming flips the flag the generator reads; the row's history stays
// intact either way (RF-32).
export async function setRecurringRuleActive({
  id,
  isActive,
}: {
  id: string;
  isActive: boolean;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(recurringRules)
      .set({ isActive })
      .where(eq(recurringRules.id, id))
      .returning({ id: recurringRules.id });

    return rows.length > 0;
  });
}

// Setting or clearing the end date bounds when the rule stops generating (RF-32).
export async function setRecurringRuleEndDate({
  id,
  endsOn,
}: {
  id: string;
  endsOn: string | null;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(recurringRules)
      .set({ endsOn })
      .where(eq(recurringRules.id, id))
      .returning({ id: recurringRules.id });

    return rows.length > 0;
  });
}

// How many generated movements still await review — the count the badge shows (RF-31);
// scope is the policy's job.
export async function countUnreviewedGenerated(): Promise<number> {
  return withUserDb(async (tx) => {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(isNotNull(transactions.recurringRuleId), isNull(transactions.reviewedAt)));

    return row.count;
  });
}

// Stamps a generated movement as reviewed (RF-31). The guard confirms it is
// generated and still unreviewed, so a manual row is never stamped and an already
// reviewed one is never restamped; the boolean reports whether a row was claimed.
export async function markTransactionReviewed({
  transactionId,
}: {
  transactionId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(transactions)
      .set({ reviewedAt: sql`now()` })
      .where(
        and(
          eq(transactions.id, transactionId),
          isNotNull(transactions.recurringRuleId),
          isNull(transactions.reviewedAt),
        ),
      )
      .returning({ id: transactions.id });

    return rows.length > 0;
  });
}
