const CACHE_NAME = "namaa-shell-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("namaa-shell-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then(async (response) => {
      if (response.ok && !new URL(request.url).pathname.endsWith("/api/status")) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    });
    if (cached) {
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    return network;
  })());
});
