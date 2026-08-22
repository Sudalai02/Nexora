// ============================================================
// NEXORA SERVICE WORKER — offline-first app shell
// ============================================================

const CACHE = "nexora-cache-v5";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon.svg",
  "./src/styles/tokens.css",
  "./src/styles/base.css",
  "./src/styles/layout.css",
  "./src/styles/components.css",
  "./src/styles/pages.css",
  "./src/styles/features.css",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Clicking a notification focuses the app and routes to the alert's target.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = event.notification.data && event.notification.data.route;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if (route) client.postMessage({ type: "nexora:navigate", route });
          return client.focus();
        }
      }
      return self.clients.openWindow(route ? `./#${route}` : "./");
    })
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept cross-origin traffic (Ollama, Google Fonts, CDNs).
  // The browser handles those directly — no CORS/network surprises.
  if (url.origin !== location.origin) return;
  if (event.request.method !== "GET") return;

  // App shell + local assets: serve from cache when possible,
  // refresh in the background.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
