// Hand-written, no build step (RL-16). Bump this by hand on every change: it
// names the one cache the app is allowed to hold, and `activate` deletes any
// other cache it finds under this origin.
const CACHE_NAME = "reading-shell-v1";

// How long a navigation waits for the network before it falls back to the
// cached shell. Short enough that a dead connection does not stall the box.
const NAVIGATION_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // `cache.add` rejects on anything but a 2xx; a `fetch` + `put` takes whatever
  // status "/" answers with, so an install never fails on it.
  event.waitUntil(
    fetch("/").then((response) => caches.open(CACHE_NAME).then((cache) => cache.put("/", response))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

function rejectAfter(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error("navigation timed out")), ms);
  });
}

// One cache entry, keyed "/", stands for the whole shell: whatever navigation
// last reached the network is what an offline navigation gets back.
async function navigate(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await Promise.race([fetch(request), rejectAfter(NAVIGATION_TIMEOUT_MS)]);
    cache.put("/", response.clone());
    return response;
  } catch {
    const shell = await cache.match("/");
    if (shell) return shell;
    throw new Error("offline, no cached shell");
  }
}

// Content-hashed and immutable: a cache hit is never stale, so there is no
// reason to ever ask the network again once one is stored.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // The dictionary payload lives in IndexedDB (lib/dictionary), installed by
  // another module once. Caching it here too would put a second 8.2 MB copy
  // in Cache Storage on the device, for nothing.
  if (url.pathname.startsWith("/dictionary/")) return;

  // The app's only server surface. A stale translation is worse than none, so
  // this route is never intercepted, cached, or answered while offline.
  if (url.pathname === "/api/translate") return;

  if (event.request.mode === "navigate") {
    event.respondWith(navigate(event.request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Anything else: let the browser's own fetch happen, uncached.
});
