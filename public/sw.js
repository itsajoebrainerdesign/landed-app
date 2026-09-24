// Landed service worker — deliberately minimal. Everything goes to the
// network as normal (plans, accounts, and venues are all live data); the
// only job here is to show a friendly offline page instead of the
// browser's error when a page can't be reached. Bump VERSION when
// offline.html changes.
const VERSION = "landed-v1";
const OFFLINE_ASSETS = ["/offline.html", "/icons/icon-192.png", "/fonts/nuckle-semibold.ttf"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(OFFLINE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  // Page loads: network, falling back to the offline page.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }
  // The offline page's own assets.
  const url = new URL(request.url);
  if (url.origin === self.location.origin && OFFLINE_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});
