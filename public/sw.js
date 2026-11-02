// Service Worker: App startet aus dem Speicher.
// - Dateien mit Hash im Namen (assets/) ändern sich nie → direkt aus dem Cache
// - Startseite: kurz übers Netz versuchen, sonst die gespeicherte Version
const CACHE = "drive-pool-v2";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function cacheFirst(req) {
  return caches.match(req).then(
    (hit) =>
      hit ||
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }),
  );
}

function networkFirst(req, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () =>
      caches.match(req).then((hit) => hit || caches.match("./")).then((hit) => {
        if (!settled && hit) {
          settled = true;
          resolve(hit);
        }
        return hit;
      });
    const timer = setTimeout(fallback, timeoutMs);
    fetch(req)
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        if (!settled) {
          settled = true;
          resolve(res);
        }
      })
      .catch(() => {
        clearTimeout(timer);
        fallback().then((hit) => {
          if (!settled) {
            settled = true;
            resolve(hit || Response.error());
          }
        });
      });
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/assets/") || url.pathname.includes("/icons/")) {
    event.respondWith(cacheFirst(req));
  } else if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, 2500));
  }
});
