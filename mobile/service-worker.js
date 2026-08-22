const CACHE_NAME = "obaengal-mobile-v20";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./app.js",
  "./manifest.webmanifest",
  "../icons/icon48.png",
  "../icons/icon128.png",
  "../icons/오뱅알.png",
];
const ACTIVE_CACHE_NAME = CACHE_NAME.replace(/v\d+$/, "v24");
const CACHE_PREFIX = CACHE_NAME.replace(/v\d+$/, "");
let legacyAutoActivate = false;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        const hasLegacyCache = keys.some((key) => key.startsWith(CACHE_PREFIX) && key !== ACTIVE_CACHE_NAME);
        legacyAutoActivate = hasLegacyCache;
        return caches.open(ACTIVE_CACHE_NAME);
      })
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => legacyAutoActivate ? self.skipWaiting() : undefined)
  );
});

self.addEventListener("activate", (event) => {
  let hadLegacyCache = false;
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        hadLegacyCache = keys.some((key) => key.startsWith(CACHE_PREFIX) && key !== ACTIVE_CACHE_NAME);
        return Promise.all(keys.filter((key) => key !== ACTIVE_CACHE_NAME).map((key) => caches.delete(key)));
      })
      .then(() => self.clients.claim())
      .then(async () => {
        if (!hadLegacyCache) return;
        const clients = await self.clients.matchAll({ type: "window" });
        await Promise.all(clients.map((client) => client.navigate(client.url)));
      })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(ACTIVE_CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});

