/**
 * `reading.word_photos` has no expiry: every headword resolved before RL-36
 * gated the photo on concreteness still serves whatever Openverse returned
 * for the bare headword, `found` or `none` alike. This deletes every row
 * whose headword is not in the closed set `lib/word/photo-cache.ts` now
 * gates on — the bucket object too, for a `found` row — never the rest.
 *
 * Counts first, always. Deletes only with `--apply`; without it, this is a
 * dry run that touches nothing (AGENTS.md: "enseñe el número... y sólo
 * entonces las borre").
 *
 * `photo-cache.ts` starts with `import "server-only"`, which throws under
 * plain Node (no such package outside a Next build), so the S3 delete below
 * is its own small SigV4 call rather than a re-import — the same reason
 * `check-decoration.ts` and `check-sync.ts` open their own `postgres`
 * client instead of importing `db/client.ts`.
 */
import { createHash, createHmac } from "node:crypto";

import postgres from "postgres";

import concretenessCorpus from "../lib/word/concreteness.generated.json";

const APPLY = process.argv.includes("--apply");

const PHOTOGRAPHABLE_HEADWORDS: ReadonlySet<string> = new Set(concretenessCorpus.headwords);

const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
  connection: { search_path: "reading, public" },
});

function log(step: string): void {
  console.log(`[purge-unphotographable-photos] ${step}`);
}

// --- The minimum S3 DELETE this script needs, mirroring the SigV4 request
// `lib/word/photo-cache.ts` already signs for GET and PUT.

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function awsUriEncode(input: string): string {
  let out = "";
  for (const byte of Buffer.from(input, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(ch)) out += ch;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

type StorageConfig = {
  endpoint: URL;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

function storageConfig(): StorageConfig | null {
  const {
    SUPABASE_STORAGE_S3_ENDPOINT: endpoint,
    SUPABASE_STORAGE_S3_REGION: region,
    SUPABASE_STORAGE_S3_ACCESS_KEY_ID: accessKeyId,
    SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: secretAccessKey,
    SUPABASE_STORAGE_BUCKET: bucket,
  } = process.env;
  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { endpoint: new URL(endpoint), region, accessKeyId, secretAccessKey, bucket };
}

// Idempotent: a 404 already means the object is gone, the outcome this
// script wants anyway.
async function deleteBucketObject(config: StorageConfig, key: string): Promise<void> {
  const objectPath = `${config.endpoint.pathname}/${config.bucket}/${awsUriEncode(key)}`.replace(/\/{2,}/g, "/");
  const host = config.endpoint.host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(Buffer.alloc(0));

  const headersToSign: [string, string][] = [
    ["host", host],
    ["x-amz-content-sha256", payloadHash],
    ["x-amz-date", amzDate],
  ];
  headersToSign.sort(([a], [b]) => a.localeCompare(b));
  const canonicalHeaders = headersToSign.map(([name, value]) => `${name}:${value}\n`).join("");
  const signedHeaders = headersToSign.map(([name]) => name).join(";");

  const canonicalRequest = ["DELETE", objectPath, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(config.secretAccessKey, dateStamp, config.region), stringToSign).toString("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`${config.endpoint.origin}${objectPath}`, {
    method: "DELETE",
    headers: { "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, authorization },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`S3 DELETE ${key} answered ${response.status}`);
  }
}

type DoomedRow = { headword: string; status: string; object_path: string | null };

async function main() {
  const total = await sql<{ count: string }[]>`select count(*)::text as count from reading.word_photos`;
  log(`rows in reading.word_photos before: ${total[0]!.count}`);

  const rows = await sql<DoomedRow[]>`select headword, status, object_path from reading.word_photos`;
  const doomed = rows.filter((row) => !PHOTOGRAPHABLE_HEADWORDS.has(row.headword));
  const doomedFound = doomed.filter((row) => row.status === "found");
  const doomedNone = doomed.filter((row) => row.status === "none");

  log(`rows that no longer pass the guard: ${doomed.length} (found: ${doomedFound.length}, none: ${doomedNone.length})`);

  if (!APPLY) {
    log("dry run — pass --apply to delete. Nothing changed.");
    await sql.end();
    return;
  }

  if (doomedFound.length > 0) {
    const config = storageConfig();
    if (!config) {
      log("storage is not configured — skipping bucket cleanup, deleting rows only");
    } else {
      for (const row of doomedFound) {
        await deleteBucketObject(config, row.object_path!);
      }
      log(`deleted ${doomedFound.length} bucket object(s)`);
    }
  }

  if (doomed.length > 0) {
    const headwords = doomed.map((row) => row.headword);
    await sql`delete from reading.word_photos where headword in ${sql(headwords)}`;
  }

  const after = await sql<{ count: string }[]>`select count(*)::text as count from reading.word_photos`;
  log(`rows in reading.word_photos after: ${after[0]!.count}`);

  await sql.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
