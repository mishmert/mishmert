// Service worker v18 — Vite-bundled build.
// Pre-cache only the shell (/, /index.html, /manifest.json); the hashed
// JS/CSS bundles are learned on first fetch by the network-first handler,
// which means a fresh deploy always reaches the browser on next load even
// though the filename changed.

const CACHE = "meshmeret-v19";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    const cache = await caches.open(CACHE);
    try { await cache.addAll(ASSETS); } catch (_) {}
  })());
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window" });
    for (const c of clients) {
      try { c.navigate(c.url); } catch (_) {}
    }
  })());
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // Network-first so a deploy wins over any stale cache.
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone)).catch(()=>{});
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});

// ══════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// ══════════════════════════════════════════════════════
self.addEventListener("push", e => {
  let payload = { title: "🔔 עדכון חדש", body: "", url: "/" };
  try { payload = { ...payload, ...e.data.json() }; } catch (err) {}
  e.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192x192.png",
      badge: "/icon-192x192.png",
      dir: "rtl",
      lang: "he",
      vibrate: [200, 100, 200],
      renotify: true,
      tag: "meshmeret-" + Date.now(),
      data: { url: payload.url || "/" }
    })
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
