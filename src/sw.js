// Template: scripts/build-sw.mjs replaces the two placeholders below and writes dist/client/sw.js.
// The cache name embeds a hash of the build output, so every deploy purges the previous cache on activate.
const CACHE = "milk-tracker-__BUILD_HASH__";
const ASSETS = __PRECACHE__;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first pour la page (mises à jour), cache-first pour le reste (polices, icônes)
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // the sharing API is never cached (it is POST-only today; this keeps it so if a GET is ever added)
  if (new URL(e.request.url).pathname.startsWith("/api/")) return;
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put("/index.html", copy));
        return r;
      }).catch(() => caches.match("/index.html"))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok || r.type === "opaque") {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return r;
    }))
  );
});

// Clicking the vitamin D reminder notification focuses the app (or opens it).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
