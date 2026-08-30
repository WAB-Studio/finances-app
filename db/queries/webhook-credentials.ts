import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { webhookCredentials } from "@/db/schema";
import { withUserDb } from "@/db/session";

// The bearer a webhook presents, and the SHA-256 of it the row keeps. Only the
// hash is ever stored, so a raw token exists in exactly two places: this file's
// `issue` return and `resolve`'s input. It is shown once and never re-derivable.
function tokenHashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type IssueWebhookCredentialArgs = {
  name: string;
  defaultAccountId: string | null;
  defaultCategoryId: string | null;
  rateLimitPerMin?: number;
};

/**
 * Mint a credential and hand back its raw bearer once (RF-86). The token is a
 * `whk_`-prefixed base64url of 32 random bytes; only its hash lands in the row,
 * so this return is the single moment the plaintext exists. One round trip; the
 * owner is trigger-stamped from the session, never named here.
 */
export async function issueWebhookCredential({
  name,
  defaultAccountId,
  defaultCategoryId,
  rateLimitPerMin = 60,
}: IssueWebhookCredentialArgs): Promise<{ id: string; token: string }> {
  const token = `whk_${randomBytes(32).toString("base64url")}`;
  const tokenHash = tokenHashOf(token);

  return withUserDb(async (tx) => {
    const [row] = await tx
      .insert(webhookCredentials)
      // `owner_user_id` is stamped by the owner trigger and absent from the
      // INSERT grant; drizzle types it required, so the payload is cast past it.
      .values({
        name,
        tokenHash,
        defaultAccountId,
        defaultCategoryId,
        rateLimitPerMin,
      } as typeof webhookCredentials.$inferInsert)
      .returning({ id: webhookCredentials.id });

    return { id: row.id, token };
  });
}

export type WebhookCredentialRow = {
  id: string;
  name: string;
  defaultAccountId: string | null;
  defaultCategoryId: string | null;
  rateLimitPerMin: number;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

// The caller's own credentials, newest first. `token_hash` is never selected —
// it is not even granted to `authenticated` — so a leak has nothing to carry.
export async function listWebhookCredentials(): Promise<WebhookCredentialRow[]> {
  return withUserDb(async (tx) =>
    tx
      .select({
        id: webhookCredentials.id,
        name: webhookCredentials.name,
        defaultAccountId: webhookCredentials.defaultAccountId,
        defaultCategoryId: webhookCredentials.defaultCategoryId,
        rateLimitPerMin: webhookCredentials.rateLimitPerMin,
        lastUsedAt: webhookCredentials.lastUsedAt,
        revokedAt: webhookCredentials.revokedAt,
        createdAt: webhookCredentials.createdAt,
      })
      .from(webhookCredentials)
      .orderBy(desc(webhookCredentials.createdAt)),
  );
}

// Stamp the revocation; the affected-row count reports whether the owner policy
// admitted it (RF-85). A resolve past this point yields no row.
export async function revokeWebhookCredential({
  id,
}: {
  id: string;
}): Promise<boolean> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .update(webhookCredentials)
      .set({ revokedAt: sql`now()` })
      .where(eq(webhookCredentials.id, id))
      .returning({ id: webhookCredentials.id });

    return rows.length > 0;
  });
}

export type ResolvedWebhookCredential = {
  ownerUserId: string;
  defaultAccountId: string | null;
  defaultCategoryId: string | null;
  throttled: boolean;
};

/**
 * The identified-system read (RNF-04): resolve a raw token to its owner and
 * defaults over the BASE `db` connection, which connects as the resolver's
 * owner role — the only role that may execute it. No user session, no
 * `withUserDb`. The resolver returns no row for an unknown or revoked token,
 * and reports `throttled` so the route alone maps it to 429.
 */
export async function resolveWebhookCredential(
  token: string,
): Promise<ResolvedWebhookCredential | null> {
  const tokenHash = tokenHashOf(token);

  const rows = await db.execute<{
    owner_user_id: string;
    default_account_id: string | null;
    default_category_id: string | null;
    throttled: boolean;
  }>(
    sql`select owner_user_id, default_account_id, default_category_id, throttled
      from private.resolve_webhook_credential(${tokenHash})`,
  );

  const row = rows[0];
  if (!row) return null;

  return {
    ownerUserId: row.owner_user_id,
    defaultAccountId: row.default_account_id,
    defaultCategoryId: row.default_category_id,
    throttled: row.throttled,
  };
}
