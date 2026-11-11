const CACHE = "barberqueue-offline-v1";
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add("/offline.html")));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("barberqueue-offline-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match("/offline.html")) || Response.error()));
});
