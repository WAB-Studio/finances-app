/**
 * Drives `app/api/translate/route.ts`'s `POST` handler directly, with
 * `global.fetch` stubbed to answer as MyMemory does — never the real
 * endpoint, whose anonymous quota is shared and capped.
 *
 * Proves the one branch the route did not have: a reply identical to the
 * request, once folded, is refused exactly like an empty `translatedText`
 * or a quota warning already were. Every prior branch is re-run too, so
 * this file stands as the route's only regression cover, not only the new
 * line's.
 */
import { POST } from "../app/api/translate/route";

let failed = false;

function assert(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) failed = true;
}

type MyMemoryStub = { responseData?: { translatedText?: string }; responseStatus?: number | string };

function stubFetch(payload: MyMemoryStub, ok = true): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), { status: ok ? 200 : 500 })) as typeof fetch;
}

async function postTranslate(text: string): Promise<{ status: number; body: unknown }> {
  const request = new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const response = await POST(request);
  return { status: response.status, body: await response.json() };
}

async function main() {
  // A genuine translation still passes: the fold never touches two strings
  // that actually differ.
  stubFetch({ responseData: { translatedText: "Me fui de mi casa ayer" }, responseStatus: 200 });
  const genuine = await postTranslate("I left my house yesterday");
  assert(
    "a real translation still passes",
    genuine.status === 200 && (genuine.body as { text: string }).text === "Me fui de mi casa ayer",
    JSON.stringify(genuine),
  );

  // The defect as measured: gibberish MyMemory cannot place in either
  // language comes back unchanged, `responseStatus: "200"`, no warning.
  stubFetch({ responseData: { translatedText: "zzz qqq" }, responseStatus: 200 });
  const gibberish = await postTranslate("zzz qqq");
  assert("byte-identical gibberish is refused", gibberish.status === 502, JSON.stringify(gibberish));

  // Trim and case-fold: the comparison this route now makes. A reply that
  // differs from the request only in case or in outer whitespace answered
  // nothing either.
  stubFetch({ responseData: { translatedText: "  ZZZ   QQQ  " }, responseStatus: 200 });
  const foldedEcho = await postTranslate("zzz qqq");
  assert(
    "an echo that only differs in case or spacing is refused too",
    foldedEcho.status === 502,
    JSON.stringify(foldedEcho),
  );

  // The known cost: a name that legitimately holds still across English and
  // Spanish reads exactly like an echo, and is refused the same way. RL-37
  // hands this to the per-word breakdown instead of the network badge —
  // an honest "could not answer", not a wrong one.
  stubFetch({ responseData: { translatedText: "Harry Potter" }, responseStatus: 200 });
  const properNoun = await postTranslate("Harry Potter");
  assert(
    "a proper noun that translates to itself pays the same refusal (known cost)",
    properNoun.status === 502,
    JSON.stringify(properNoun),
  );

  // The two branches this route already had, both still standing.
  stubFetch({ responseData: { translatedText: "" }, responseStatus: 200 });
  const empty = await postTranslate("something to translate");
  assert("an empty translatedText is still refused", empty.status === 502, JSON.stringify(empty));

  stubFetch({ responseData: { translatedText: "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS" }, responseStatus: "160" });
  const quota = await postTranslate("something to translate");
  assert("a quota warning is still refused", quota.status === 502, JSON.stringify(quota));

  process.exit(failed ? 1 : 0);
}

void main();
