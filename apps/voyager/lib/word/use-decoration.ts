"use client";

import { useEffect, useRef, useState } from "react";

import type { PhotoState } from "@/components/search/word-photo";
import type { GeneratedTextState as TextState } from "@/components/search/generated-text";
import { PHRASE_DEBOUNCE_MS } from "@/lib/query/settle";
import { rememberCredit } from "./credits-store";
import { PHOTO_ENDPOINT, TEXT_ENDPOINT, photoResponseSchema, textResponseSchema } from "./protocol";

type Decoration = { photo: PhotoState; text: TextState };

const ABSENT: Decoration = { photo: { kind: "absent" }, text: { kind: "absent" } };
const PENDING: Decoration = { photo: { kind: "pending" }, text: { kind: "pending" } };

// One entry per headword for the tab's whole life (RL-35, RL-41: resolved
// "the first time someone looks that word up", never once per mount). A
// second visit to the same word in this tab reads straight from here.
const cache = new Map<string, Decoration>();

async function fetchPhoto(headword: string, signal: AbortSignal): Promise<PhotoState> {
  try {
    const response = await fetch(PHOTO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headword }),
      signal,
    });
    if (response.status !== 200) return { kind: "absent" };
    const photo = photoResponseSchema.parse(await response.json());
    return { kind: "resolved", photo };
  } catch {
    // 204, a network error and a body that fails validation all land here:
    // the reader never sees a message, a retry or an alarm for a photo.
    return { kind: "absent" };
  }
}

async function fetchText(headword: string, needDefinition: boolean, signal: AbortSignal): Promise<TextState> {
  try {
    const response = await fetch(TEXT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headword, needDefinition }),
      signal,
    });
    if (response.status !== 200) return { kind: "absent" };
    const text = textResponseSchema.parse(await response.json());
    return { kind: "resolved", text };
  } catch {
    return { kind: "absent" };
  }
}

// The one place either network call for a word's decoration leaves the
// device. Called from `search-screen.tsx` alone, with `headword` set only
// once a `word` query is classified and already painted (`wordFound`) —
// `/registro/[palabra]` never calls this, so it opens no connection.
//
// `cache` is read straight from render, not mirrored into state: a cache
// hit or a null headword is a value this hook already has, and a `setState`
// called synchronously inside the effect body for a value the render could
// derive itself is exactly what `react-hooks/set-state-in-effect` forbids.
// Only the two outcomes render cannot know ahead of time — a request now in
// flight, and one that just resolved — reach `setState`, and both do it
// from an asynchronous callback (a timer firing, a promise settling), never
// from the effect's own synchronous body.
export function useDecoration(headword: string | null, needDefinition: boolean): Decoration {
  const [pendingHeadword, setPendingHeadword] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{ headword: string; decoration: Decoration } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // A word change — including one keystroke replacing another — cancels
    // whatever the previous headword was waiting on or had already sent.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;

    if (headword === null || cache.has(headword)) return;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const controller = new AbortController();
      abortRef.current = controller;
      // The pending square and the pending text block only appear once a
      // request is actually in flight, never while a keystroke could still
      // replace this headword before the settle.
      setPendingHeadword(headword);

      void Promise.all([
        fetchPhoto(headword, controller.signal),
        fetchText(headword, needDefinition, controller.signal),
      ]).then(([photo, text]) => {
        if (controller.signal.aborted) return;
        const decoration: Decoration = { photo, text };
        cache.set(headword, decoration);
        setResolved({ headword, decoration });
        if (photo.kind === "resolved") {
          void rememberCredit({
            headword,
            author: photo.photo.author,
            licence: photo.photo.licence,
            licenceUrl: photo.photo.licenceUrl,
            sourceUrl: photo.photo.sourceUrl,
            at: Date.now(),
          });
        }
      });
    }, PHRASE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [headword, needDefinition]);

  if (headword === null) return ABSENT;
  const cached = cache.get(headword);
  if (cached) return cached;
  if (resolved && resolved.headword === headword) return resolved.decoration;
  if (pendingHeadword === headword) return PENDING;
  return ABSENT;
}
