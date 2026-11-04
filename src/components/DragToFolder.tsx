// Fotos per Ziehen in einen Ordner verschieben: Foto gedrückt halten, auf einen Ordner (oder einen
// Ordner oben im Pfad) ziehen und loslassen. Danach öffnet sich das Verschieben-Fenster gleich mit
// diesem Ziel – ohne Konflikte wird direkt verschoben.
// Ziele markieren sich mit data-drop-key / data-drop-path / data-drop-name.
import { useEffect, useRef, useState } from "react";
import { haptic } from "../lib/haptic";
import type { Crumb } from "../lib/types";

const HOLD_MS = 450;
const MOVE_TOLERANCE = 10;
const EDGE = 90; // Abstand zum Rand, ab dem automatisch gescrollt wird

interface Drag<T> {
  payload: T;
  count: number;
  img: string | null;
  x: number;
  y: number;
}

/**
 * Gedrückthalten-und-Ziehen. `begin` liefert, was gezogen wird (oder null = nicht ziehen).
 * `onDrop` bekommt das Ziel, wenn über einem Ordner losgelassen wurde.
 */
export function useDragToFolder<T>({
  begin,
  onDrop,
  disabled,
}: {
  begin: (el: HTMLElement) => { payload: T; count: number; exclude?: Set<string> } | null;
  onDrop: (payload: T, target: Crumb) => void;
  disabled?: boolean;
}) {
  const [drag, setDrag] = useState<Drag<T> | null>(null);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number; el: HTMLElement } | null>(null);
  const active = useRef<{ payload: T; exclude: Set<string> } | null>(null);
  const pos = useRef({ x: 0, y: 0 });
  const hover = useRef<HTMLElement | null>(null);
  /** Nach einem Ziehen keinen Klick auslösen (sonst öffnet sich das Foto) */
  const swallowClick = useRef(false);
  const latest = useRef({ onDrop });
  latest.current = { onDrop };

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

  // Während des Ziehens: Finger verfolgen, Seite nicht scrollen, am Rand automatisch scrollen
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    const move = (x: number, y: number) => {
      pos.current = { x, y };
      setDrag((d) => (d ? { ...d, x, y } : d));
      setHover(targetAt(x, y));
    };
    const onPointerMove = (e: PointerEvent) => move(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault(); // kein Scrollen, kein „Ziehen zum Aktualisieren“
      const t = e.touches[0];
      if (t) move(t.clientX, t.clientY);
    };
    const end = () => {
      const target = hover.current;
      const a = active.current;
      setHover(null);
      active.current = null;
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setHover(null);
      end();
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
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("touchend", end);
    window.addEventListener("keydown", onKey);
    document.body.classList.add("drag-moving");
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("touchend", end);
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("drag-moving");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  /** Auf jedes Foto legen: {...bind} */
  const bind = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || e.button > 0) return;
      swallowClick.current = false;
      const el = e.currentTarget;
      start.current = { x: e.clientX, y: e.clientY, el };
      if (timer.current) clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const s = start.current;
        timer.current = null;
        if (!s) return;
        const what = begin(s.el);
        if (!what) return;
        swallowClick.current = true;
        active.current = { payload: what.payload, exclude: what.exclude ?? new Set() };
        haptic();
        pos.current = { x: s.x, y: s.y };
        setDrag({ payload: what.payload, count: what.count, img: s.el.querySelector("img")?.src ?? null, x: s.x, y: s.y });
      }, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const s = start.current;
      if (s && timer.current && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) cancelHold();
    },
    onPointerUp: () => timer.current && cancelHold(),
    onPointerCancel: () => timer.current && cancelHold(),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(), // iOS/Desktop-Menü beim Gedrückthalten
    onClickCapture: (e: React.MouseEvent) => {
      if (!swallowClick.current) return;
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
      {drag.count > 1 && <span className="drag-ghost-count">{drag.count}</span>}
      <span className="drag-ghost-hint">Auf Ordner ziehen</span>
    </div>
  );
}
