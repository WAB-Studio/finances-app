import "server-only";

import { eq, inArray, sql } from "drizzle-orm";

import { installmentLines, installmentPlans, transactions } from "@/db/schema";
import type { InstallmentPlan } from "@/db/schema";
import { withUserDb } from "@/db/session";

// The caller computes the dated schedule (RF-81); this only writes the plan and
// its lines. The interest rate is a fraction, so it travels as a decimal string
// and casts to numeric in SQL; every cent field stays an integer.
export type CreateInstallmentPlanArgs = {
  accountId: string;
  description: string | null;
  principalCents: number;
  nInstallments: number;
  frequency: InstallmentPlan["frequency"];
  interestRate: string | null;
  downPaymentCents: number | null;
  avalCents: number | null;
  startDate: string;
  merchant: string | null;
  lines: { seq: number; dueDate: string; amountCents: number }[];
};

/**
 * The plan and its lines in ONE `withUserDb` (RF-81): insert the plan and read
 * its id, then one multi-row insert of the dated lines. A plan schedules an
 * existing balance and moves no money — no transaction is written here.
 */
export async function createInstallmentPlan({
  accountId,
  description,
  principalCents,
  nInstallments,
  frequency,
  interestRate,
  downPaymentCents,
  avalCents,
  startDate,
  merchant,
  lines,
}: CreateInstallmentPlanArgs): Promise<{ planId: string }> {
  return withUserDb(async (tx) => {
    const [plan] = await tx
      .insert(installmentPlans)
      // A decimal string binds straight to the numeric rate — the column casts it.
      .values({
        accountId,
        description,
        principalCents,
        nInstallments,
        frequency,
        interestRate,
        downPaymentCents,
        avalCents,
        startDate,
        merchant,
      })
      .returning({ id: installmentPlans.id });

    const planId = plan.id;

    if (lines.length > 0) {
      await tx.insert(installmentLines).values(
        lines.map((line) => ({
          planId,
          seq: line.seq,
          dueDate: line.dueDate,
          amountCents: line.amountCents,
        })),
      );
    }

    return { planId };
  });
}

export type InstallmentPlanLine = {
  id: string;
  seq: number;
  dueDate: string;
  amountCents: number;
  paidTransactionId: string | null;
};

export type InstallmentPlanRow = {
  id: string;
  accountId: string;
  description: string | null;
  principalCents: number;
  nInstallments: number;
  frequency: InstallmentPlan["frequency"];
  interestRate: string | null;
  downPaymentCents: number | null;
  avalCents: number | null;
  startDate: string;
  merchant: string | null;
  pendingCents: number;
  paidCents: number;
  lines: InstallmentPlanLine[];
};

/**
 * Every plan on the account with its lines and derived pending and paid figures
 * in ONE round trip (RF-81, RNF-09): the lines ride along as a correlated
 * `jsonb_agg` and the two totals as filtered sums, never an N+1 follow-up.
 * Pending is the sum of the unpaid lines and is never a stored column.
 */
export async function listPlansForAccount(
  accountId: string,
): Promise<InstallmentPlanRow[]> {
  return withUserDb(async (tx) => {
    const rows = await tx.execute<{
      id: string;
      account_id: string;
      description: string | null;
      principal_cents: number;
      n_installments: number;
      frequency: InstallmentPlan["frequency"];
      interest_rate: string | null;
      down_payment_cents: number | null;
      aval_cents: number | null;
      start_date: string;
      merchant: string | null;
      pending_cents: string;
      paid_cents: string;
      lines: InstallmentPlanLine[];
    }>(sql`
      select
        p.id,
        p.account_id,
        p.description,
        p.principal_cents,
        p.n_installments,
        p.frequency,
        p.interest_rate,
        p.down_payment_cents,
        p.aval_cents,
        p.start_date,
        p.merchant,
        coalesce((
          select sum(l.amount_cents) from installment_lines l
          where l.plan_id = p.id and l.paid_transaction_id is null
        ), 0) as pending_cents,
        coalesce((
          select sum(l.amount_cents) from installment_lines l
          where l.plan_id = p.id and l.paid_transaction_id is not null
        ), 0) as paid_cents,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'seq', l.seq, 'dueDate', l.due_date,
            'amountCents', l.amount_cents, 'paidTransactionId', l.paid_transaction_id
          ) order by l.due_date, l.seq)
          from installment_lines l where l.plan_id = p.id
        ), '[]'::jsonb) as lines
      from installment_plans p
      where p.account_id = ${accountId}
      order by p.start_date desc, p.created_at desc
    `);

    return rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      description: row.description,
      principalCents: Number(row.principal_cents),
      nInstallments: Number(row.n_installments),
      frequency: row.frequency,
      interestRate: row.interest_rate,
      downPaymentCents: row.down_payment_cents === null ? null : Number(row.down_payment_cents),
      avalCents: row.aval_cents === null ? null : Number(row.aval_cents),
      startDate: row.start_date,
      merchant: row.merchant,
      // A bigint sum arrives from the driver as a string; the ledger keeps cents a number.
      pendingCents: Number(row.pending_cents),
      paidCents: Number(row.paid_cents),
      lines: row.lines,
    }));
  });
}

/**
 * A payment against a liability and its auto-FIFO allocation in ONE `withUserDb`
 * (RF-82): (1) the transfer that credits the liability, in the ledger's own
 * transfer shape — both accounts, no split, no label (scope, kind and created_by
 * fall to triggers); (2) the oldest-first walk over the debt account's unpaid
 * lines, ordered by due date then seq, linking each line the running remainder
 * covers IN FULL and stopping at the first it cannot. A partial remainder is left
 * unassigned; unlinking happens on its own when the paying movement is deleted.
 */
export async function recordDebtPayment({
  fromAccountId,
  toAccountId,
  amountCents,
  occurredAt,
}: {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  occurredAt: string;
}): Promise<{ transactionId: string; paidLineIds: string[] }> {
  return withUserDb(async (tx) => {
    const [txn] = await tx
      .insert(transactions)
      // `created_by`, the scope and `kind` are set by triggers/generation and
      // absent from the INSERT grant; drizzle types them required, so cast past.
      .values({
        fromAccountId,
        toAccountId,
        amountCents,
        occurredAt,
      } as typeof transactions.$inferInsert)
      .returning({ id: transactions.id });

    const transactionId = txn.id;

    // The liability the transfer credits is the debt whose lines this settles.
    const unpaid = await tx.execute<{ id: string; amount_cents: string }>(sql`
      select l.id, l.amount_cents
      from installment_lines l
      join installment_plans p on p.id = l.plan_id
      where p.account_id = ${toAccountId} and l.paid_transaction_id is null
      order by l.due_date, l.seq
    `);

    const paidLineIds: string[] = [];
    let remainder = amountCents;
    for (const line of unpaid) {
      const owed = Number(line.amount_cents);
      // Fully-covered lines only: the first line the remainder falls short of ends the walk.
      if (remainder < owed) break;
      remainder -= owed;
      paidLineIds.push(line.id);
    }

    if (paidLineIds.length > 0) {
      await tx
        .update(installmentLines)
        .set({ paidTransactionId: transactionId })
        .where(inArray(installmentLines.id, paidLineIds));
    }

    return { transactionId, paidLineIds };
  });
}

// The cascade removes the plan's lines; the boolean reports whether the policy
// admitted the delete. A line's paying movement is never touched.
export async function deleteInstallmentPlan({
  planId,
}: {
  planId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .delete(installmentPlans)
      .where(eq(installmentPlans.id, planId))
      .returning({ id: installmentPlans.id });

    return rows.length > 0;
  });
}
