const CACHE = "barberqueue-offline-v1";

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data?.json(); } catch { return; }
    if (!data || (data.expiresAt && Date.parse(data.expiresAt) <= Date.now())) return;
    const url = new URL(data.url || '/', self.location.origin);
    if (url.origin !== self.location.origin) return;
    await self.registration.showNotification(data.title || 'BarberQueue', {
      body: data.body, tag: data.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: url.href },
    });
  })());
});

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add("/offline.html")));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key.startsWith("barberqueue-offline-") && key !== CACHE)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => (await caches.match("/offline.html")) || Response.error())
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  const targetUrl = target.origin === self.location.origin ? target.href : self.location.origin;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ("focus" in client) {
          if (client.url && client.url.includes(targetUrl)) {
            return client.focus();
          }
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
