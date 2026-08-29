import { z } from "zod";

import {
  ingestWebhookMovement,
  WebhookIngestError,
} from "@/db/queries/webhook-ingest";
import { resolveWebhookCredential } from "@/db/queries/webhook-credentials";
import { webhookPayloadSchema } from "@/lib/validation/webhook";

// The caller is iPhone Shortcuts or a bridge, never the app UI; runs on Node
// (the resolver and ingest are server-only) and re-authenticates every hit.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BEARER_PREFIX = "Bearer ";

/**
 * The webhook entry point (RF-86). Authenticates a bearer credential, applies
 * its throttle, validates the JSON body and runs the ingest — every DB refusal
 * is mapped to a status code with no raw pg text in the body. The write runs as
 * the resolved owner inside `ingestWebhookMovement`; nothing from the payload
 * ever names the user.
 */
export async function POST(request: Request): Promise<Response> {
  // An unknown, revoked or absent token all read identically: a generic 401.
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = header.slice(BEARER_PREFIX.length);

  // Resolve and throttle before parsing, so an unauthorized or over-limit
  // caller is rejected without the cost of reading the body.
  const cred = await resolveWebhookCredential(token);
  if (cred === null) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (cred.throttled) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = webhookPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_payload", fields: z.flattenError(parsed.error).fieldErrors },
      { status: 422 },
    );
  }

  try {
    const result = await ingestWebhookMovement({
      ownerUserId: cred.ownerUserId,
      defaultAccountId: cred.defaultAccountId,
      defaultCategoryId: cred.defaultCategoryId,
      payload: parsed.data,
    });

    // A duplicate `external_ref` is a 200: the delivery is idempotent, not an
    // error, and no second movement was written.
    return Response.json(
      { transactionId: result.transactionId, duplicate: result.duplicate },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof WebhookIngestError) {
      // The reason is a stable code the caller can branch on; never pg text.
      switch (error.reason) {
        case "missing_account":
        case "missing_category":
        case "bad_amount":
          return Response.json({ error: error.reason }, { status: 422 });
        case "scope":
          return Response.json({ error: "scope" }, { status: 403 });
        default:
          break;
      }
    }

    console.error("webhook ingest failed", {
      credentialOwner: cred.ownerUserId,
    });
    return Response.json({ error: "unexpected" }, { status: 500 });
  }
}
