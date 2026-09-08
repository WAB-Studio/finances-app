"use client";

import { useEffect } from "react";

import { syncNow } from "@/lib/sync/driver";

// The push/pull's only trigger (RNL-09): the same `visibilitychange` event
// `flushPendingLookup` rides (lib/log/record.ts:145-148). Never a timer.
const MIN_INTERVAL_MS = 60_000;

/** Renders nothing. Fires `syncNow()` on hide, at most once a minute. */
export function SyncOnHide() {
  useEffect(() => {
    let lastRun = 0;

    function onVisibilityChange() {
      if (!document.hidden) return;
      const now = Date.now();
      if (now - lastRun < MIN_INTERVAL_MS) return;
      lastRun = now;
      void syncNow();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return null;
}
