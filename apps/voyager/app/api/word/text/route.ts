import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { normaliseHeadword } from "@/lib/dictionary/format";
import type { DictionaryPayload } from "@/lib/dictionary/format";
import { buildIndex, groupFor, type DictionaryIndex } from "@/lib/dictionary/index-build";
import { env } from "@/lib/env";
import { generateWordText, MODEL_NAME } from "@/lib/word/model";
import { textRequestSchema, textResponseSchema } from "@/lib/word/protocol";
import { claimDailyCall } from "@/lib/word/spend";
import { readCachedText, writeCachedText } from "@/lib/word/text-cache";

// RL-41 and RL-42's decoration: no reader session reaches this route, the
// cache is keyed on the headword alone (`db/schema/word-texts.ts`), and its
// answer is never a candidate for the full route cache.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function empty(status: 204 | 400): Response {
  return new Response(null, { status, headers: NO_STORE });
}

const DICTIONARY_ASSET = path.join(
  process.cwd(),
  "public",
  "dictionary",
  "eng-spa-2025.11.23.json",
);

// Read once per server process — the same 64,258-entry asset the client
// installs. This is the closed list the route accepts: a headword absent
// from it never reaches the model, however the caller spells the body. An
// anonymous route that fired a paid call on arbitrary text is how someone
// would inflate the bill, so this check runs before the cache read, not
// just before the model call.
let dictionaryIndex: DictionaryIndex | null = null;

function loadDictionaryIndex(): DictionaryIndex {
  if (!dictionaryIndex) {
    const payload = JSON.parse(readFileSync(DICTIONARY_ASSET, "utf8")) as DictionaryPayload;
    dictionaryIndex = buildIndex(payload);
  }
  return dictionaryIndex;
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid" }, 400);
  }

  const parsed = textRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid" }, 400);
  }

  const headword = normaliseHeadword(parsed.data.headword);
  const group = groupFor(loadDictionaryIndex(), headword);
  if (!group) {
    return json({ error: "invalid" }, 400);
  }

  const cached = await readCachedText(headword);
  if (cached) {
    return json(
      textResponseSchema.parse({
        definition: parsed.data.needDefinition ? cached.definition : null,
        example: cached.example,
      }),
      200,
    );
  }

  // Absence is one shape everywhere: no key configured, no cap configured,
  // over the cap, a provider failure, or a generation that fails to
  // validate all answer `204`, the same "no connection" screen already
  // drawn (RL-35).
  if (!env.OPENAI_API_KEY || !env.WORD_TEXT_DAILY_CALL_CAP) {
    return empty(204);
  }

  const calls = await claimDailyCall();
  if (calls > env.WORD_TEXT_DAILY_CALL_CAP) {
    return empty(204);
  }

  // RL-41 fires only when every sense the group carries is definition-less:
  // one dictionary definition anywhere in the group is "already has one",
  // whatever the caller's own `needDefinition` claims.
  const entryLacksDefinition = group.senses.every((sense) => sense.definition === null);
  const wantDefinition = parsed.data.needDefinition && entryLacksDefinition;

  const generated = await generateWordText(headword, wantDefinition);
  if (!generated) {
    return empty(204);
  }

  const definition = wantDefinition ? generated.definition : null;
  await writeCachedText(headword, MODEL_NAME, definition, generated.example.en, generated.example.es);

  return json(
    textResponseSchema.parse({
      definition: parsed.data.needDefinition ? definition : null,
      example: generated.example,
    }),
    200,
  );
}
