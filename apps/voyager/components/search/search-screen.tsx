"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { classify, PHRASE_MAX_TOKENS, PHRASE_MIN_TOKENS, type QueryKind } from "@/lib/query/classify";
import { normaliseHeadword } from "@/lib/dictionary/format";
import { useDictionary } from "@/lib/dictionary/use-dictionary";
import type { WordAnswer } from "@/lib/dictionary/lookup";
import { deviceTranslatorState, type TranslatorState } from "@/lib/translate/availability";
import { enableDeviceTranslator, translateOnDevice } from "@/lib/translate/on-device";
import { translateOverNetwork } from "@/lib/translate/network";
import type { TranslationResult } from "@/lib/translate/types";
import { flushPendingLookup, recordLookup } from "@/lib/log/record";
import type { LookupOutcome, LookupRecord } from "@/lib/log/types";
import { Flex, Text } from "@/components/ui";
import { InstallStatus } from "./install-status";
import { PhraseAnswer, type DeviceOffer, type PhraseState } from "./phrase-answer";
import { SearchBox } from "./search-box";
import { SenseList } from "./sense-list";
import { SourceNote } from "./source-note";
import { Suggestions } from "./suggestions";

// RNL-05, rule 1: how long the box waits for a pause before a sentence is
// worth asking about at all.
const PHRASE_DEBOUNCE_MS = 600;

// RL-18: how long autocomplete stays up after the last keystroke before it
// withdraws. The word answer itself is never held for this — only the list.
const SUGGESTIONS_SETTLE_MS = 900;

// RNL-05, rule 3: how many translated sentences stay free to revisit.
const PHRASE_CACHE_LIMIT = 20;

type LogPayload = Omit<LookupRecord, "id" | "schema">;

// Cut, never truncated silently past the point RL-36's list can hold — the
// module 27 wire schema and the row this fills both agree on the same 120.
const TRANSLATION_MAX_CHARS = 120;
const TRANSLATION_MAX_SENSES = 3;

function cutTranslation(text: string): string {
  return text.slice(0, TRANSLATION_MAX_CHARS);
}

// The first sense of the same group `headword` already comes from — at most
// its first three translations, joined the way `SenseCard` lists them.
function formatSenseTranslations(translations: readonly string[]): string {
  return cutTranslation(translations.slice(0, TRANSLATION_MAX_SENSES).join(", "));
}

function wordLogPayload(text: string, answer: WordAnswer, dictionaryReady: boolean): LogPayload {
  const hit = answer.viaInflection[0] ?? null;
  const outcome: LookupOutcome = answer.exact ? "exact" : hit ? "inflected" : "miss";
  const group = answer.exact ?? hit?.group ?? null;
  return {
    at: Date.now(),
    text,
    normalised: normaliseHeadword(text),
    kind: "word",
    outcome,
    headword: answer.exact ? answer.exact.headword : (hit?.group.headword ?? null),
    rule: hit ? hit.rule : null,
    senses: group?.senses.length ?? 0,
    translation: group ? formatSenseTranslations(group.senses[0]?.translations ?? []) : null,
    dictionaryReady,
    origin: null,
  };
}

function phraseLogPayload(
  text: string,
  dictionaryReady: boolean,
  outcome: Extract<LookupOutcome, "translated" | "untranslated">,
  origin: TranslationResult["origin"] | null,
  translation: string | null,
): LogPayload {
  return {
    at: Date.now(),
    text,
    normalised: normaliseHeadword(text),
    kind: "phrase",
    outcome,
    headword: null,
    rule: null,
    senses: 0,
    translation: translation === null ? null : cutTranslation(translation),
    dictionaryReady,
    origin,
  };
}

function trimPhraseCache(cache: Map<string, TranslationResult>): void {
  while (cache.size > PHRASE_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

export function SearchScreen() {
  const tSearch = useTranslations("search");
  const { status, lookup, suggest, has, retry } = useDictionary();

  const [text, setText] = useState("");
  const [kind, setKind] = useState<QueryKind>({ kind: "empty" });
  const [wordAnswer, setWordAnswer] = useState<WordAnswer | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // RL-18: the list is withdrawn once typing settles; the data behind it
  // stays put so a fresh keystroke can bring it straight back.
  const [suggestionsWithdrawn, setSuggestionsWithdrawn] = useState(false);
  const [phraseState, setPhraseState] = useState<PhraseState>({ kind: "idle" });
  const [deviceOffer, setDeviceOffer] = useState<DeviceOffer>({ kind: "hidden" });
  const [logPayload, setLogPayload] = useState<LogPayload | null>(null);

  // The text a resolved promise checks itself against: an answer for
  // anything else was superseded before it arrived, and is dropped.
  const latestTextRef = useRef("");
  const phraseDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phraseAbortRef = useRef<AbortController | null>(null);
  const phraseCacheRef = useRef(new Map<string, TranslationResult>());
  // Read once per open (RL-08); routing for every phrase after that reads
  // this instead of asking the browser again.
  const initialDeviceStateRef = useRef<TranslatorState | null>(null);
  const deviceReadyRef = useRef(false);

  // The call site the log's fields are true to: an effect fires after React
  // has already committed the answer, never inside the path that produced it.
  useEffect(() => {
    if (logPayload) recordLookup(logPayload);
  }, [logPayload]);

  useEffect(() => {
    return () => {
      if (suggestionsSettleRef.current) clearTimeout(suggestionsSettleRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await deviceTranslatorState();
      if (cancelled) return;
      initialDeviceStateRef.current = state;
      // The model is already on the device: creating it costs no download,
      // so no gesture is owed (RL-11's one exception).
      if (state === "available") {
        try {
          await enableDeviceTranslator();
          if (!cancelled) deviceReadyRef.current = true;
        } catch {
          // Falls back to the network path like any other unready state.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function translatePhrase(phraseText: string, dictionaryReady: boolean): Promise<void> {
    const controller = new AbortController();
    phraseAbortRef.current = controller;
    setPhraseState({ kind: "translating" });

    try {
      let result: TranslationResult;
      if (deviceReadyRef.current) {
        try {
          result = await translateOnDevice(phraseText, { signal: controller.signal });
        } catch {
          // A superseded request stops here too: nothing left to fall back to.
          if (controller.signal.aborted) return;
          result = await translateOverNetwork(phraseText, { signal: controller.signal });
        }
      } else {
        result = await translateOverNetwork(phraseText, { signal: controller.signal });
        const initial = initialDeviceStateRef.current;
        if (initial === "downloadable" || initial === "downloading") {
          setDeviceOffer((current) => (current.kind === "downloading" ? current : { kind: "offered" }));
        }
      }

      if (controller.signal.aborted) return;
      phraseCacheRef.current.set(normaliseHeadword(phraseText), result);
      trimPhraseCache(phraseCacheRef.current);
      setPhraseState({ kind: "done", result });
      setLogPayload(phraseLogPayload(phraseText, dictionaryReady, "translated", result.origin, result.text));
    } catch {
      if (controller.signal.aborted) return;
      setPhraseState({ kind: "failed" });
      setLogPayload(phraseLogPayload(phraseText, dictionaryReady, "untranslated", null, null));
    } finally {
      if (phraseAbortRef.current === controller) phraseAbortRef.current = null;
    }
  }

  function schedulePhrase(phraseText: string, tokens: number, dictionaryReady: boolean): void {
    if (tokens < PHRASE_MIN_TOKENS || tokens > PHRASE_MAX_TOKENS) {
      setPhraseState({ kind: "waiting" });
      return;
    }

    // RNL-05, rule 3: a text already translated costs nothing and issues
    // nothing, however far back the box was cleared to reach it.
    const cached = phraseCacheRef.current.get(normaliseHeadword(phraseText));
    if (cached) {
      setPhraseState({ kind: "done", result: cached });
      setLogPayload(phraseLogPayload(phraseText, dictionaryReady, "translated", cached.origin, cached.text));
      return;
    }

    setPhraseState({ kind: "waiting" });
    phraseDebounceRef.current = setTimeout(() => {
      phraseDebounceRef.current = null;
      void translatePhrase(phraseText, dictionaryReady);
    }, PHRASE_DEBOUNCE_MS);
  }

  async function runQuery(queryText: string, dictionaryReady: boolean): Promise<void> {
    const exists = await has(queryText).catch(() => false);
    if (latestTextRef.current !== queryText) return;

    const nextKind = classify(queryText, () => exists);
    setKind(nextKind);

    if (nextKind.kind === "empty") {
      setWordAnswer(null);
      setSuggestions([]);
      setPhraseState({ kind: "idle" });
      // The guard has no other way to learn the box was abandoned mid-word.
      flushPendingLookup();
      return;
    }

    if (nextKind.kind === "word") {
      setPhraseState({ kind: "idle" });
      setWordAnswer(null);
      setSuggestions([]);
      const [answer, items] = await Promise.all([
        lookup(queryText).catch(() => null),
        suggest(queryText, 10).catch(() => [] as string[]),
      ]);
      if (latestTextRef.current !== queryText || !answer) return;
      setWordAnswer(answer);
      setSuggestions(items);
      setLogPayload(wordLogPayload(queryText, answer, dictionaryReady));
      return;
    }

    setWordAnswer(null);
    setSuggestions([]);
    schedulePhrase(queryText, nextKind.tokens, dictionaryReady);
  }

  function handleTextChange(nextText: string): void {
    setText(nextText);
    latestTextRef.current = nextText;
    const dictionaryReady = status.state === "ready";

    // Any keystroke supersedes whatever the phrase path was waiting on or
    // had already sent (RNL-05, rule 4).
    if (phraseDebounceRef.current) {
      clearTimeout(phraseDebounceRef.current);
      phraseDebounceRef.current = null;
    }
    phraseAbortRef.current?.abort();
    phraseAbortRef.current = null;

    // RL-18: a keystroke brings a withdrawn list straight back, and restarts
    // the pause the list is waiting out.
    if (suggestionsSettleRef.current) {
      clearTimeout(suggestionsSettleRef.current);
    }
    setSuggestionsWithdrawn(false);
    suggestionsSettleRef.current = setTimeout(() => {
      suggestionsSettleRef.current = null;
      setSuggestionsWithdrawn(true);
    }, SUGGESTIONS_SETTLE_MS);

    void runQuery(nextText, dictionaryReady);
  }

  async function handleEnableDevice(): Promise<void> {
    setDeviceOffer({ kind: "downloading", fraction: null });
    try {
      await enableDeviceTranslator({
        onDownloadProgress: (fraction) => setDeviceOffer({ kind: "downloading", fraction }),
      });
      deviceReadyRef.current = true;
      setDeviceOffer({ kind: "hidden" });
    } catch {
      setDeviceOffer({ kind: "offered" });
    }
  }

  function handlePhraseRetry(): void {
    void translatePhrase(text, status.state === "ready");
  }

  return (
    <Flex direction="column" gap="5">
      <Flex direction="column" gap="2">
        <SearchBox value={text} onChange={handleTextChange} />
        <InstallStatus status={status} onRetry={retry} />
      </Flex>

      {kind.kind === "empty" && (
        <Text size="2" color="gray">
          {tSearch("empty")}
        </Text>
      )}

      {kind.kind === "word" && (
        <Flex direction="column" gap="4">
          <Suggestions items={suggestionsWithdrawn ? [] : suggestions} onPick={handleTextChange} />
          {wordAnswer && <SenseList answer={wordAnswer} />}
        </Flex>
      )}

      {kind.kind === "phrase" && (
        <PhraseAnswer
          source={text}
          state={phraseState}
          offer={deviceOffer}
          onEnableDevice={handleEnableDevice}
          onRetry={handlePhraseRetry}
        />
      )}

      <SourceNote />
    </Flex>
  );
}
