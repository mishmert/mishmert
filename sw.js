const CACHE = "meshmeret-v12";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/js/sb.js",
  "/js/constants.js",
  "/js/utils.js",
  "/js/state.js",
  "/js/helpers.js",
  "/js/roles.js",
  "/js/router.js",
  "/js/data.js",
  "/js/email.js",
  "/js/audit.js",
  "/js/scheduler.js",
  "/js/history.js",
  "/js/actions.js",
  "/js/memo.js",
  "/js/export.js",
  "/js/views-auth.js",
  "/js/views-main.js",
  "/js/views-secondary.js",
  "/js/main.js",
  "/manifest.json"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))
  ));
  self.clients.claim();
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
