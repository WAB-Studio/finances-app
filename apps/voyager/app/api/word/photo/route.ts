import "server-only";

import { normaliseHeadword } from "@/lib/dictionary/format";
import { env } from "@/lib/env";
import { PHOTO_ENDPOINT, photoRequestSchema, type WordPhoto } from "@/lib/word/protocol";
import { downloadCandidate, searchOpenverse } from "@/lib/word/openverse";
import {
  claimPhotoQuota,
  getCachedPhoto,
  getPhotoObject,
  isPhotographableHeadword,
  isStorageConfigured,
  putPhotoObject,
  writeFoundPhoto,
  writeNonePhoto,
  type FoundPhoto,
} from "@/lib/word/photo-cache";
import type { WordPhotoRow } from "@/db/schema";

// RL-36's decoration: never on the path RL-35 already guarantees. No session
// is asked for and nothing here answers with a session's data.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function absent(): Response {
  // Absence is one shape everywhere in this route: no photo, no connection,
  // a provider failure or the daily cap reached all answer the same way, so
  // the client draws exactly the screen it draws with no decoration at all.
  return new Response(null, { status: 204, headers: NO_STORE });
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function toWordPhoto(row: FoundPhoto): WordPhoto {
  return {
    // Served through this same route, never a bucket URL: the bucket is
    // private, and re-serving through our own host is the whole point of
    // RL-36's route — the image's host never sees who is asking.
    //
    // Relative on purpose. `next/image` treats any absolute URL as remote and
    // demands its host in `remotePatterns`, so an absolute same-origin URL is
    // refused with `"url" parameter is not allowed` and the photo never draws.
    // A relative path is also port-agnostic, which an absolute one built from
    // NEXT_PUBLIC_SITE_URL is not.
    url: `${PHOTO_ENDPOINT}?headword=${encodeURIComponent(row.headword)}`,
    width: row.width,
    height: row.height,
    author: row.author,
    licence: row.licence,
    licenceUrl: row.licenceUrl,
    sourceUrl: row.sourceUrl,
  };
}

// `word_photos_found_has_attribution` guarantees these four columns on any
// `found` row; the rest a `found` row this route ever writes always carries.
function fromRow(row: WordPhotoRow): FoundPhoto {
  return {
    headword: row.headword,
    objectPath: row.objectPath!,
    width: row.width!,
    height: row.height!,
    author: row.author!,
    licence: row.licence as FoundPhoto["licence"],
    licenceUrl: row.licenceUrl!,
    sourceUrl: row.sourceUrl!,
  };
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid" }, 400);
  }

  const parsed = photoRequestSchema.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid" }, 400);

  const headword = normaliseHeadword(parsed.data.headword);

  // RL-36 asks for a concrete noun, not any headword: a word absent from
  // this closed, pre-scored set never reaches Postgres or Openverse, so
  // this bounds the bill the way the dictionary check used to and answers
  // "no photo for you" without opening a connection either way.
  if (!isPhotographableHeadword(headword)) return absent();

  // Hot path: one round trip to Postgres, no outgoing request either way.
  const cached = await getCachedPhoto(headword);
  if (cached) {
    if (cached.status === "none") return absent();
    return json(toWordPhoto(fromRow(cached)), 200);
  }

  if (!isStorageConfigured()) return absent();

  // The cap is counted before anyone is called, never after: a crash
  // mid-ingestion still costs a slot rather than going uncounted.
  const spent = await claimPhotoQuota();
  if (env.WORD_PHOTO_DAILY_CAP !== undefined && spent > env.WORD_PHOTO_DAILY_CAP) return absent();

  let candidates;
  try {
    candidates = await searchOpenverse(headword);
  } catch {
    // A provider failure is not evidence the word has no photo: no row is
    // written, so a later request is free to try again.
    return absent();
  }

  if (candidates.length === 0) {
    await writeNonePhoto(headword);
    return absent();
  }

  for (const candidate of candidates) {
    const image = await downloadCandidate(candidate).catch(() => null);
    if (!image) continue;

    const objectPath = `${headword}.${image.ext}`;
    try {
      await putPhotoObject(objectPath, image.bytes, image.contentType);
    } catch {
      // The upload failed, not the search: worth retrying, so no row is
      // written for this word.
      return absent();
    }

    const found: FoundPhoto = {
      headword,
      objectPath,
      width: candidate.width,
      height: candidate.height,
      author: candidate.author,
      licence: candidate.licence,
      licenceUrl: candidate.licenceUrl,
      sourceUrl: candidate.sourceUrl,
    };
    await writeFoundPhoto(found);
    return json(toWordPhoto(found), 200);
  }

  // Every candidate's thumbnail and full-size asset either 424'd, failed the
  // content-type allowlist or blew the byte cap: a persistent absence, the
  // same outcome as an empty result set (docs/TRAPS.md: real coverage is
  // 93.3% of downloads, not 95.7% of results).
  await writeNonePhoto(headword);
  return absent();
}

// The bucket is private: bytes never leave through a Supabase URL, only
// through this route, keyed by the same headword the POST above resolves.
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = photoRequestSchema.safeParse({ headword: url.searchParams.get("headword") ?? "" });
  if (!parsed.success) return new Response(null, { status: 404, headers: NO_STORE });

  const headword = normaliseHeadword(parsed.data.headword);
  const row = await getCachedPhoto(headword);
  if (!row || row.status !== "found" || !row.objectPath) {
    return new Response(null, { status: 404, headers: NO_STORE });
  }

  const object = await getPhotoObject(row.objectPath).catch(() => null);
  if (!object) return new Response(null, { status: 404, headers: NO_STORE });

  return new Response(object.bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": object.contentType,
      // Immutable: a headword's found row never changes its bytes once
      // written, bar the rare double-ingest race the plan accepts as cheap.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
