import "server-only";

import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { transactionLabels, transactionSplits, transactions } from "@/db/schema";
import type { Transaction } from "@/db/session";
import { withUserDb } from "@/db/session";

export type TransactionSplitInput = { categoryId: string; amountCents: number };

// The scope, `kind` and `created_by` are set by triggers/generation, so no write
// here names them (RF-18, RF-25). A transfer names both accounts and carries no
// split; an income names only `toAccountId`, an expense only `fromAccountId`.
export type CreateTransactionArgs = {
  fromAccountId: string | null;
  toAccountId: string | null;
  amountCents: number;
  occurredAt: string;
  description: string | null;
  externalRef: string | null;
  splits: TransactionSplitInput[];
  labelIds: string[];
};

// `external_ref` is absent from the UPDATE grant: an edit rewrites only these fields.
export type UpdateTransactionArgs = {
  transactionId: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  amountCents: number;
  occurredAt: string;
  description: string | null;
  splits: TransactionSplitInput[];
  labelIds: string[];
};

export type TransactionListFilters = {
  from?: string;
  to?: string;
  memberUserId?: string;
  accountId?: string;
  categoryId?: string;
  kind?: string;
};

export type TransactionListRow = {
  id: string;
  kind: string;
  amountCents: number;
  occurredAt: string;
  description: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  createdBy: string;
  splits: { categoryId: string; amountCents: number }[];
  labels: { id: string; name: string; color: string | null }[];
};

/**
 * One transaction, three dependent round trips: insert the movement and read its
 * id, then one multi-row insert of the splits, then one of the label joins. The
 * sum and match triggers are DEFERRED, so the split set need not balance until
 * commit. A transfer carries no split, so the child inserts skip an empty set.
 */
export async function createTransaction(
  args: CreateTransactionArgs,
): Promise<{ transactionId: string }> {
  return withUserDb((tx) => insertTransaction(tx, args));
}

// The insert body of `createTransaction`, against a caller-supplied transaction:
// the webhook ingest runs it inside `withImpersonatedDb`, screens via `withUserDb`.
export async function insertTransaction(
  tx: Transaction,
  {
    fromAccountId,
    toAccountId,
    amountCents,
    occurredAt,
    description,
    externalRef,
    splits,
    labelIds,
  }: CreateTransactionArgs,
): Promise<{ transactionId: string }> {
  const [row] = await tx
    .insert(transactions)
    // `created_by` is stamped by the scope trigger and absent from the INSERT
    // grant; drizzle types it required, so the payload is cast past it.
    .values({
      fromAccountId,
      toAccountId,
      amountCents,
      occurredAt,
      description,
      externalRef,
    } as typeof transactions.$inferInsert)
    .returning({ id: transactions.id });

  const transactionId = row.id;

  if (splits.length > 0) {
    await tx.insert(transactionSplits).values(
      splits.map((split) => ({
        transactionId,
        categoryId: split.categoryId,
        amountCents: split.amountCents,
      })),
    );
  }

  if (labelIds.length > 0) {
    await tx
      .insert(transactionLabels)
      .values(labelIds.map((labelId) => ({ transactionId, labelId })));
  }

  return { transactionId };
}

/**
 * Edit the movement's fields, then replace its splits and label joins wholesale
 * (delete + one multi-row insert each). The transaction update's affected-row
 * count reports whether the policy admitted the edit (RF-24); a denied edit
 * leaves the children untouched.
 */
export async function updateTransaction({
  transactionId,
  fromAccountId,
  toAccountId,
  amountCents,
  occurredAt,
  description,
  splits,
  labelIds,
}: UpdateTransactionArgs): Promise<boolean> {
  return withUserDb(async (tx) => {
    const updated = await tx
      .update(transactions)
      .set({ fromAccountId, toAccountId, amountCents, occurredAt, description })
      .where(eq(transactions.id, transactionId))
      .returning({ id: transactions.id });

    if (updated.length === 0) return false;

    await tx
      .delete(transactionSplits)
      .where(eq(transactionSplits.transactionId, transactionId));
    if (splits.length > 0) {
      await tx.insert(transactionSplits).values(
        splits.map((split) => ({
          transactionId,
          categoryId: split.categoryId,
          amountCents: split.amountCents,
        })),
      );
    }

    await tx
      .delete(transactionLabels)
      .where(eq(transactionLabels.transactionId, transactionId));
    if (labelIds.length > 0) {
      await tx
        .insert(transactionLabels)
        .values(labelIds.map((labelId) => ({ transactionId, labelId })));
    }

    return true;
  });
}

// The cascade removes the splits and label joins; the boolean reports whether the
// policy admitted the delete (RF-24).
export async function deleteTransaction({
  transactionId,
}: {
  transactionId: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .delete(transactions)
      .where(eq(transactions.id, transactionId))
      .returning({ id: transactions.id });

    return rows.length > 0;
  });
}

/**
 * Every matching movement with its splits and labels in ONE round trip: the two
 * child sets ride along as correlated jsonb subselects, never an N+1 follow-up
 * (RF-23). Filters compose in the WHERE; `occurredAt` stays a YYYY-MM-DD string
 * end to end, its bounds compared against the date column with no JS Date. A
 * `limit` caps the newest rows for a preview list; without it every match returns.
 */
export async function listTransactions(
  filters: TransactionListFilters,
  options?: { limit?: number },
): Promise<TransactionListRow[]> {
  const conditions: SQL[] = [];

  if (filters.from) conditions.push(gte(transactions.occurredAt, filters.from));
  if (filters.to) conditions.push(lte(transactions.occurredAt, filters.to));
  if (filters.memberUserId) {
    conditions.push(eq(transactions.createdBy, filters.memberUserId));
  }
  if (filters.accountId) {
    conditions.push(
      or(
        eq(transactions.fromAccountId, filters.accountId),
        eq(transactions.toAccountId, filters.accountId),
      ) as SQL,
    );
  }
  if (filters.categoryId) {
    conditions.push(
      sql`exists (select 1 from ${transactionSplits} s
        where s.transaction_id = ${transactions.id} and s.category_id = ${filters.categoryId})`,
    );
  }
  if (filters.kind) conditions.push(eq(transactions.kind, filters.kind));

  const splitsJson = sql<{ categoryId: string; amountCents: number }[]>`coalesce((
    select jsonb_agg(jsonb_build_object('categoryId', s.category_id, 'amountCents', s.amount_cents))
    from ${transactionSplits} s where s.transaction_id = ${transactions.id}
  ), '[]'::jsonb)`;

  const labelsJson = sql<{ id: string; name: string; color: string | null }[]>`coalesce((
    select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'color', l.color) order by l.name)
    from ${transactionLabels} tl join labels l on l.id = tl.label_id
    where tl.transaction_id = ${transactions.id}
  ), '[]'::jsonb)`;

  return withUserDb(async (tx) => {
    const query = tx
      .select({
        id: transactions.id,
        // The generated column never yields null, but its type is nullable; assert it.
        kind: sql<string>`${transactions.kind}`,
        amountCents: transactions.amountCents,
        occurredAt: transactions.occurredAt,
        description: transactions.description,
        fromAccountId: transactions.fromAccountId,
        toAccountId: transactions.toAccountId,
        createdBy: transactions.createdBy,
        splits: splitsJson,
        labels: labelsJson,
      })
      .from(transactions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt));

    return options?.limit === undefined ? query : query.limit(options.limit);
  });
}
