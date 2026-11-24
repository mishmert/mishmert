// Service worker v17 — NUCLEAR RESET
// Wipes every cache on install (not just the previous named one), which fixes
// clients stuck on a cache name they don't recognize. Takes over all open
// windows immediately via skipWaiting + clients.claim.

const CACHE = "meshmeret-v17";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json"
];

self.addEventListener("install", e => {
  // Wipe EVERY existing cache before (re-)populating ours.
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    const cache = await caches.open(CACHE);
    try { await cache.addAll(ASSETS); } catch (err) { /* best effort */ }
  })());
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // Force every open client to reload so they get the fresh HTML.
    const clients = await self.clients.matchAll({ type: "window" });
    for (const c of clients) {
      try { c.navigate(c.url); } catch (_) {}
    }
  })());
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // Network-first so users always get the latest app, with cache fallback when offline
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
