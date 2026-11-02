import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { formatBytes, formatDateTime } from "../lib/format";
import { downloadBlob } from "../lib/google";
import { accountColor } from "../lib/theme";
import { getThumb, peekThumb, VIEW_SIZE } from "../lib/thumbs";
import type { Account, Item } from "../lib/types";
import Icon from "./Icon";
import { isFavorite, loadFavorites, onFavoritesChange, toggleFavorite } from "../lib/favorites";
import { useUI } from "./ui";

const ShareSheet = lazy(() => import("./ShareSheet"));

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
}
const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 };
/** Obergrenze, egal wie gross das Original ist */
const MAX_ZOOM = 24;
/** Mindestens so weit darf man immer zoomen (auch bei kleinen Bildern) */
const MIN_MAX_ZOOM = 2;
const DOUBLE_TAP_ZOOM = 2.5;

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
  const zRef = useRef(z);
  zRef.current = z;
  const [zooming, setZooming] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  const [fullState, setFullState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const g = useRef<Gesture | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    void loadFavorites().then(() => setFav(isFavorite(item)));
    return onFavoritesChange(() => setFav(isFavorite(item)));
  }, [item]);

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
    setZ(NO_ZOOM);
    setFull(null);
    setFullState("idle");
    setDims(null);
    setLow(peekThumb(item));
    setHigh(peekThumb(item, VIEW_SIZE));
    if (!peekThumb(item)) void getThumb(item).then((u) => alive && setLow(u)).catch(() => undefined);
    if (!peekThumb(item, VIEW_SIZE)) {
      getThumb(item, VIEW_SIZE)
        .then((u) => alive && setHigh(u))
        .catch(() =>
          // Keine Google-Vorschau → Original laden
          downloadBlob(item.account_id, item.drive_id)
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
  }, [item]);

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
    const max = Math.min(MAX_ZOOM, Math.max(MIN_MAX_ZOOM, dims.w / W));
    return { st, W, H, max };
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
  const zoomAt = (from: Zoom, s: number, p0: { x: number; y: number }, p1 = p0): Zoom => {
    const cx = (p0.x - from.x) / from.s;
    const cy = (p0.y - from.y) / from.s;
    return clampZ({ s, x: p1.x - s * cx, y: p1.y - s * cy });
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
  const fullUrls = useRef<string[]>([]);
  useEffect(() => () => fullUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches;
    if (t.length === 2) {
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
      setZ(zoomAt(gs.z0, gs.z0.s * (d / gs.d0), gs.m0, m1));
      return;
    }
    const mx = t[0].clientX - gs.sx;
    const my = t[0].clientY - gs.sy;
    if (Math.abs(mx) + Math.abs(my) > 8) gs.moved = true;
    if (gs.mode === "pan") setZ(clampZ({ ...gs.z0, x: gs.z0.x + mx, y: gs.z0.y + my }));
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
      if (zRef.current.s < 1.05) setZ(NO_ZOOM);
      g.current = null;
      setZooming(false);
      return;
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
    if (zRef.current.s > 1.01) setZ(NO_ZOOM);
    else {
      loadFull();
      const geo = geometry();
      setZ(zoomAt(NO_ZOOM, Math.min(DOUBLE_TAP_ZOOM, geo?.max ?? DOUBLE_TAP_ZOOM), p));
    }
  };
  const geo = dims ? geometry() : null;
  const atMax = !!geo && z.s >= geo.max - 0.01 && z.s > 1;

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
        <button className="icon-btn glass" onClick={() => setSharing(true)} aria-label="Link teilen">
          <Icon name="link" size={19} />
        </button>
      </div>
      <div
        ref={stageRef}
        className="viewer-stage"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onDoubleClick={(e) => toggleZoom(rel(e.clientX, e.clientY))}
        onWheel={(e) => {
          if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return;
          loadFull();
          setZ(zoomAt(zRef.current, zRef.current.s * Math.exp(-e.deltaY / 300), rel(e.clientX, e.clientY)));
        }}
      >
        {error && !low ? (
          <p className="muted">Bild konnte nicht geladen werden.</p>
        ) : high || low ? (
          <div key={item.drive_id} className={`viewer-frame ${dragging ? "dragging" : ""}`} style={style}>
            <div
              className={`viewer-zoom ${zooming ? "live" : ""}`}
              style={{ transform: z.s > 1 || z.x || z.y ? `translate3d(${z.x}px, ${z.y}px, 0) scale(${z.s})` : undefined }}
            >
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
    </div>
  );
}
