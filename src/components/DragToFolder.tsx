// Fotos per Ziehen in einen Ordner verschieben: Foto gedrückt halten, auf einen Ordner (oder einen
// Ordner oben im Pfad) ziehen und loslassen. Danach öffnet sich das Verschieben-Fenster gleich mit
// diesem Ziel – ohne Konflikte wird direkt verschoben.
// Während des Ziehens:
// - mit einem zweiten Finger wischen = Seite scrollen (der Bildschirm bleibt nicht gesperrt)
// - mit einem zweiten Finger weitere Fotos antippen = werden mitgenommen
// Ziele markieren sich mit data-drop-key / data-drop-path / data-drop-name.
import { useEffect, useRef, useState } from "react";
import { haptic } from "../lib/haptic";
import type { Crumb } from "../lib/types";

const HOLD_MS = 450;
const MOVE_TOLERANCE = 10;
const EDGE = 90; // Abstand zum Rand, ab dem automatisch gescrollt wird
/** Zweiter Finger: so kurz und ruhig = Antippen (sonst Scrollen) */
const TAP_MS = 400;

interface Drag<T> {
  payload: T;
  count: number;
  img: string | null;
  x: number;
  y: number;
}

/**
 * Gedrückthalten-und-Ziehen. `begin` liefert, was gezogen wird (oder null = nicht ziehen).
 * `add` nimmt ein angetipptes Element dazu (oder null = nichts zu tun).
 * `onDrop` bekommt das Ziel, wenn über einem Ordner losgelassen wurde.
 */
export function useDragToFolder<T>({
  begin,
  add,
  onDrop,
  disabled,
}: {
  begin: (el: HTMLElement) => { payload: T; count: number; exclude?: Set<string> } | null;
  add?: (payload: T, el: HTMLElement) => { payload: T; count: number } | null;
  onDrop: (payload: T, target: Crumb) => void;
  disabled?: boolean;
}) {
  const [drag, setDrag] = useState<Drag<T> | null>(null);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number; el: HTMLElement } | null>(null);
  const active = useRef<{ payload: T; count: number; exclude: Set<string> } | null>(null);
  const pos = useRef({ x: 0, y: 0 });
  const hover = useRef<HTMLElement | null>(null);
  /** Finger bzw. Zeiger, der zieht (alle anderen scrollen oder tippen) */
  const dragPointer = useRef<number | null>(null);
  const dragTouch = useRef<number | null>(null);
  /** Nach einem Ziehen keinen Klick auslösen (sonst öffnet sich das Foto) */
  const swallowClick = useRef(false);
  const latest = useRef({ onDrop, add });
  latest.current = { onDrop, add };

  const cancelHold = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  const targetAt = (x: number, y: number): HTMLElement | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-key]") ?? null;
    if (!el || active.current?.exclude.has(el.dataset.dropKey ?? "")) return null;
    return el;
  };

  const setHover = (el: HTMLElement | null) => {
    if (el === hover.current) return;
    hover.current?.classList.remove("drop-hover");
    hover.current = el;
    if (el) {
      el.classList.add("drop-hover");
      haptic();
    }
  };

  // Während des Ziehens: Finger verfolgen, am Rand automatisch scrollen, zweiter Finger scrollt/tippt
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    /** Weitere Finger: Startpunkt/-zeit und letzte Position */
    const others = new Map<number, { x0: number; y0: number; t0: number; y: number; moved: boolean }>();

    const move = (x: number, y: number) => {
      pos.current = { x, y };
      setDrag((d) => (d ? { ...d, x, y } : d));
      setHover(targetAt(x, y));
    };
    const isDragTouch = (t: Touch) => {
      // Finger noch unbekannt (z. B. Maus-Emulation): der, der am nächsten beim Vorschaubild ist
      if (dragTouch.current === null) dragTouch.current = t.identifier;
      return t.identifier === dragTouch.current;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // Finger laufen über die Touch-Ereignisse
      if (dragPointer.current !== null && e.pointerId !== dragPointer.current) return;
      move(e.clientX, e.clientY);
    };
    const onTouchStart = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === dragTouch.current) continue;
        others.set(t.identifier, { x0: t.clientX, y0: t.clientY, t0: Date.now(), y: t.clientY, moved: false });
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault(); // kein Seiten-Scrollen durch den Browser, kein „Ziehen zum Aktualisieren“
      let scroll = 0;
      for (const t of Array.from(e.touches)) {
        if (isDragTouch(t)) {
          move(t.clientX, t.clientY);
          continue;
        }
        // Zweiter Finger: selbst scrollen (Finger nach oben = Inhalt nach oben)
        const o = others.get(t.identifier);
        if (!o) {
          others.set(t.identifier, { x0: t.clientX, y0: t.clientY, t0: Date.now(), y: t.clientY, moved: false });
          continue;
        }
        if (!o.moved && Math.hypot(t.clientX - o.x0, t.clientY - o.y0) > MOVE_TOLERANCE) o.moved = true;
        if (o.moved && !scroll) scroll = o.y - t.clientY;
        o.y = t.clientY;
      }
      if (scroll) {
        window.scrollBy(0, scroll);
        setHover(targetAt(pos.current.x, pos.current.y));
      }
    };
    const finish = (drop: boolean) => {
      const target = drop ? hover.current : null;
      const a = active.current;
      setHover(null);
      active.current = null;
      dragPointer.current = null;
      dragTouch.current = null;
      setDrag(null);
      if (target && a) {
        haptic();
        latest.current.onDrop(a.payload, {
          key: target.dataset.dropKey ?? "",
          path: target.dataset.dropPath ?? "",
          name: target.dataset.dropName ?? "",
        });
      }
    };
    const tapAdd = (x: number, y: number) => {
      const a = active.current;
      const fn = latest.current.add;
      if (!a || !fn) return;
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-item-key]");
      if (!el) return;
      const next = fn(a.payload, el);
      if (!next) return;
      a.payload = next.payload;
      a.count = next.count;
      haptic();
      setDrag((d) => (d ? { ...d, payload: next.payload, count: next.count } : d));
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // Finger: siehe touchend
      if (dragPointer.current !== null && e.pointerId !== dragPointer.current) return;
      finish(true);
    };
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault(); // kein „Klick“ auf ein Foto (würde es öffnen bzw. an-/abwählen)
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === dragTouch.current || dragTouch.current === null) {
          finish(e.type === "touchend");
          return;
        }
        const o = others.get(t.identifier);
        others.delete(t.identifier);
        if (e.type === "touchend" && o && !o.moved && Date.now() - o.t0 < TAP_MS) tapAdd(t.clientX, t.clientY);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    };
    const tick = () => {
      const { y } = pos.current;
      const dy = y < EDGE ? -(EDGE - y) / 6 : y > innerHeight - EDGE - 40 ? (y - (innerHeight - EDGE - 40)) / 6 : 0;
      if (dy) {
        window.scrollBy(0, dy);
        setHover(targetAt(pos.current.x, pos.current.y));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const opts = { passive: false } as const;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("touchstart", onTouchStart, opts);
    window.addEventListener("touchmove", onTouchMove, opts);
    window.addEventListener("touchend", onTouchEnd, opts);
    window.addEventListener("touchcancel", onTouchEnd, opts);
    window.addEventListener("keydown", onKey);
    document.body.classList.add("drag-moving");
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("drag-moving");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  /** Auf jedes Foto legen: {...bind} */
  const bind = {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      // Welcher Finger hält das Foto? (Während des Ziehens: zweiter Finger → nicht neu beginnen)
      if (!active.current) dragTouch.current = e.changedTouches[0]?.identifier ?? null;
    },
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || e.button > 0 || active.current) return;
      swallowClick.current = false;
      const el = e.currentTarget;
      start.current = { x: e.clientX, y: e.clientY, el };
      dragPointer.current = e.pointerId;
      if (timer.current) clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const s = start.current;
        timer.current = null;
        if (!s) return;
        const what = begin(s.el);
        if (!what) return;
        swallowClick.current = true;
        active.current = { payload: what.payload, count: what.count, exclude: what.exclude ?? new Set() };
        haptic();
        pos.current = { x: s.x, y: s.y };
        setDrag({ payload: what.payload, count: what.count, img: s.el.querySelector("img")?.src ?? null, x: s.x, y: s.y });
      }, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const s = start.current;
      if (s && timer.current && e.pointerId === dragPointer.current && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) {
        cancelHold();
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => timer.current && e.pointerId === dragPointer.current && cancelHold(),
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => timer.current && e.pointerId === dragPointer.current && cancelHold(),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(), // iOS/Desktop-Menü beim Gedrückthalten
    onClickCapture: (e: React.MouseEvent) => {
      if (!swallowClick.current && !active.current) return;
      swallowClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };

  return { bind, drag, isDragging: () => !!active.current };
}

/** Das Vorschaubild unter dem Finger, mit Anzahl und Hinweis. */
export function DragGhost({ drag }: { drag: { count: number; img: string | null; x: number; y: number } | null }) {
  if (!drag) return null;
  return (
    <div className="drag-ghost" style={{ transform: `translate(${drag.x - 36}px, ${drag.y - 84}px)` }} aria-hidden>
      <div className="drag-ghost-img">{drag.img ? <img src={drag.img} alt="" draggable={false} /> : null}</div>
      {drag.count > 1 && (
        <span key={drag.count} className="drag-ghost-count">
          {drag.count}
        </span>
      )}
      <span className="drag-ghost-hint">Auf Ordner ziehen · Fotos antippen = dazu</span>
    </div>
  );
}
