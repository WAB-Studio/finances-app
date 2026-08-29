import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { plannedPayments, transactionSplits, transactions } from "@/db/schema";
import type { PlannedPayment } from "@/db/schema";
import { withUserDb } from "@/db/session";

type PlannedPaymentStatus = PlannedPayment["status"];

export type PlannedPaymentRow = {
  id: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  amountCents: number;
  categoryId: string | null;
  dueDate: string;
  remindOn: string | null;
  description: string | null;
  status: PlannedPaymentStatus;
  settledTransactionId: string | null;
};

// Every readable planned payment, soonest due first, in ONE round trip (RF-74).
// `status` narrows the same query; scope is the policy's job.
export async function listPlannedPayments({
  status,
}: {
  status?: PlannedPaymentStatus;
} = {}): Promise<PlannedPaymentRow[]> {
  return withUserDb(async (tx) =>
    tx
      .select({
        id: plannedPayments.id,
        fromAccountId: plannedPayments.fromAccountId,
        toAccountId: plannedPayments.toAccountId,
        amountCents: plannedPayments.amountCents,
        categoryId: plannedPayments.categoryId,
        dueDate: plannedPayments.dueDate,
        remindOn: plannedPayments.remindOn,
        description: plannedPayments.description,
        status: plannedPayments.status,
        settledTransactionId: plannedPayments.settledTransactionId,
      })
      .from(plannedPayments)
      .where(status ? eq(plannedPayments.status, status) : undefined)
      .orderBy(asc(plannedPayments.dueDate)),
  );
}

// The scope and `created_by` are set by the `set_planned_payment_scope` trigger and
// absent from the INSERT grant, so no write here names them; drizzle types
// `createdBy` required, so the payload is cast past it.
export type CreatePlannedPaymentArgs = {
  fromAccountId: string | null;
  toAccountId: string | null;
  amountCents: number;
  categoryId: string | null;
  dueDate: string;
  remindOn: string | null;
  description: string | null;
};

export async function createPlannedPayment({
  fromAccountId,
  toAccountId,
  amountCents,
  categoryId,
  dueDate,
  remindOn,
  description,
}: CreatePlannedPaymentArgs): Promise<{ plannedPaymentId: string }> {
  return withUserDb(async (tx) => {
    const [row] = await tx
      .insert(plannedPayments)
      .values({
        fromAccountId,
        toAccountId,
        amountCents,
        categoryId,
        dueDate,
        remindOn,
        description,
      } as typeof plannedPayments.$inferInsert)
      .returning({ id: plannedPayments.id });

    return { plannedPaymentId: row.id };
  });
}

// `status` and `settled_transaction_id` are set only by settle/cancel, never a plain
// edit, so an edit touches these fields; the boolean reports whether the policy admitted it.
export type UpdatePlannedPaymentArgs = {
  plannedPaymentId: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  amountCents: number;
  categoryId: string | null;
  dueDate: string;
  remindOn: string | null;
  description: string | null;
};

export async function updatePlannedPayment({
  plannedPaymentId,
  fromAccountId,
  toAccountId,
  amountCents,
  categoryId,
  dueDate,
  remindOn,
  description,
}: UpdatePlannedPaymentArgs): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(plannedPayments)
      .set({ fromAccountId, toAccountId, amountCents, categoryId, dueDate, remindOn, description })
      .where(eq(plannedPayments.id, plannedPaymentId))
      .returning({ id: plannedPayments.id });

    return rows.length > 0;
  });
}

export async function deletePlannedPayment({
  plannedPaymentId,
}: {
  plannedPaymentId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .delete(plannedPayments)
      .where(eq(plannedPayments.id, plannedPaymentId))
      .returning({ id: plannedPayments.id });

    return rows.length > 0;
  });
}

// Only a pending payment can be cancelled; the guard trigger keeps the terminal
// states one-way. The boolean reports whether a pending row was claimed.
export async function cancelPlannedPayment({
  plannedPaymentId,
}: {
  plannedPaymentId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(plannedPayments)
      .set({ status: "cancelled" })
      .where(
        and(eq(plannedPayments.id, plannedPaymentId), eq(plannedPayments.status, "pending")),
      )
      .returning({ id: plannedPayments.id });

    return rows.length > 0;
  });
}

export type SettlePlannedPaymentArgs = {
  plannedPaymentId: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  amountCents: number;
  categoryId: string | null;
  occurredAt: string;
  description: string | null;
};

export type SettlePlannedPaymentResult =
  | { settled: true; transactionId: string }
  | { settled: false };

// Aborts the whole `withUserDb` transaction, rolling the inserted movement back,
// when the payment is no longer pending — so a lost race leaves no orphan.
const notPending = Symbol("planned payment no longer pending");

/**
 * Records the real movement and flips the payment to 'done' inside ONE
 * `withUserDb` transaction (RF-75). The payment's accounts, amount and category
 * become the transaction — an expense with a single split, a transfer with none,
 * mirroring the ledger's own insert path. The guarded UPDATE claims the row only
 * while it is still pending; if it claims nothing the payment was already settled
 * or cancelled, so this throws to roll the inserted movement back and returns
 * `{ settled: false }`, never a movement with no payment pointing at it.
 */
export async function settlePlannedPayment({
  plannedPaymentId,
  fromAccountId,
  toAccountId,
  amountCents,
  categoryId,
  occurredAt,
  description,
}: SettlePlannedPaymentArgs): Promise<SettlePlannedPaymentResult> {
  try {
    return await withUserDb(async (tx) => {
      const [row] = await tx
        .insert(transactions)
        // `created_by`, the scope and `kind` are set by triggers/generation and
        // absent from the INSERT grant; drizzle types them required, so cast past.
        .values({
          fromAccountId,
          toAccountId,
          amountCents,
          occurredAt,
          description,
        } as typeof transactions.$inferInsert)
        .returning({ id: transactions.id });

      const transactionId = row.id;

      // A transfer carries no category and no split; an income or expense earmarks its one category.
      if (categoryId !== null) {
        await tx
          .insert(transactionSplits)
          .values({ transactionId, categoryId, amountCents });
      }

      const claimed = await tx
        .update(plannedPayments)
        .set({ status: "done", settledTransactionId: transactionId })
        .where(
          and(
            eq(plannedPayments.id, plannedPaymentId),
            eq(plannedPayments.status, "pending"),
          ),
        )
        .returning({ id: plannedPayments.id });

      if (claimed.length === 0) throw notPending;

      return { settled: true, transactionId };
    });
  } catch (error) {
    if (error === notPending) return { settled: false };
    throw error;
  }
}
