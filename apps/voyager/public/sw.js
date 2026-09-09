// Hand-written, no build step (RL-16). Bump this by hand on every change: it
// names the one cache the app is allowed to hold, and `activate` deletes any
// other cache it finds under this origin.
const CACHE_NAME = "reading-shell-v5";

// How long a navigation waits for the network before it falls back to the
// cached shell. Short enough that a dead connection does not stall the box.
const NAVIGATION_TIMEOUT_MS = 3000;

// This app has four pages (SPEC §page list): "/", "/fuente", "/registro" and
// "/cuenta". All four are precached at install so each opens offline on its
// own, never only as a side effect of having been visited online first — a
// bookmark, or a link into "/cuenta" that lands before "/" ever loaded, must
// still draw the app's own screen, not the browser's error page.
const SHELL_ROUTES = ["/", "/fuente", "/registro", "/cuenta"];

// "/cuenta"'s document bakes the session cookie into its HTML (`getReader()`
// on the server, `readerEmail` in the markup) — the only shell route that
// does. A cached copy of a signed-in render, replayed after the cookie is
// gone, hands the next person on the device the previous reader's email
// straight out of Cache Storage. So its cache entry is written exactly once,
// with credentials withheld (see `install`), and `navigate` below never
// overwrites it — not with a signed-in render, not with any other.
const NO_OVERWRITE_ROUTES = new Set(["/cuenta"]);

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // `cache.add` rejects on anything but a 2xx; a `fetch` + `put` takes whatever
  // status each route answers with, so an install never fails on one of them.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL_ROUTES.map((route) => {
          // Omitting credentials for "/cuenta" forces the signed-out render
          // even when the tab installing the worker happens to hold a
          // session — the one copy this cache ever takes of it must be safe
          // to hand to a stranger.
          const init = NO_OVERWRITE_ROUTES.has(route) ? { credentials: "omit" } : undefined;
          return fetch(route, init).then((response) => cache.put(route, response));
        }),
      ),
    ),
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

// Keyed by the request itself (its own URL), one entry per route: a hard
// load of "/fuente" must never overwrite the cached "/" shell, or an offline
// open of "/" would serve the source page instead of the search box. Also
// keeps SHELL_ROUTES fresh with whatever the network last answered, so a
// precached route never goes stale once it has been visited online — except
// "/cuenta" (`NO_OVERWRITE_ROUTES`), whose live render may carry a session
// this cache must never hold: the network still answers it every time, the
// response just never gets written back.
async function navigate(request) {
  const cache = await caches.open(CACHE_NAME);
  const path = new URL(request.url).pathname;
  try {
    const response = await Promise.race([fetch(request), rejectAfter(NAVIGATION_TIMEOUT_MS)]);
    if (!NO_OVERWRITE_ROUTES.has(path)) cache.put(request, response.clone());
    return response;
  } catch {
    const shell = await cache.match(request);
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

  // Uploads a batch of already-synced rows. A cached response here would
  // replay rows the server already has, never send the ones it does not.
  if (url.pathname === "/api/log/sync") return;

  // Lands the magic link and sets the session cookie. A cached response
  // sets no cookie, so the sign-in would silently fail.
  if (url.pathname.startsWith("/auth/")) return;

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
