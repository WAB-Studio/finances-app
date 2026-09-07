"use client";

import { useEffect } from "react";

// Renders nothing and must stay correct while `/sw.js` does not exist: the
// worker is another module's file (RL-16), and until it lands the registration
// rejects on a 404. Swallowed, so the shell opens either way and nothing here
// waits on it.
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // No worker yet, or the browser refused it. The app works without one.
    });
  }, []);

  return null;
}
