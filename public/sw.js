// Service Worker: App startet aus dem Speicher.
// - Dateien mit Hash im Namen (assets/) ändern sich nie → direkt aus dem Cache
// - Startseite: kurz übers Netz versuchen, sonst die zuletzt geladene Version
//   (immer unter "./" gespeichert – früher konnte eine uralte Kopie von der Installation erscheinen)
const CACHE = "drive-pool-v5";
const SHELL = ["./", "./manifest.webmanifest", "./icons/icon-192.png"];
const SHELL_KEY = new URL("./", self.location).toString();

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
      // Nur alte App-Caches löschen – der Vorschaubilder-Cache (drivepool-thumbs-…) bleibt
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("drive-pool-") && k !== CACHE).map((k) => caches.delete(k))))
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
      caches.match(SHELL_KEY).then((hit) => {
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
        if (res.ok && !res.redirected) {
          // Jede Seite der App ist dieselbe Startseite → immer unter einem Schlüssel, die neueste gewinnt
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SHELL_KEY, copy));
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

// Videos stückweise abspielen: der Player fragt Bereiche (Range) an, der Service Worker
// holt genau diese Stücke mit dem Zugangs-Token direkt bei Google (kein Komplett-Download).
const videoTokens = new Map();
self.addEventListener("message", (event) => {
  const d = event.data;
  if (d && d.type === "video-token" && d.accountId && d.token) videoTokens.set(d.accountId, d.token);
});

async function streamVideo(req, url) {
  const [accountId, id] = url.pathname.split("/__video/")[1].split("/").map(decodeURIComponent);
  const size = Number(url.searchParams.get("size")) || 0;
  const type = url.searchParams.get("type") || "video/mp4";
  const token = videoTokens.get(accountId);
  if (!token) return new Response("Kein Zugang", { status: 401 });
  const range = req.headers.get("range");
  const headers = { Authorization: `Bearer ${token}` };
  if (range) headers.Range = range;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers });
  if (!res.ok && res.status !== 206) return new Response(null, { status: res.status });
  const out = new Headers({ "Content-Type": type, "Accept-Ranges": "bytes" });
  // Content-Range selbst berechnen (Google gibt den Header nicht an Web-Apps heraus)
  const m = range && /bytes=(\d+)-(\d*)/.exec(range);
  if (m && size) {
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    out.set("Content-Range", `bytes ${start}-${end}/${size}`);
    out.set("Content-Length", String(end - start + 1));
    return new Response(res.body, { status: 206, headers: out });
  }
  if (size) out.set("Content-Length", String(size));
  return new Response(res.body, { status: 200, headers: out });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/__video/")) {
    event.respondWith(streamVideo(req, url));
    return;
  }

  if (url.pathname.includes("/assets/") || url.pathname.includes("/icons/")) {
    event.respondWith(cacheFirst(req));
  } else if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, 2500));
  }
});
