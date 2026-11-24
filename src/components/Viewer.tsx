import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatBytes, formatDateTime } from "../lib/format";
import { accessToken, downloadBlob, updateItem } from "../lib/google";
import { accountColor, currentTheme, isLight, THEMES } from "../lib/theme";
import { cachedFolder, invalidateAll } from "../lib/cache";
import { syncAccounts, writeLogs } from "../lib/db";
import { trashFiles } from "../lib/folders";
import { offerUndo, undoFileRenames, undoTrash } from "../lib/undo";
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
const MoveSheet = lazy(() => import("./MoveSheet"));
const ViewerInfo = lazy(() => import("./ViewerInfo"));

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
  /** Fing auf einem Knopf an (Abspielen …) → kein Antippen zum Ein-/Ausblenden */
  onButton?: boolean;
  /** Wischrichtung, sobald klar: seitwärts = blättern, nach unten = schliessen */
  axis?: "x" | "y";
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
/** So lange warten, ob ein zweiter Tipp folgt (Doppeltippen = Zoom), bevor die Leisten umschalten */
const TAP_WAIT_MS = 280;
/** Nach unten wischen: ab so weit (px) oder so schnell (px/ms) schliesst die Ansicht */
const DISMISS_PX = 110;
const DISMISS_SPEED = 0.6;
const keyOf = (i: Item) => `${i.account_id}|${i.drive_id}`;

/** So viele Bilder in Blätterrichtung vorladen */
const PRELOAD_AHEAD = 4;
/** Zuletzt vorab dekodiertes Bild – festhalten, damit der Browser das Dekodierte nicht gleich verwirft */
const predecoded: HTMLImageElement[] = [];
function predecode(url: string) {
  const img = new Image();
  img.src = url;
  predecoded.splice(0, predecoded.length, img);
  return img.decode().catch(() => undefined);
}
/** Farbe der Statusleiste im aktuellen Design */
const designColor = () => THEMES.find((t) => t.id === currentTheme())?.themeColor ?? "#000000";
/** Zwei #rrggbb-Farben mischen (t = 0 → a, t = 1 → b) */
function mixHex(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, "0"))
    .join("")}`;
}
const tf = (n: Zoom) => (n.s !== 1 || n.x || n.y ? `translate3d(${n.x}px, ${n.y}px, 0) scale(${n.s})` : "");
const rubber = (v: number, lo: number, hi: number) => (v > hi ? hi + (v - hi) * RUBBER : v < lo ? lo - (lo - v) * RUBBER : v);

export default function Viewer({
  items,
  index,
  accounts,
  onIndex,
  onClose,
  onChanged,
  action,
}: {
  items: Item[];
  index: number;
  accounts: Account[];
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Etwas wurde gelöscht, umbenannt oder verschoben – wird beim Schliessen gemeldet (Liste neu laden) */
  onChanged?: () => void;
  /** Zusätzlicher Knopf unten, z. B. „In ‚Pikachu‘ verschieben“ */
  action?: { label: string; icon: string; run: (item: Item) => void };
}) {
  // Änderungen aus der Ansicht selbst (Umbenennen, Verschieben, Löschen) – die Liste des Aufrufers bleibt
  // unangetastet, solange die Ansicht offen ist; beim Schliessen meldet onChanged, dass sie neu laden soll.
  const [patches, setPatches] = useState<Map<string, Partial<Item>>>(() => new Map());
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const changed = useRef(false);
  /** Laufende Drive-Aufrufe (Löschen, Abgleich) – erst danach die Listen neu laden */
  const pending = useRef<Promise<unknown>[]>([]);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  // Erst beim Schliessen neu laden: sonst verschöbe sich die Liste unter der offenen Ansicht
  useEffect(
    () => () => {
      if (!changed.current) return;
      void Promise.allSettled(pending.current).then(() => {
        invalidateAll();
        window.dispatchEvent(new Event("drivepool-changed"));
        onChangedRef.current?.();
      });
    },
    [],
  );
  const patchItem = (k: string, p: Partial<Item>) => {
    changed.current = true;
    setPatches((m) => new Map(m).set(k, { ...m.get(k), ...p }));
  };
  const raw = items[index];
  const item: Item = patches.has(keyOf(raw)) ? { ...raw, ...patches.get(keyOf(raw)) } : raw;
  /** Nächstes/voriges noch vorhandenes Foto */
  const step = (dir: 1 | -1): number | null => {
    for (let j = index + dir; j >= 0 && j < items.length; j += dir) if (!gone.has(keyOf(items[j]))) return j;
    return null;
  };
  const visibleTotal = items.length - gone.size;
  const visiblePos = items.slice(0, index).filter((i) => !gone.has(keyOf(i))).length + 1;
  // Nur ein anderes Foto (nicht ein neu geladenes Objekt desselben Fotos) setzt Zoom & Bilder zurück
  const itemKey = `${item.account_id}|${item.drive_id}`;
  // Sofort: kleine Vorschau aus dem Speicher, dann die scharfe Version
  const [low, setLow] = useState<string | null>(() => peekThumb(item));
  const [high, setHigh] = useState<string | null>(() => peekThumb(item, VIEW_SIZE));
  const [error, setError] = useState(false);
  const [dx, setDx] = useState(0);
  // Blättern: aus welcher Richtung das neue Foto kommt, und das alte, das hinausgleitet
  const [enter, setEnter] = useState<0 | 1 | -1>(0);
  const [leaving, setLeaving] = useState<{ src: string; dir: 1 | -1; from: number; id: number } | null>(null);
  const flip = (to: number, dir: 1 | -1) => {
    // Nicht das Original: dessen Adresse wird beim Fotowechsel freigegeben
    const src = high ?? low;
    if (src) {
      const id = Date.now();
      setLeaving({ src, dir, from: dx, id });
      setTimeout(() => setLeaving((l) => (l?.id === id ? null : l)), 300);
    }
    setEnter(dir);
    onIndex(to);
  };
  // Nach unten wischen → Ansicht schliessen (Foto folgt dem Finger, Hintergrund wird durchsichtig)
  const [dy, setDy] = useState(0);
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
  const [menu, setMenu] = useState(false);
  const [moving, setMoving] = useState(false);
  const [info, setInfo] = useState(false);
  // Helles Design: weisser Hintergrund, bis man antippt (dann schwarz) – wie die Fotos-App auf dem iPhone
  const light = isLight(currentTheme());
  // Antippen blendet Titel- und Infoleiste aus (wie in Google Drive) – das Foto nutzt dann den ganzen Bildschirm.
  // Bleibt beim Weiterwischen so, bis man wieder tippt.
  const [immersive, setImmersive] = useState(false);
  const tapTimer = useRef(0);
  const scheduleToggle = () => {
    clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(() => setImmersive((v) => !v), TAP_WAIT_MS);
  };
  const cancelToggle = () => clearTimeout(tapTimer.current);
  useEffect(() => () => clearTimeout(tapTimer.current), []);
  // Statusleiste (Uhr, Akku) und Browserleiste in der Farbe des Hintergrunds – sonst bliebe sie im hellen
  // Design hell, während das Foto nach dem Antippen auf Schwarz liegt. Beim Herunterwischen blendet sie
  // mit dem Hintergrund zur Farbe des Designs über, beim Schliessen ganz zurück.
  const bgColor = light && !immersive ? "#ffffff" : "#000000";
  const statusFade = closing ? 1 : dy ? Math.min(dy / 350, 0.9) : 0;
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mixHex(bgColor, designColor(), statusFade));
  }, [bgColor, statusFade]);
  useEffect(
    () => () => {
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", designColor());
    },
    [],
  );
  // Höhe der Leisten messen: so weit reicht das Foto im Normalzustand, ausgeblendet bis an den Rand
  const topEl = useRef<HTMLDivElement>(null);
  const bottomEl = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState({ top: 0, bottom: 0 });
  useLayoutEffect(() => {
    const measure = () => setBars({ top: topEl.current?.offsetHeight ?? 0, bottom: bottomEl.current?.offsetHeight ?? 0 });
    measure();
    const ro = new ResizeObserver(measure);
    if (topEl.current) ro.observe(topEl.current);
    if (bottomEl.current) ro.observe(bottomEl.current);
    return () => ro.disconnect();
  }, []);
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

  const rename = async () => {
    const old = item;
    const dot = old.name.lastIndexOf(".");
    const ext = dot > 0 ? old.name.slice(dot) : "";
    const taken = new Set(
      (cachedFolder(old.parent_key ?? "")?.content.files ?? []).filter((f) => keyOf(f) !== keyOf(old)).map((f) => f.name.toLowerCase()),
    );
    const v = await ui.prompt({
      title: "Umbenennen",
      initial: old.name,
      confirmLabel: "Umbenennen",
      validate: (s) => (s.includes("/") ? "Kein „/“ im Namen" : null),
    });
    if (!v || v === old.name) return;
    // Endung vergessen → die alte wieder anhängen
    const name = ext && !/\.[a-z0-9]{2,5}$/i.test(v) ? v + ext : v;
    if (taken.has(name.toLowerCase())) return ui.toast(`„${name}“ gibt es in diesem Ordner schon`, "error");
    try {
      await updateItem(old.account_id, old.drive_id, { name });
      patchItem(keyOf(old), { name, path: old.path ? old.path.replace(/[^/]*$/, name) : old.path });
      ui.toast("Umbenannt", "ok");
      offerUndo(`„${old.name}“ → „${name}“`, async () => {
        await undoFileRenames([old])();
        patchItem(keyOf(old), { name: old.name, path: old.path });
      });
      void writeLogs([{ kind: "rename", message: `„${old.name}“ → „${name}“` }]).catch(() => undefined);
      pending.current.push(syncAccounts([old.account_id]).catch(() => undefined));
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const remove = async () => {
    const it = item;
    const ok = await ui.confirm({
      title: `${isVideo ? "Video" : "Foto"} löschen?`,
      message: "Es landet im Papierkorb des Google-Kontos.",
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    const next = step(1) ?? step(-1);
    changed.current = true;
    setGone((g) => new Set(g).add(keyOf(it)));
    if (next === null) close();
    else onIndex(next);
    const job = trashFiles([it]);
    pending.current.push(job.catch(() => undefined));
    offerUndo(`„${it.name}“ gelöscht`, async () => {
      // Erst fertig löschen lassen, dann zurückholen
      await job.catch(() => undefined);
      await undoTrash([it])();
      setGone((g) => {
        const n = new Set(g);
        n.delete(keyOf(it));
        return n;
      });
    });
    job
      .then((r) => r.failed.length && ui.toast(`Nicht gelöscht: ${r.failed[0]}`, "error"))
      .catch((e) => ui.toast(e instanceof Error ? e.message : String(e), "error"));
  };

  useEffect(() => {
    let alive = true;
    let revoke: string | null = null;
    setError(false);
    setDx(0);
    setDy(0);
    commitZ(NO_ZOOM);
    setFull(null);
    setFullState("idle");
    setDims(null);
    setVideo({ state: "idle" });
    setLow(peekThumb(item));
    setHigh(peekThumb(item, VIEW_SIZE));
    if (!peekThumb(item)) void getThumb(item).then((u) => alive && setLow(u)).catch(() => undefined);
    if (!peekThumb(item, VIEW_SIZE)) {
      getThumb(item, VIEW_SIZE, { urgent: true })
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

  // Bilder vorladen → Wischen fühlt sich sofort an. In Blätterrichtung mehrere Seiten voraus
  // (z. B. Comics: man liest schneller, als ein einzelnes Bild nachlädt), eines zurück.
  const lastIndex = useRef(index);
  useEffect(() => {
    const dir = index < lastIndex.current ? -1 : 1;
    lastIndex.current = index;
    const order = [...Array.from({ length: PRELOAD_AHEAD }, (_, k) => index + dir * (k + 1)), index - dir];
    order.forEach((j, k) => {
      const it = items[j];
      if (!it) return;
      const p = getThumb(it, VIEW_SIZE);
      // Das nächste Bild gleich fertig dekodieren → beim Wischen kein kurzes Leerbild
      if (k === 0) void p.then((u) => predecode(u)).catch(() => undefined);
      else void p.catch(() => undefined);
    });
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
      cancelToggle();
      setZooming(true);
      setDragging(false);
      setDx(0);
      loadFull();
      return;
    }
    if (t.length !== 1) return;
    const z0 = zRef.current;
    const onButton = !!(e.target as HTMLElement).closest("button, video");
    g.current = { mode: z0.s > 1.01 ? "pan" : "swipe", d0: 0, m0: { x: 0, y: 0 }, z0, sx: t[0].clientX, sy: t[0].clientY, moved: false, onButton };
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
    else if (gs.mode === "swipe" && startX.current !== null) {
      if (!gs.axis && Math.abs(mx) + Math.abs(my) > 10) gs.axis = my > 0 && Math.abs(my) > Math.abs(mx) ? "y" : "x";
      if (gs.axis === "x") setDx(mx);
      else if (gs.axis === "y") {
        const now = performance.now();
        if (gs.lt !== undefined) gs.vy = 0.7 * ((t[0].clientY - gs.ly!) / Math.max(1, now - gs.lt)) + 0.3 * (gs.vy ?? 0);
        gs.lt = now;
        gs.ly = t[0].clientY;
        setDy(Math.max(0, my));
      }
    }
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
      startX.current = null;
      if (gs.axis === "y") {
        const fresh = gs.lt !== undefined && performance.now() - gs.lt < 80;
        if (dy > DISMISS_PX || (fresh && (gs.vy ?? 0) > DISMISS_SPEED)) close();
        else setDy(0);
        g.current = null;
        return;
      }
      const prev = step(-1);
      const next = step(1);
      if (dx > 70 && prev !== null) flip(prev, -1);
      else if (dx < -70 && next !== null) flip(next, 1);
      else setDx(0);
    }
    setZooming(false);
    g.current = null;
    // Doppeltippen: hineinzoomen an dieser Stelle bzw. zurück auf 100 %
    // Einfaches Tippen: Leisten ein-/ausblenden (erst wenn sicher kein zweiter Tipp kommt)
    if (!gs.moved && !gs.onButton) {
      const now = Date.now();
      const p = rel(gs.sx, gs.sy);
      const prev = lastTap.current;
      if (prev && now - prev.t < 300 && Math.hypot(prev.x - p.x, prev.y - p.y) < 40) {
        lastTap.current = null;
        cancelToggle();
        toggleZoom(p);
      } else {
        lastTap.current = { t: now, x: p.x, y: p.y };
        scheduleToggle();
      }
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

  /** Ordner, in dem das Foto liegt (Pfad ohne Dateinamen) */
  const folderPath = item.path ? (item.path.includes("/") ? item.path.replace(/\/[^/]*$/, "") : "Drive") : null;
  const accIndex = accounts.findIndex((a) => a.id === item.account_id);
  const account = accounts[accIndex];
  // Seitwärts: nur verschieben (kein Kippen, kein Ausblenden). Nach unten: verschieben und etwas kleiner.
  const style = {
    transform: dy ? `translateY(${dy}px) scale(${1 - Math.min(dy / 1600, 0.25)})` : dx ? `translateX(${dx}px)` : undefined,
  };
  /** Hintergrund beim Herunterwischen ausblenden – dahinter erscheint wieder die Liste */
  const bgOpacity = dy ? 1 - Math.min(dy / 350, 0.9) : undefined;

  // Direkt an <body>: so liegt das Foto immer über dem ganzen Bildschirm – auch wenn es aus einem Fenster
  // (Suche, KI-Treffer) geöffnet wird, das seinen Inhalt sonst abschneidet oder darüber liegt.
  return createPortal(
    <div className={`viewer ${closing ? "closing" : ""} ${immersive ? "immersive" : ""} ${light ? "light" : ""} ${dy ? "dismissing" : ""}`}>
      <div className="viewer-bg" style={{ opacity: bgOpacity }} />
      <div ref={topEl} className="viewer-top" aria-hidden={immersive || undefined}>
        <button className="icon-btn glass" onClick={close} aria-label="Schliessen">
          <Icon name="x" />
        </button>
        <span className="viewer-title">{item.name}</span>
        <span className="muted small">
          {visiblePos}/{visibleTotal}
        </span>
        <button className={`icon-btn glass fav-btn ${fav ? "on" : ""}`} onClick={heart} aria-label="Favorit">
          <Icon name="heart" size={20} />
        </button>
        <button className="icon-btn glass" onClick={() => setMoving(true)} aria-label="Verschieben">
          <Icon name="move" size={19} />
        </button>
        <button className="icon-btn glass" onClick={rename} aria-label="Umbenennen">
          <Icon name="pencil" size={18} />
        </button>
        <button className="icon-btn glass tag-btn" onClick={() => setMenu(true)} aria-label="Mehr" aria-expanded={menu}>
          <Icon name="more" size={20} />
          {markerDots.length > 0 && (
            <span className="tag-btn-dots">
              {markerDots.slice(0, 3).map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
          )}
        </button>
      </div>
      {menu && (
        <>
          <div className="menu-backdrop viewer-menu-layer" onClick={() => setMenu(false)} />
          <div className="menu glass viewer-menu" onClick={() => setMenu(false)}>
            <button onClick={() => setTagging(true)}>
              <Icon name="tag" size={19} /> Tags setzen
              {itemTags.length > 0 && <span className="faint small menu-count">{itemTags.length}</span>}
            </button>
            {/* KI-SUCHE */}
            {ai && (
              <button onClick={() => setSimilar(true)}>
                <Icon name="sparkles" size={19} /> Ähnliche Fotos
              </button>
            )}
            <button onClick={() => setSharing(true)}>
              <Icon name="link" size={19} /> Link teilen
            </button>
            <button onClick={() => setInfo(true)}>
              <Icon name="info" size={19} /> Info
            </button>
            <button className="danger" onClick={remove}>
              <Icon name="trash" size={19} /> Löschen
            </button>
          </div>
        </>
      )}
      <div
        ref={stageRef}
        className="viewer-stage"
        style={immersive ? undefined : { top: bars.top, bottom: bars.bottom }}
        // Grösse hat sich geändert (Leisten ein/aus) → Zoom-Ausschnitt wieder in die Grenzen holen
        onTransitionEnd={(e) => e.target === e.currentTarget && zRef.current.s > 1.01 && commitZ(clampZ(zRef.current))}
        onClick={(e) => {
          // Maus: Klick blendet die Leisten um, Doppelklick zoomt
          if (Date.now() - lastTouch.current < 800 || (e.target as HTMLElement).closest("button, video")) return;
          if (e.detail === 1) scheduleToggle();
          else cancelToggle();
        }}
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
        {leaving && (
          <div
            key={leaving.id}
            className={`viewer-frame leaving ${leaving.dir === 1 ? "to-left" : "to-right"}`}
            style={{ ["--from" as string]: `${leaving.from}px` }}
          >
            <img src={leaving.src} alt="" />
          </div>
        )}
        {error && !low && !isVideo ? (
          <p className="muted">Bild konnte nicht geladen werden.</p>
        ) : high || low || isVideo ? (
          <div
            key={item.drive_id}
            className={`viewer-frame ${dragging ? "dragging" : ""} ${enter === 1 ? "enter-next" : enter === -1 ? "enter-prev" : ""}`}
            style={style}
          >
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
      <div ref={bottomEl} className="viewer-bottom" aria-hidden={immersive || undefined}>
      {action && (
        <button className="btn primary viewer-action" onClick={() => action.run(item)}>
          <Icon name={action.icon} size={18} /> {action.label}
        </button>
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
        {folderPath && (
          <span className="chip-lite">
            <Icon name="folder" size={15} /> {folderPath}
          </span>
        )}
        {item.description && <span className="chip-lite">{item.description}</span>}
      </div>
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
      {moving && (
        <Suspense fallback={null}>
          <MoveSheet
            items={[item]}
            accounts={accounts}
            onClose={(didMove, moved) => {
              setMoving(false);
              const p = moved?.get(keyOf(item));
              if (didMove && p) patchItem(keyOf(item), p);
            }}
          />
        </Suspense>
      )}
      {info && (
        <Suspense fallback={null}>
          <ViewerInfo
            item={item}
            accounts={accounts}
            tags={itemTags}
            ai={ai}
            onTags={() => {
              setInfo(false);
              setTagging(true);
            }}
            onClose={() => setInfo(false)}
          />
        </Suspense>
      )}
      {/* KI-SUCHE */}
      {similar && (
        <Suspense fallback={null}>
          <SimilarSheet item={item} accounts={accounts} onClose={() => setSimilar(false)} />
        </Suspense>
      )}
    </div>,
    document.body,
  );
}
