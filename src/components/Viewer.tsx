import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatBytes, formatDateTime } from "../lib/format";
import { accessToken, downloadBlob } from "../lib/google";
import { accountColor } from "../lib/theme";
import { getThumb, peekThumb, VIEW_SIZE } from "../lib/thumbs";
import type { Account, Item } from "../lib/types";
import Icon from "./Icon";
import { isFavorite, loadFavorites, onFavoritesChange, toggleFavorite } from "../lib/favorites";
import { markerColor, useTags } from "../lib/tags";
import { useUI } from "./ui";
import { useAiEnabled } from "../ai/flag"; // KI-SUCHE

const ShareSheet = lazy(() => import("./ShareSheet"));
const SimilarSheet = lazy(() => import("../ai/SimilarSheet")); // KI-SUCHE
const TagSheet = lazy(() => import("./TagSheet"));

interface Zoom {
  s: number;
  x: number;
  y: number;
}
interface Gesture {
  mode: "swipe" | "pan" | "pinch";
  d0: number;
  m0: { x: number; y: number };
  z0: Zoom;
  sx: number;
  sy: number;
  moved: boolean;
  /** Letzte Fingermitte beim Zoomen */
  m1?: { x: number; y: number };
  /** Geschwindigkeit beim Verschieben (px/ms) für den Schwung beim Loslassen */
  vx?: number;
  vy?: number;
  lt?: number;
  lx?: number;
  ly?: number;
}
const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 };
/** Obergrenze, egal wie gross das Original ist */
const MAX_ZOOM = 24;
/** Mindestens so weit darf man immer zoomen (auch bei kleinen Bildern, dann wird es pixelig) */
const MIN_MAX_ZOOM = 15;
const DOUBLE_TAP_ZOOM = 2.5;
/** Gummiband: so stark gibt das Bild über den Rand hinaus nach */
const RUBBER = 0.35;
/** So lange gleitet ein schnell losgelassenes Bild nach (ms) */
const GLIDE_MS = 220;

const tf = (n: Zoom) => (n.s !== 1 || n.x || n.y ? `translate3d(${n.x}px, ${n.y}px, 0) scale(${n.s})` : "");
const rubber = (v: number, lo: number, hi: number) => (v > hi ? hi + (v - hi) * RUBBER : v < lo ? lo - (lo - v) * RUBBER : v);

export default function Viewer({
  items,
  index,
  accounts,
  onIndex,
  onClose,
}: {
  items: Item[];
  index: number;
  accounts: Account[];
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  // Nur ein anderes Foto (nicht ein neu geladenes Objekt desselben Fotos) setzt Zoom & Bilder zurück
  const itemKey = `${item.account_id}|${item.drive_id}`;
  // Sofort: kleine Vorschau aus dem Speicher, dann die scharfe Version
  const [low, setLow] = useState<string | null>(() => peekThumb(item));
  const [high, setHigh] = useState<string | null>(() => peekThumb(item, VIEW_SIZE));
  const [error, setError] = useState(false);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const startX = useRef<number | null>(null);
  const ui = useUI();
  const [fav, setFav] = useState(() => isFavorite(item));
  // Zoomen: Skalierung + Verschiebung; Original wird beim ersten Zoomen nachgeladen
  const [z, setZ] = useState<Zoom>(NO_ZOOM);
  // Während einer Geste wird das Bild direkt bewegt (zRef + DOM) – React erfährt den Stand nur
  // gelegentlich (für die Zoom-Anzeige). So ruckelt nichts, auch nicht bei grossen Bildern.
  const zRef = useRef(z);
  const zoomEl = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const lastSync = useRef(0);
  const paint = () => {
    raf.current = 0;
    if (zoomEl.current) zoomEl.current.style.transform = tf(zRef.current);
  };
  const liveZ = (n: Zoom) => {
    zRef.current = n;
    if (!raf.current) raf.current = requestAnimationFrame(paint);
    const now = performance.now();
    if (now - lastSync.current > 120) {
      lastSync.current = now;
      setZ({ ...n });
    }
  };
  /** Endstand setzen – gleitet mit Animation dorthin */
  const commitZ = (n: Zoom) => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    zRef.current = n;
    setZ({ ...n });
  };
  useLayoutEffect(paint, [z]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const [zooming, setZooming] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  const [fullState, setFullState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const isVideo = !!item.mime_type?.startsWith("video/");
  const [video, setVideo] = useState<{ state: "idle" | "loading" | "ready" | "error"; url?: string; stream?: boolean }>({ state: "idle" });
  const stageRef = useRef<HTMLDivElement>(null);
  const g = useRef<Gesture | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  // Fingertipps erzeugen zusätzlich Maus-Ereignisse (dblclick) – die dürfen den Zoom nicht nochmals umschalten
  const lastTouch = useRef(0);
  const [sharing, setSharing] = useState(false);
  const ai = useAiEnabled(); // KI-SUCHE
  const [similar, setSimilar] = useState(false); // KI-SUCHE
  const [tagging, setTagging] = useState(false);
  const tagMap = useTags();
  const itemTags = tagMap?.get(`${item.account_id}|${item.drive_id}`) ?? [];
  const markerDots = itemTags.map(markerColor).filter((c): c is string => !!c);

  useEffect(() => {
    void loadFavorites().then(() => setFav(isFavorite(item)));
    return onFavoritesChange(() => setFav(isFavorite(item)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  const heart = async () => {
    try {
      const on = await toggleFavorite(item);
      ui.toast(on ? "Zu Favoriten hinzugefügt" : "Aus Favoriten entfernt", "ok");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  useEffect(() => {
    let alive = true;
    let revoke: string | null = null;
    setError(false);
    setDx(0);
    commitZ(NO_ZOOM);
    setFull(null);
    setFullState("idle");
    setDims(null);
    setVideo({ state: "idle" });
    setLow(peekThumb(item));
    setHigh(peekThumb(item, VIEW_SIZE));
    if (!peekThumb(item)) void getThumb(item).then((u) => alive && setLow(u)).catch(() => undefined);
    if (!peekThumb(item, VIEW_SIZE)) {
      getThumb(item, VIEW_SIZE)
        .then((u) => alive && setHigh(u))
        .catch(() =>
          // Keine Google-Vorschau → Original laden (bei Videos nicht: das lädt erst „Abspielen“)
          (item.mime_type?.startsWith("video/") ? Promise.reject(new Error("video")) : downloadBlob(item.account_id, item.drive_id))
            .then((b) => {
              revoke = URL.createObjectURL(b);
              if (alive) setHigh(revoke);
            })
            .catch(() => alive && setError(true)),
        );
    }
    return () => {
      alive = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  // Nachbarbilder vorladen → Wischen fühlt sich sofort an
  useEffect(() => {
    for (const j of [index + 1, index - 1]) {
      if (items[j]) void getThumb(items[j], VIEW_SIZE).catch(() => undefined);
    }
  }, [index, items]);

  // Grösse des Bildes bei 100 % (eingepasst) und maximale Zoomstufe:
  // so weit, bis ein Bildpunkt einen Bildschirmpunkt füllt – darüber wird es nur noch pixelig.
  const geometry = () => {
    const st = stageRef.current?.getBoundingClientRect();
    if (!st || !dims) return null;
    const fit = Math.min(st.width / dims.w, st.height / dims.h, 1);
    const W = dims.w * fit;
    const H = dims.h * fit;
    /** Ab hier zeigt ein Bildschirmpunkt einen Bildpunkt (volle Auflösung) */
    const native = dims.w / W;
    const max = Math.min(MAX_ZOOM, Math.max(MIN_MAX_ZOOM, native));
    return { st, W, H, max, native };
  };
  const clampZ = (n: Zoom): Zoom => {
    const geo = geometry();
    if (!geo) return n;
    const s = Math.min(Math.max(n.s, 1), geo.max);
    const bx = Math.max(0, (geo.W * s - geo.st.width) / 2);
    const by = Math.max(0, (geo.H * s - geo.st.height) / 2);
    return { s, x: Math.min(bx, Math.max(-bx, n.x)), y: Math.min(by, Math.max(-by, n.y)) };
  };
  /** Punkt relativ zur Bühnenmitte */
  const rel = (x: number, y: number) => {
    const st = stageRef.current!.getBoundingClientRect();
    return { x: x - st.left - st.width / 2, y: y - st.top - st.height / 2 };
  };
  /** Zoom auf Stufe s, wobei der Bildpunkt unter p an seinem Platz bleibt */
  const zoomAt = (from: Zoom, s: number, p0: { x: number; y: number }, p1 = p0, clamp = clampZ): Zoom => {
    const cx = (p0.x - from.x) / from.s;
    const cy = (p0.y - from.y) / from.s;
    return clamp({ s, x: p1.x - s * cx, y: p1.y - s * cy });
  };
  /** Wie clampZ, aber weich: über den Rand hinaus gibt das Bild gedämpft nach (Gummiband) */
  const softZ = (n: Zoom): Zoom => {
    const geo = geometry();
    if (!geo) return n;
    const bx = Math.max(0, (geo.W * n.s - geo.st.width) / 2);
    const by = Math.max(0, (geo.H * n.s - geo.st.height) / 2);
    return { s: n.s, x: rubber(n.x, -bx, bx), y: rubber(n.y, -by, by) };
  };
  /** Zoomstufe mit Gummiband unter 100 % und über dem Maximum */
  const softScale = (s: number) => {
    const max = geometry()?.max ?? MAX_ZOOM;
    if (s > max) return max * Math.pow(s / max, RUBBER);
    if (s < 1) return Math.pow(s, RUBBER);
    return s;
  };
  const loadFull = () => {
    if (fullState !== "idle") return;
    setFullState("loading");
    downloadBlob(item.account_id, item.drive_id)
      .then((b) => {
        const url = URL.createObjectURL(b);
        fullUrls.current.push(url);
        setFull(url);
        setFullState("done");
      })
      .catch(() => setFullState("error"));
  };
  // Original nur für das aktuelle Foto im Speicher halten – beim nächsten Foto wieder freigeben
  const fullUrls = useRef<string[]>([]);
  useEffect(
    () => () => {
      fullUrls.current.forEach((u) => URL.revokeObjectURL(u));
      fullUrls.current = [];
    },
    [itemKey],
  );

  const onTouchStart = (e: React.TouchEvent) => {
    lastTouch.current = Date.now();
    const t = e.touches;
    if (t.length === 2 && !isVideo) {
      const a = rel(t[0].clientX, t[0].clientY);
      const b = rel(t[1].clientX, t[1].clientY);
      g.current = { mode: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, z0: zRef.current, sx: 0, sy: 0, moved: true };
      setZooming(true);
      setDragging(false);
      setDx(0);
      loadFull();
      return;
    }
    if (t.length !== 1) return;
    const z0 = zRef.current;
    g.current = { mode: z0.s > 1.01 ? "pan" : "swipe", d0: 0, m0: { x: 0, y: 0 }, z0, sx: t[0].clientX, sy: t[0].clientY, moved: false };
    if (z0.s > 1.01) setZooming(true);
    else {
      startX.current = t[0].clientX;
      setDragging(true);
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const gs = g.current;
    if (!gs) return;
    const t = e.touches;
    if (gs.mode === "pinch" && t.length >= 2) {
      const a = rel(t[0].clientX, t[0].clientY);
      const b = rel(t[1].clientX, t[1].clientY);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gs.m1 = m1;
      liveZ(zoomAt(gs.z0, softScale(gs.z0.s * (d / gs.d0)), gs.m0, m1, softZ));
      return;
    }
    const mx = t[0].clientX - gs.sx;
    const my = t[0].clientY - gs.sy;
    if (Math.abs(mx) + Math.abs(my) > 8) gs.moved = true;
    if (gs.mode === "pan") {
      // Geschwindigkeit mitführen (geglättet) für den Schwung beim Loslassen
      const now = performance.now();
      if (gs.lt !== undefined) {
        const dt = Math.max(1, now - gs.lt);
        gs.vx = 0.7 * ((t[0].clientX - gs.lx!) / dt) + 0.3 * (gs.vx ?? 0);
        gs.vy = 0.7 * ((t[0].clientY - gs.ly!) / dt) + 0.3 * (gs.vy ?? 0);
      }
      gs.lt = now;
      gs.lx = t[0].clientX;
      gs.ly = t[0].clientY;
      liveZ(softZ({ ...gs.z0, x: gs.z0.x + mx, y: gs.z0.y + my }));
    }
    else if (gs.mode === "swipe" && startX.current !== null) setDx(t[0].clientX - startX.current);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const gs = g.current;
    if (!gs) return;
    if (gs.mode === "pinch") {
      // Ein Finger bleibt liegen → weiter verschieben
      if (e.touches.length === 1) {
        g.current = { mode: "pan", d0: 0, m0: { x: 0, y: 0 }, z0: zRef.current, sx: e.touches[0].clientX, sy: e.touches[0].clientY, moved: true };
        return;
      }
      const cur = zRef.current;
      const max = geometry()?.max ?? MAX_ZOOM;
      // Zurückfedern: unter 100 % → ganz raus, über dem Maximum → aufs Maximum (um die Fingermitte)
      commitZ(cur.s < 1.05 ? NO_ZOOM : cur.s > max ? zoomAt(cur, max, gs.m1 ?? gs.m0) : clampZ(cur));
      g.current = null;
      setZooming(false);
      return;
    }
    if (gs.mode === "pan") {
      const cur = zRef.current;
      // Nach dem letzten Fingerzug kurz weitergleiten (nur wenn der Finger nicht schon stand)
      const fresh = gs.lt !== undefined && performance.now() - gs.lt < 80;
      const vx = fresh ? (gs.vx ?? 0) : 0;
      const vy = fresh ? (gs.vy ?? 0) : 0;
      commitZ(clampZ({ ...cur, x: cur.x + vx * GLIDE_MS, y: cur.y + vy * GLIDE_MS }));
    }
    if (gs.mode === "swipe") {
      setDragging(false);
      if (dx > 70 && index > 0) onIndex(index - 1);
      else if (dx < -70 && index < items.length - 1) onIndex(index + 1);
      else setDx(0);
      startX.current = null;
    }
    setZooming(false);
    g.current = null;
    // Doppeltippen: hineinzoomen an dieser Stelle bzw. zurück auf 100 %
    if (!gs.moved) {
      const now = Date.now();
      const p = rel(gs.sx, gs.sy);
      const prev = lastTap.current;
      if (prev && now - prev.t < 300 && Math.hypot(prev.x - p.x, prev.y - p.y) < 40) {
        lastTap.current = null;
        toggleZoom(p);
      } else lastTap.current = { t: now, x: p.x, y: p.y };
    }
  };
  const toggleZoom = (p: { x: number; y: number }) => {
    if (isVideo) return;
    if (zRef.current.s > 1.01) commitZ(NO_ZOOM);
    else {
      loadFull();
      const geo = geometry();
      commitZ(zoomAt(NO_ZOOM, Math.min(DOUBLE_TAP_ZOOM, geo?.max ?? DOUBLE_TAP_ZOOM), p));
    }
  };
  const geo = dims ? geometry() : null;
  const atMax = !!geo && z.s >= geo.native - 0.01 && z.s > 1;

  // Videos: Original laden (Google verlangt den Zugang im Header, daher als Blob) und abspielen
  const playVideo = () => {
    if (video.state !== "idle" && video.state !== "error") return;
    setVideo({ state: "loading" });
    const key = itemKey;
    const sw = navigator.serviceWorker?.controller;
    // 1. Stückweise über den Service Worker (startet sofort, Spulen möglich)
    if (sw && video.state !== "error" && !streamFailed.current.has(key)) {
      accessToken(item.account_id)
        .then((token) => {
          if (key !== itemKeyRef.current) return;
          sw.postMessage({ type: "video-token", accountId: item.account_id, token });
          const q = new URLSearchParams({ size: String(item.size ?? 0), type: item.mime_type ?? "video/mp4" });
          setVideo({ state: "ready", url: `./__video/${encodeURIComponent(item.account_id)}/${encodeURIComponent(item.drive_id)}?${q}`, stream: true });
        })
        .catch(() => downloadVideo(key));
      return;
    }
    downloadVideo(key);
  };
  // 2. Rückfall: ganzes Video laden (z. B. ohne Service Worker oder wenn Streaming scheitert)
  const streamFailed = useRef(new Set<string>());
  const downloadVideo = (key: string) => {
    setVideo({ state: "loading" });
    downloadBlob(item.account_id, item.drive_id)
      .then((b) => {
        if (key !== itemKeyRef.current) return;
        const type = item.mime_type && b.type !== item.mime_type ? item.mime_type : b.type;
        const url = URL.createObjectURL(type === b.type ? b : new Blob([b], { type }));
        fullUrls.current.push(url);
        setVideo({ state: "ready", url });
      })
      .catch(() => key === itemKeyRef.current && setVideo({ state: "error" }));
  };
  const itemKeyRef = useRef(itemKey);
  itemKeyRef.current = itemKey;

  const close = () => {
    setClosing(true);
    setTimeout(onClose, 180);
  };

  const accIndex = accounts.findIndex((a) => a.id === item.account_id);
  const account = accounts[accIndex];
  const style = {
    transform: dx ? `translateX(${dx}px) rotate(${dx / 40}deg)` : undefined,
    opacity: 1 - Math.min(Math.abs(dx) / 600, 0.4),
  };

  return (
    <div className={`viewer ${closing ? "closing" : ""}`}>
      <div className="viewer-top">
        <button className="icon-btn glass" onClick={close} aria-label="Schliessen">
          <Icon name="x" />
        </button>
        <span className="viewer-title">{item.name}</span>
        <span className="muted small">
          {index + 1}/{items.length}
        </span>
        <button className={`icon-btn glass fav-btn ${fav ? "on" : ""}`} onClick={heart} aria-label="Favorit">
          <Icon name="heart" size={20} />
        </button>
        <button className={`icon-btn glass tag-btn ${itemTags.length ? "on" : ""}`} onClick={() => setTagging(true)} aria-label="Tags">
          <Icon name="tag" size={19} />
          {markerDots.length > 0 && (
            <span className="tag-btn-dots">
              {markerDots.slice(0, 3).map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
          )}
        </button>
        <button className="icon-btn glass" onClick={() => setSharing(true)} aria-label="Link teilen">
          <Icon name="link" size={19} />
        </button>
        {/* KI-SUCHE */}
        {ai && (
          <button className="icon-btn glass" onClick={() => setSimilar(true)} aria-label="Ähnliche Fotos">
            <Icon name="sparkles" size={19} />
          </button>
        )}
      </div>
      <div
        ref={stageRef}
        className="viewer-stage"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onDoubleClick={(e) => Date.now() - lastTouch.current > 800 && toggleZoom(rel(e.clientX, e.clientY))}
        onWheel={(e) => {
          if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return;
          loadFull();
          commitZ(zoomAt(zRef.current, zRef.current.s * Math.exp(-e.deltaY / 300), rel(e.clientX, e.clientY)));
        }}
      >
        {error && !low && !isVideo ? (
          <p className="muted">Bild konnte nicht geladen werden.</p>
        ) : high || low || isVideo ? (
          <div key={item.drive_id} className={`viewer-frame ${dragging ? "dragging" : ""}`} style={style}>
            <div ref={zoomEl} className={`viewer-zoom ${zooming ? "live" : ""}`}>
              {low && <img className={`viewer-low ${high || full ? "hide" : ""}`} src={low} alt="" />}
              {high && (
                <img
                  className="viewer-high"
                  src={high}
                  alt={item.name}
                  onLoad={(e) => !full && setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                />
              )}
              {full && (
                <img
                  className="viewer-full"
                  src={full}
                  alt=""
                  onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                />
              )}
            </div>
            {isVideo && video.state === "ready" && (
              <video
                className="viewer-video"
                src={video.url}
                controls
                autoPlay
                playsInline
                onTouchStart={(e) => e.stopPropagation()}
                onError={() => {
                  if (!video.stream) return setVideo({ state: "error" });
                  streamFailed.current.add(itemKey);
                  downloadVideo(itemKey);
                }}
              />
            )}
            {isVideo && video.state !== "ready" && (
              <button className="video-play glass" onClick={playVideo} aria-label="Video abspielen">
                {video.state === "loading" ? <span className="spinner" /> : <Icon name="play" size={30} />}
              </button>
            )}
            {isVideo && video.state === "error" && <p className="video-error small">Video konnte nicht geladen werden – nochmals tippen.</p>}
          </div>
        ) : (
          <div className="spinner" />
        )}
      </div>
      {z.s > 1.01 && (
        <div className="zoom-chip glass">
          {z.s.toFixed(1)}×{fullState === "loading" ? " · lädt Original…" : atMax ? " · volle Auflösung" : ""}
        </div>
      )}
      <div className="viewer-info glass">
        <span className="chip-lite">
          <Icon name="image" size={15} /> {formatBytes(item.size)}
        </span>
        {item.taken_at && <span className="chip-lite">📅 {formatDateTime(item.taken_at)}</span>}
        {account && (
          <span className="chip-lite">
            <span className="dot" style={{ background: accountColor(accIndex), color: accountColor(accIndex) }} />
            {account.email}
          </span>
        )}
        {item.description && <span className="chip-lite">{item.description}</span>}
      </div>
      {sharing && (
        <Suspense fallback={null}>
          <ShareSheet item={item} onClose={() => setSharing(false)} />
        </Suspense>
      )}
      {tagging && (
        <Suspense fallback={null}>
          <TagSheet items={[item]} onClose={() => setTagging(false)} />
        </Suspense>
      )}
      {/* KI-SUCHE */}
      {similar && (
        <Suspense fallback={null}>
          <SimilarSheet item={item} accounts={accounts} onClose={() => setSimilar(false)} />
        </Suspense>
      )}
    </div>
  );
}
