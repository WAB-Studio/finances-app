import { z } from "zod";

import { env } from "@/lib/env";
import type { TranslationResult } from "@/lib/translate/types";

// The word path never reaches this route (RL-09): it exists for the sentence
// path alone, and only when the device offers no translator of its own.
export const dynamic = "force-dynamic";

// Shared with `network.ts`, so the body a `fetch` sends is exactly the body
// this handler accepts — one schema, not two hand-kept in sync.
export const translateRequestSchema = z.object({
  text: z.string().min(1).max(1000),
});

// MyMemory's endpoint and language pair, the one constant a provider swap
// touches. English to Spanish is fixed for this slice; direction is not a
// parameter the route accepts.
const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";

type MyMemoryResponse = {
  responseData?: { translatedText?: string };
};

// The one function a provider swap replaces. MyMemory's anonymous tier caps
// at roughly 5,000 words a day per caller IP (10,000 once `de` names a
// registered email); past that cap it still answers 200 with a warning
// string instead of an HTTP error, so an empty or missing translation is
// treated the same as a transport failure — the client only ever sees a
// generic 502, never a rate-limit message to parse.
async function translateWithProvider(text: string): Promise<string> {
  const params = new URLSearchParams({ q: text, langpair: "en|es" });
  if (env.TRANSLATE_MYMEMORY_EMAIL) params.set("de", env.TRANSLATE_MYMEMORY_EMAIL);
  if (env.TRANSLATE_MYMEMORY_KEY) params.set("key", env.TRANSLATE_MYMEMORY_KEY);

  const response = await fetch(`${MYMEMORY_ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    throw new Error("MyMemory responded with an error status");
  }

  const payload = (await response.json()) as MyMemoryResponse;
  const translated = payload.responseData?.translatedText;
  if (typeof translated !== "string" || translated.length === 0) {
    throw new Error("MyMemory returned no translation");
  }
  return translated;
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const parsed = translateRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  try {
    const text = await translateWithProvider(parsed.data.text);
    const result: TranslationResult = { text, origin: "network" };
    return Response.json(result, { status: 200 });
  } catch {
    return Response.json({ error: "provider" }, { status: 502 });
  }
}
