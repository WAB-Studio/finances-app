import "server-only";

import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { WordPhotoRow } from "@/db/schema";
import { MANIFEST_PATH, manifestSchema, normaliseHeadword, type DictionaryPayload } from "@/lib/dictionary/format";
import { env } from "@/lib/env";
import type { OpenverseLicence } from "@/lib/word/openverse";

import concretenessCorpus from "./concreteness.generated.json";

// --- The dictionary gate -----------------------------------------------
//
// The closed list of headwords is the only thing bounding the bill: an
// anonymous route that fires a paid/bandwidth call on arbitrary text is how
// someone inflates it. Loaded once per server process from the same static
// asset the client installs, never from a pass through `reading`.

let headwordsPromise: Promise<ReadonlySet<string>> | null = null;

async function loadHeadwords(): Promise<ReadonlySet<string>> {
  const manifestFsPath = path.join(process.cwd(), "public", ...MANIFEST_PATH.split("/").filter(Boolean));
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestFsPath, "utf8")));
  const assetFsPath = path.join(process.cwd(), "public", ...manifest.asset.path.split("/").filter(Boolean));
  const payload = JSON.parse(await readFile(assetFsPath, "utf8")) as DictionaryPayload;
  return new Set(payload.entries.map((entry) => normaliseHeadword(entry[0])));
}

export async function isDictionaryHeadword(normalisedHeadword: string): Promise<boolean> {
  headwordsPromise ??= loadHeadwords();
  const headwords = await headwordsPromise;
  return headwords.has(normalisedHeadword);
}

// --- The concreteness gate ------------------------------------------------
//
// RL-36 asks for a *concrete noun*, not any dictionary headword: bundled at
// build time (`scripts/build-concreteness.ts`), never read from disk per
// request, so the check that must run before Openverse is a Set lookup, not
// a second file read. Every entry here already passed the dictionary gate
// above — the generator built it from the same asset — so this replaces
// that check for the photo route rather than adding to it.
const PHOTOGRAPHABLE_HEADWORDS: ReadonlySet<string> = new Set(concretenessCorpus.headwords);

export function isPhotographableHeadword(normalisedHeadword: string): boolean {
  return PHOTOGRAPHABLE_HEADWORDS.has(normalisedHeadword);
}

// --- reading.word_photos and reading.model_spend -------------------------
//
// Raw SQL, not the query builder: an upsert with an arithmetic `set` and a
// schema-qualified table, the same shape `apps/orbit/db/queries/webhook-ingest.ts`
// already uses for the one case the builder does not fit well.

export async function getCachedPhoto(headword: string): Promise<WordPhotoRow | null> {
  const rows = await db.execute<WordPhotoRow>(sql`
    select headword, status, object_path as "objectPath", width, height, author, licence,
           licence_url as "licenceUrl", source_url as "sourceUrl", resolved_at as "resolvedAt"
    from reading.word_photos
    where headword = ${headword}
  `);
  return rows[0] ?? null;
}

// Claims one unit of the day's photo quota before anyone is called, so a
// crash mid-ingestion still costs a slot instead of going uncounted.
export async function claimPhotoQuota(): Promise<number> {
  const [row] = await db.execute<{ photos: number }>(sql`
    insert into reading.model_spend (day, photos)
    values (current_date, 1)
    on conflict (day) do update set photos = reading.model_spend.photos + 1
    returning photos
  `);
  return row.photos;
}

export type FoundPhoto = {
  headword: string;
  objectPath: string;
  width: number;
  height: number;
  author: string;
  licence: OpenverseLicence;
  licenceUrl: string;
  sourceUrl: string;
};

// `on conflict do update`, never a plain insert: two readers can race a cold
// word and both pay for the ingest, and the last write standing is fine — no
// lock is worth adding for a cent (plan's own call).
export async function writeFoundPhoto(photo: FoundPhoto): Promise<void> {
  await db.execute(sql`
    insert into reading.word_photos
      (headword, status, object_path, width, height, author, licence, licence_url, source_url)
    values
      (${photo.headword}, 'found', ${photo.objectPath}, ${photo.width}, ${photo.height},
       ${photo.author}, ${photo.licence}, ${photo.licenceUrl}, ${photo.sourceUrl})
    on conflict (headword) do update set
      status = 'found', object_path = excluded.object_path, width = excluded.width,
      height = excluded.height, author = excluded.author, licence = excluded.licence,
      licence_url = excluded.licence_url, source_url = excluded.source_url,
      resolved_at = now()
  `);
}

export async function writeNonePhoto(headword: string): Promise<void> {
  await db.execute(sql`
    insert into reading.word_photos (headword, status)
    values (${headword}, 'none')
    on conflict (headword) do update set
      status = 'none', object_path = null, width = null, height = null,
      author = null, licence = null, licence_url = null, source_url = null,
      resolved_at = now()
  `);
}

// --- Supabase Storage, over its S3-compatible endpoint --------------------
//
// One S3-scoped access key, never `service_role` (the narrowed RNL-10 rule
// in `lib/env.ts`): this file is the one place it is read, and it never
// builds a client that touches the `reading` schema. No AWS SDK is
// installed (§4 does not list one), so the SigV4 signature below is hand
// rolled — four HMAC-SHA256 calls and a canonical request, nothing more.

type StorageConfig = {
  endpoint: URL;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export function isStorageConfigured(): boolean {
  return (
    env.SUPABASE_STORAGE_S3_ENDPOINT !== undefined &&
    env.SUPABASE_STORAGE_S3_REGION !== undefined &&
    env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID !== undefined &&
    env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY !== undefined &&
    env.SUPABASE_STORAGE_BUCKET !== undefined
  );
}

function storageConfig(): StorageConfig | null {
  if (!isStorageConfigured()) return null;
  return {
    endpoint: new URL(env.SUPABASE_STORAGE_S3_ENDPOINT!),
    region: env.SUPABASE_STORAGE_S3_REGION!,
    accessKeyId: env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID!,
    secretAccessKey: env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY!,
    bucket: env.SUPABASE_STORAGE_BUCKET!,
  };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

// AWS's own percent-encoding, byte by byte: `encodeURIComponent` leaves
// `!'()*` untouched, which SigV4's canonical request does not allow.
function awsUriEncode(input: string, encodeSlash: boolean): string {
  let out = "";
  for (const byte of Buffer.from(input, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(ch)) out += ch;
    else if (ch === "/" && !encodeSlash) out += ch;
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

async function signedS3Request(
  config: StorageConfig,
  method: "GET" | "PUT" | "DELETE",
  key: string,
  body: Buffer | null,
  contentType: string | null,
): Promise<Response> {
  const objectPath = `${config.endpoint.pathname}/${config.bucket}/${awsUriEncode(key, false)}`.replace(
    /\/{2,}/g,
    "/",
  );
  const host = config.endpoint.host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));

  const headersToSign: [string, string][] = [
    ["host", host],
    ["x-amz-content-sha256", payloadHash],
    ["x-amz-date", amzDate],
  ];
  if (contentType) headersToSign.push(["content-type", contentType]);
  headersToSign.sort(([a], [b]) => a.localeCompare(b));
  const canonicalHeaders = headersToSign.map(([name, value]) => `${name}:${value}\n`).join("");
  const signedHeaders = headersToSign.map(([name]) => name).join(";");

  const canonicalRequest = [method, objectPath, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(config.secretAccessKey, dateStamp, config.region), stringToSign).toString("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    authorization,
  };
  if (contentType) headers["content-type"] = contentType;

  // `Buffer`'s type param does not line up with `BodyInit`'s `Uint8Array`
  // overload under this Node types version; the bytes underneath are the
  // same either way.
  return fetch(`${config.endpoint.origin}${objectPath}`, {
    method,
    headers,
    body: body as BodyInit | undefined,
  });
}

export async function putPhotoObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const config = storageConfig();
  if (!config) throw new Error("Storage is not configured");
  const response = await signedS3Request(config, "PUT", key, bytes, contentType);
  if (!response.ok) throw new Error(`S3 PUT answered ${response.status}`);
}

// Idempotent: a 404 here means the object is already gone, which is the
// outcome the caller wanted anyway.
export async function deletePhotoObject(key: string): Promise<void> {
  const config = storageConfig();
  if (!config) return;
  const response = await signedS3Request(config, "DELETE", key, null, null);
  if (!response.ok && response.status !== 404) throw new Error(`S3 DELETE answered ${response.status}`);
}

export async function getPhotoObject(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const config = storageConfig();
  if (!config) return null;
  const response = await signedS3Request(config, "GET", key, null, null);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`S3 GET answered ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, contentType };
}
