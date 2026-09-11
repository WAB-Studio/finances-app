import "server-only";

// Field names checked live 2026-09-10 against
// `GET /v1/images/?q=umbrella&page_size=2&license=by,by-sa,cc0,pdm`, no key
// required: `results[].thumbnail`, `results[].url`, `results[].creator`,
// `results[].license` (a lowercase code, e.g. "by"), `results[].license_url`,
// `results[].foreign_landing_url` (the page to credit, not the raw asset),
// `results[].width`, `results[].height`.
// `OPENVERSE_ENDPOINT_OVERRIDE` is read nowhere else and named in no
// `vercel.json` — the same shape as `VOYAGER_E2E_HOOKS` (`next.config.ts`,
// `app/layout.tsx`) — so a real build never sees it set and always calls
// Openverse. `scripts/check-decoration.ts`'s T17 is the one reader: it
// points this at a local stub that never answers, to prove the deadline
// below fires without waiting on, or paying, the real Openverse.
const OPENVERSE_ENDPOINT = process.env.OPENVERSE_ENDPOINT_OVERRIDE ?? "https://api.openverse.org/v1/images/";
const LICENCES = "by,by-sa,cc0,pdm";
// Five candidates, not one: a result can point at a dead thumbnail
// (`abeyance`, HTTP 424 — docs/TRAPS.md). Measured over 60 words with this
// count: 93.3% download, and the first candidate served every time there
// was one at all.
const CANDIDATE_COUNT = 5;
const USER_AGENT = "voyager-word-photo/1.0 (+https://github.com/WAB-Studio/finances-app)";

// RL-36: "the image never blocks or delays the answer" — the reader is
// waiting on a decoration, not on the dictionary answer already on the
// device. 5 s is generous for a JSON search or a sub-512 KB image and still
// short enough that a slow or unreachable host never repeats the 61 s hang
// measured against this endpoint with no deadline at all.
const OPENVERSE_TIMEOUT_MS = 5_000;

// `AbortSignal.timeout` rejects the fetch with a `DOMException` named
// "TimeoutError" (WHATWG spec) — this is the one check that tells that
// apart from a real 4xx/5xx, a DNS failure or a dropped connection.
export function isOpenverseTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

// A Openverse "thumbnail" carries no size guarantee — median 44,117 B, p90
// 154,415 B, one measured at 5,338,962 B (docs/TRAPS.md). Reject past this
// and move to the next candidate; never shrink a file after it is uploaded.
export const MAX_PHOTO_BYTES = 512 * 1024;

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type OpenverseLicence = "by" | "by-sa" | "cc0" | "pdm";
const KNOWN_LICENCES: ReadonlySet<string> = new Set(["by", "by-sa", "cc0", "pdm"]);

type OpenverseResult = {
  thumbnail?: unknown;
  url?: unknown;
  creator?: unknown;
  license?: unknown;
  license_url?: unknown;
  foreign_landing_url?: unknown;
  width?: unknown;
  height?: unknown;
};

export type OpenverseCandidate = {
  thumbnail: string | null;
  url: string;
  author: string;
  licence: OpenverseLicence;
  licenceUrl: string;
  sourceUrl: string;
  width: number;
  height: number;
};

// A result missing any of the fields the credit list or the check constraint
// on `word_photos` requires is treated as no result at all — an unnamed
// author cannot be re-served under CC BY/BY-SA in `/cuenta`.
function toCandidate(result: OpenverseResult): OpenverseCandidate | null {
  const { thumbnail, url, creator, license, license_url, foreign_landing_url, width, height } = result;
  if (
    typeof url !== "string" ||
    typeof creator !== "string" ||
    creator.length === 0 ||
    typeof license !== "string" ||
    !KNOWN_LICENCES.has(license) ||
    typeof license_url !== "string" ||
    typeof foreign_landing_url !== "string" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return {
    thumbnail: typeof thumbnail === "string" ? thumbnail : null,
    url,
    author: creator,
    licence: license as OpenverseLicence,
    licenceUrl: license_url,
    sourceUrl: foreign_landing_url,
    width,
    height,
  };
}

export async function searchOpenverse(headword: string): Promise<OpenverseCandidate[]> {
  const params = new URLSearchParams({
    q: headword,
    page_size: String(CANDIDATE_COUNT),
    license: LICENCES,
  });
  const response = await fetch(`${OPENVERSE_ENDPOINT}?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(OPENVERSE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Openverse search answered ${response.status}`);
  const payload = (await response.json()) as { results?: OpenverseResult[] };
  const results = Array.isArray(payload.results) ? payload.results : [];
  return results.map(toCandidate).filter((candidate): candidate is OpenverseCandidate => candidate !== null);
}

export type DownloadedImage = { bytes: Buffer; contentType: string; ext: string };

async function downloadOne(url: string): Promise<DownloadedImage | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(OPENVERSE_TIMEOUT_MS),
    });
  } catch (error) {
    // The deadline expiring is not evidence this image is missing, only
    // that this attempt was too slow: rethrown so the caller can tell it
    // apart from a confirmed failure (dead host, bad TLS, refused
    // connection), which still reads as "no image" here.
    if (isOpenverseTimeout(error)) throw error;
    return null;
  }
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const ext = ALLOWED_CONTENT_TYPES[contentType];
  if (!ext) return null;
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_PHOTO_BYTES) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_PHOTO_BYTES) return null;
  return { bytes: buffer, contentType, ext };
}

// Tries the thumbnail first, then the full-size asset, so one dead proxy
// entry does not cost a candidate that would otherwise have downloaded. A
// timed-out thumbnail skips straight to the caller rather than trying the
// full-size asset too: the same slow host is unlikely to answer faster for
// a bigger file, and the caller still has every other candidate to try.
export async function downloadCandidate(candidate: OpenverseCandidate): Promise<DownloadedImage | null> {
  if (candidate.thumbnail) {
    const fromThumbnail = await downloadOne(candidate.thumbnail);
    if (fromThumbnail) return fromThumbnail;
  }
  return downloadOne(candidate.url);
}
