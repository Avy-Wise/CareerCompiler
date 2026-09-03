/* CareerCompiler — service worker.
 *
 * The whole application is one HTML file plus icons: no API, no database, no
 * network calls at run time. That makes offline support genuinely complete
 * rather than a degraded mode — once installed, the assessment works on a plane.
 *
 * Two caching strategies:
 *   app shell   — cache-first, refreshed in the background (stale-while-revalidate)
 *   Google fonts — cache-first with a long life; the page has a system-font
 *                  fallback stack, so a cold offline start still looks right.
 */

const VERSION = "cc-v1";
const SHELL = `${VERSION}-shell`;
const FONTS = `${VERSION}-fonts`;

const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png",
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // addAll is atomic: one 404 discards the whole install. Individual adds mean
    // a missing optional icon cannot break the app.
    await Promise.all(PRECACHE.map(url =>
      cache.add(new Request(url, {cache: "reload"})).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => !k.startsWith(VERSION))
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isFont = url =>
  url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

self.addEventListener("fetch", event => {
  const {request} = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (isFont(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const res = await fetch(request);
        if (res.ok || res.type === "opaque") cache.put(request, res.clone());
        return res;
      } catch {
        // no network and nothing cached — the CSS fallback stack takes over
        return new Response("", {status: 504, statusText: "offline"});
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(request, {ignoreSearch: true});

    const network = fetch(request).then(res => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    }).catch(() => null);

    // Serve from cache immediately, refresh in the background. A navigation that
    // misses the cache entirely falls back to the shell, so a deep link to a
    // shared result still opens offline.
    if (hit) { event.waitUntil(network); return hit; }

    const res = await network;
    if (res) return res;
    if (request.mode === "navigate") {
      return (await cache.match("./index.html")) ||
             new Response("Offline", {status: 503});
    }
    return new Response("", {status: 504});
  })());
});

self.addEventListener("message", e => {
  if (e.data === "skipWaiting") self.skipWaiting();
});
