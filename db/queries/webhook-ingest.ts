import "server-only";

import { eq } from "drizzle-orm";

import { accounts, categories, transactions } from "@/db/schema";
import { withImpersonatedDb } from "@/db/session";
import { pgErrorCode } from "@/lib/db-error";
import { todayInBogota } from "@/lib/dates";
import { parsePesos, pesosToCents } from "@/lib/money";
import { insertTransaction } from "@/db/queries/transactions";
import { interpretQuickEntry } from "@/lib/transactions/interpret";

// Why an ingest was refused, in terms the route (C7) maps to a status code. No
// raw pg text ever reaches the caller: a DB refusal is translated to one of
// these before it escapes the transaction.
export type WebhookIngestReason =
  | "missing_account"
  | "missing_category"
  | "bad_amount"
  | "scope"
  | "unexpected";

export class WebhookIngestError extends Error {
  constructor(public reason: WebhookIngestReason) {
    super(reason);
    this.name = "WebhookIngestError";
  }
}

// The validated inbound body (the route's Zod guards its shape and presence of
// `external_ref`). `text` feeds the interpreter; every other field is a caller
// override the interpreter's proposal yields to.
export type WebhookIngestPayload = {
  text: string;
  amount?: string | null;
  account_id?: string | null;
  occurred_at?: string | null;
  direction?: "income" | "expense" | null;
  external_ref: string;
};

export type IngestWebhookMovementArgs = {
  ownerUserId: string;
  defaultAccountId: string | null;
  defaultCategoryId: string | null;
  payload: WebhookIngestPayload;
};

/**
 * Record one movement under a resolved credential's owner (RF-86), through the
 * same insert a screen uses (RF-45). The `ownerUserId` is one the caller
 * verified from a credential, never a payload value, so the whole body runs
 * inside `withImpersonatedDb` and every read and the write are RLS-bound.
 *
 * The interpreter (RF-22) proposes amount, category and description; explicit
 * payload fields win. A repeated `external_ref` trips the per-scope unique index
 * and returns the existing movement without a second write.
 */
export async function ingestWebhookMovement({
  ownerUserId,
  defaultAccountId,
  defaultCategoryId,
  payload,
}: IngestWebhookMovementArgs): Promise<{
  transactionId: string;
  duplicate: boolean;
}> {
  return withImpersonatedDb(ownerUserId, async (tx) => {
    // The interpreter's context: the user's categories and accounts, read in
    // parallel within the transaction, RLS-scoped to their personal and
    // group-readable rows.
    const [categoryRows, accountRows] = await Promise.all([
      tx
        .select({
          id: categories.id,
          name: categories.name,
          kind: categories.kind,
        })
        .from(categories),
      tx
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts),
    ]);

    const proposal = interpretQuickEntry(payload.text, {
      categories: categoryRows,
      accounts: accountRows,
      defaultAccountId,
    });

    // A payload amount overrides the interpreter's; either way the result must
    // parse to a positive peso value.
    const rawPesos = payload.amount ?? proposal.amountPesos;
    if (rawPesos === null || rawPesos === undefined) {
      throw new WebhookIngestError("bad_amount");
    }
    const pesos = parsePesos(rawPesos);
    if (pesos === null) throw new WebhookIngestError("bad_amount");
    const amountCents = pesosToCents(pesos);
    if (amountCents <= 0) throw new WebhookIngestError("bad_amount");

    // No interpreter-guessed account: without a payload or default account the
    // ingest is rejected (route → 422).
    const accountId = payload.account_id ?? defaultAccountId;
    if (!accountId) throw new WebhookIngestError("missing_account");

    // An income or expense needs at least one split (RF-69), so a category is
    // mandatory once the interpreter matched none and no default is set.
    const categoryId = proposal.categoryId ?? defaultCategoryId;
    if (!categoryId) throw new WebhookIngestError("missing_category");

    const occurredAt = payload.occurred_at ?? todayInBogota();
    const direction = payload.direction ?? "expense";

    // Direction supplies the one-sided account; the type is derived from it.
    const fromAccountId = direction === "expense" ? accountId : null;
    const toAccountId = direction === "income" ? accountId : null;
    const description = proposal.description === "" ? null : proposal.description;

    try {
      // A savepoint, so a duplicate's unique violation rolls back to a point the
      // outer transaction survives — a bare error would abort it and block the
      // read-back below.
      const { transactionId } = await tx.transaction((sp) =>
        insertTransaction(sp, {
          fromAccountId,
          toAccountId,
          amountCents,
          occurredAt,
          description,
          splits: [{ categoryId, amountCents }],
          labelIds: [],
          externalRef: payload.external_ref,
        }),
      );

      return { transactionId, duplicate: false };
    } catch (error) {
      const code = pgErrorCode(error);

      // The per-scope `external_ref` unique index: the movement already exists,
      // so read it back and report the duplicate rather than write a second one.
      if (code === "23505") {
        const existing = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.externalRef, payload.external_ref))
          .limit(1);

        if (existing[0]) {
          return { transactionId: existing[0].id, duplicate: true };
        }
        throw new WebhookIngestError("unexpected");
      }

      // A category-kind-vs-direction or scope-mismatch check (23514) and a write
      // outside the impersonated user's writable scope (42501) both read as a
      // scope refusal; no raw pg text escapes.
      if (code === "23514" || code === "42501") {
        throw new WebhookIngestError("scope");
      }

      throw new WebhookIngestError("unexpected");
    }
  });
}
