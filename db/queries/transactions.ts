import "server-only";

import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { insertRow } from "@/db/insert-row";
import { accounts, transactionLabels, transactionSplits, transactions } from "@/db/schema";
import type { Transaction } from "@/db/session";
import { withUserDb } from "@/db/session";
import type { CurrencyCode } from "@/lib/currency";
import type { SettlementCurrencies } from "@/lib/validation/transaction";

export type TransactionSplitInput = { categoryId: string; amountCents: number };

// The scope, `kind` and `created_by` are set by triggers/generation, so no write
// here names them (RF-18, RF-25). A transfer names both accounts and carries no
// split; an income names only `toAccountId`, an expense only `fromAccountId`.
export type CreateTransactionArgs = {
  fromAccountId: string | null;
  toAccountId: string | null;
  amountCents: number;
  // The currency the amount is in (RF-121). Null hands the choice to
  // `set_transaction_currency`, which takes it from the accounts — what every
  // insert path that names no currency has always meant.
  currency?: CurrencyCode | null;
  // The same movement in the other side's settlement currency, and whether it
  // is still what a person expects rather than what was billed (RF-122, RF-123).
  counterAmountCents?: number | null;
  counterIsEstimate?: boolean;
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
  currency?: CurrencyCode | null;
  counterAmountCents?: number | null;
  counterIsEstimate?: boolean;
  occurredAt: string;
  description: string | null;
  splits: TransactionSplitInput[];
  labelIds: string[];
};

export type TransactionListFilters = {
  id?: string;
  from?: string;
  to?: string;
  memberUserId?: string;
  accountId?: string;
  categoryId?: string;
  // The label a movement carries through the join, RF-89.
  labelId?: string;
  kind?: string;
  // The deep-link target: keep only generated movements still awaiting review
  // (`recurring_rule_id is not null and reviewed_at is null`), RF-31.
  unreviewed?: boolean;
};

export type TransactionListRow = {
  id: string;
  kind: string;
  amountCents: number;
  // The currency the amount is in, and the same movement in the settlement
  // currency of the side that settles elsewhere (RF-121, RF-122). The rate is
  // their quotient, derived to be read and never stored.
  currency: CurrencyCode;
  counterAmountCents: number | null;
  counterIsEstimate: boolean;
  occurredAt: string;
  description: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  createdBy: string;
  // A generated movement carries its rule id; a manual one has none. The review
  // stamp is null until it is confirmed or its amount corrected (RF-31).
  recurringRuleId: string | null;
  reviewedAt: Date | null;
  // What each named account settles in, so a screen reads the second amount's
  // currency off the row it already has (RF-121).
  fromSettlementCurrency: CurrencyCode | null;
  toSettlementCurrency: CurrencyCode | null;
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
    currency = null,
    counterAmountCents = null,
    counterIsEstimate = false,
    occurredAt,
    description,
    externalRef,
    splits,
    labelIds,
  }: CreateTransactionArgs,
): Promise<{ transactionId: string }> {
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into transactions (
      from_account_id,
      to_account_id,
      amount_cents,
      currency,
      counter_amount_cents,
      counter_is_estimate,
      occurred_at,
      description,
      external_ref
    ) values (
      ${fromAccountId},
      ${toAccountId},
      ${amountCents},
      ${currency},
      ${counterAmountCents},
      ${counterIsEstimate},
      ${occurredAt},
      ${description},
      ${externalRef}
    )
    returning id
  `);

  const transactionId = row.id;

  if (splits.length > 0) {
    await tx.execute(sql`
      insert into transaction_splits (transaction_id, category_id, amount_cents)
      values ${sql.join(
        splits.map(
          (split) =>
            sql`(${transactionId}, ${split.categoryId}, ${split.amountCents})`,
        ),
        sql`, `,
      )}
    `);
  }

  if (labelIds.length > 0) {
    await insertRow(
      tx,
      transactionLabels,
      labelIds.map((labelId) => ({ transactionId, labelId })),
    );
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
  currency,
  counterAmountCents = null,
  counterIsEstimate = false,
  occurredAt,
  description,
  splits,
  labelIds,
}: UpdateTransactionArgs): Promise<boolean> {
  return withUserDb(async (tx) => {
    const updated = await tx
      .update(transactions)
      // Correcting a generated movement also confirms it (RF-31): the same write
      // stamps `reviewed_at` when the row is generated and still unreviewed, and
      // leaves a manual row's null and an already-reviewed stamp untouched.
      .set({
        fromAccountId,
        toAccountId,
        amountCents,
        // An edit that names no currency leaves the stored one alone: only the
        // INSERT trigger derives one, and the column is not nullable.
        ...(currency ? { currency } : {}),
        counterAmountCents,
        counterIsEstimate,
        occurredAt,
        description,
        reviewedAt: sql`case when ${transactions.recurringRuleId} is not null and ${transactions.reviewedAt} is null then now() else ${transactions.reviewedAt} end`,
      })
      .where(eq(transactions.id, transactionId))
      .returning({ id: transactions.id });

    if (updated.length === 0) return false;

    await tx
      .delete(transactionSplits)
      .where(eq(transactionSplits.transactionId, transactionId));
    if (splits.length > 0) {
      await insertRow(
        tx,
        transactionSplits,
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
      await insertRow(
        tx,
        transactionLabels,
        labelIds.map((labelId) => ({ transactionId, labelId })),
      );
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

  if (filters.id) conditions.push(eq(transactions.id, filters.id));
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
  if (filters.labelId) {
    conditions.push(
      sql`exists (select 1 from ${transactionLabels} tl
        where tl.transaction_id = ${transactions.id} and tl.label_id = ${filters.labelId})`,
    );
  }
  if (filters.kind) conditions.push(eq(transactions.kind, filters.kind));
  if (filters.unreviewed) {
    conditions.push(
      and(
        isNotNull(transactions.recurringRuleId),
        isNull(transactions.reviewedAt),
      ) as SQL,
    );
  }

  // The outer reference is written qualified: drizzle renders an embedded column
  // bare inside a projection, and a bare `id` binds to the subquery's own table,
  // which turns the correlation into a constant and empties both sets.
  const outerId = sql`"transactions"."id"`;

  const splitsJson = sql<{ categoryId: string; amountCents: number }[]>`coalesce((
    select jsonb_agg(jsonb_build_object('categoryId', s.category_id, 'amountCents', s.amount_cents))
    from ${transactionSplits} s where s.transaction_id = ${outerId}
  ), '[]'::jsonb)`;

  const labelsJson = sql<{ id: string; name: string; color: string | null }[]>`coalesce((
    select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'color', l.color) order by l.name)
    from ${transactionLabels} tl join labels l on l.id = tl.label_id
    where tl.transaction_id = ${outerId}
  ), '[]'::jsonb)`;

  return withUserDb(async (tx) => {
    const query = tx
      .select({
        id: transactions.id,
        // The generated column never yields null, but its type is nullable; assert it.
        kind: sql<string>`${transactions.kind}`,
        amountCents: transactions.amountCents,
        currency: transactions.currency,
        counterAmountCents: transactions.counterAmountCents,
        counterIsEstimate: transactions.counterIsEstimate,
        occurredAt: transactions.occurredAt,
        description: transactions.description,
        fromAccountId: transactions.fromAccountId,
        toAccountId: transactions.toAccountId,
        createdBy: transactions.createdBy,
        recurringRuleId: transactions.recurringRuleId,
        reviewedAt: transactions.reviewedAt,
        // Written with the joined alias, never a Drizzle column reference: a
        // reference inside a projection fragment renders bare and binds inward.
        fromSettlementCurrency: sql<
          string | null
        >`from_account.settlement_currency`,
        toSettlementCurrency: sql<string | null>`to_account.settlement_currency`,
        splits: splitsJson,
        labels: labelsJson,
      })
      .from(transactions)
      // What each named side settles in, alongside the movement's own currency
      // and in the same statement: a screen reads the second amount's currency
      // off the row, and the list still costs the one round trip it did (RF-121).
      // A join, not a correlated lookup: the policy on `accounts` is then
      // evaluated once per account and not once per movement.
      .leftJoin(
        sql`${accounts} from_account`,
        sql`from_account.id = ${transactions.fromAccountId}`,
      )
      .leftJoin(
        sql`${accounts} to_account`,
        sql`to_account.id = ${transactions.toAccountId}`,
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt));

    return options?.limit === undefined ? query : query.limit(options.limit);
  });
}

/**
 * What the two named accounts settle in (RF-121), in one round trip. The write
 * path reads the currencies here and never off the payload: the second amount a
 * movement carries is expressed in one of them, and what minor unit it is in
 * decides the integer that gets stored. RLS scopes the read, so an account the
 * caller cannot see answers null, exactly as one that was never there — which
 * the INSERT policy refuses on its own.
 */
export async function getSettlementCurrencies({
  fromAccountId,
  toAccountId,
}: {
  fromAccountId: string | null;
  toAccountId: string | null;
}): Promise<SettlementCurrencies> {
  const ids = [fromAccountId, toAccountId].filter(
    (id): id is string => id !== null,
  );
  if (ids.length === 0) return { from: null, to: null };

  const rows = await withUserDb((tx) =>
    tx
      .select({ id: accounts.id, currency: accounts.settlementCurrency })
      .from(accounts)
      .where(inArray(accounts.id, ids)),
  );

  const currencies = new Map(rows.map((row) => [row.id, row.currency]));

  return {
    from: (fromAccountId && currencies.get(fromAccountId)) ?? null,
    to: (toAccountId && currencies.get(toAccountId)) ?? null,
  };
}

// One movement in one round trip, its splits and labels along (RF-24). RLS scopes
// the read, so an id the caller may not see returns null, the same as one that
// was never there.
export async function getTransactionById(
  id: string,
): Promise<TransactionListRow | null> {
  const [row] = await listTransactions({ id }, { limit: 1 });
  return row ?? null;
}
