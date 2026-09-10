import "server-only";

// Field names checked live 2026-09-10 against
// `GET /v1/images/?q=umbrella&page_size=2&license=by,by-sa,cc0,pdm`, no key
// required: `results[].thumbnail`, `results[].url`, `results[].creator`,
// `results[].license` (a lowercase code, e.g. "by"), `results[].license_url`,
// `results[].foreign_landing_url` (the page to credit, not the raw asset),
// `results[].width`, `results[].height`.
const OPENVERSE_ENDPOINT = "https://api.openverse.org/v1/images/";
const LICENCES = "by,by-sa,cc0,pdm";
// Five candidates, not one: a result can point at a dead thumbnail
// (`abeyance`, HTTP 424 — docs/TRAPS.md). Measured over 60 words with this
// count: 93.3% download, and the first candidate served every time there
// was one at all.
const CANDIDATE_COUNT = 5;
const USER_AGENT = "voyager-word-photo/1.0 (+https://github.com/WAB-Studio/finances-app)";

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
    response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  } catch {
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
// entry does not cost a candidate that would otherwise have downloaded.
export async function downloadCandidate(candidate: OpenverseCandidate): Promise<DownloadedImage | null> {
  if (candidate.thumbnail) {
    const fromThumbnail = await downloadOne(candidate.thumbnail);
    if (fromThumbnail) return fromThumbnail;
  }
  return downloadOne(candidate.url);
}
