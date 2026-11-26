// Universell: Solange ein Fenster offen ist (Sheet, Menü, Dialog, Foto-Ansicht), bewegt sich die Seite
// dahinter nicht mehr. Auf dem iPhone scrollte sonst beim Wischen im Fenster oft die Seite dahinter mit
// (z. B. der Ordner, in dem „Hochladen“ gedrückt wurde).
const OVERLAYS = ".sheet-backdrop, .modal-backdrop, .menu-backdrop, .viewer, .lock-screen";

let lockedAt: number | null = null;

/** Ist gerade ein Fenster offen (Seite dahinter gesperrt)? */
export const isScrollLocked = () => lockedAt !== null;

function lock() {
  if (lockedAt !== null) return;
  lockedAt = window.scrollY;
  const b = document.body.style;
  b.position = "fixed";
  b.top = `-${lockedAt}px`;
  b.left = "0";
  b.right = "0";
  b.width = "100%";
}

function unlock() {
  if (lockedAt === null) return;
  const y = lockedAt;
  lockedAt = null;
  const b = document.body.style;
  b.position = "";
  b.top = "";
  b.left = "";
  b.right = "";
  b.width = "";
  nativeScrollTo(0, y);
}

const nativeScrollTo = window.scrollTo.bind(window) as (x: number, y: number) => void;

/**
 * Oberstes offenes Fenster: ein Dialog liegt immer oben, sonst das zuletzt geöffnete
 * (Fenster und Foto-Ansicht hängen in der Reihenfolge des Öffnens im Dokument).
 */
export function topOverlay(): Element | null {
  const modal = document.querySelector(".modal-backdrop");
  if (modal) return modal;
  const all = document.querySelectorAll(".sheet-backdrop, .menu-backdrop, .viewer");
  return all[all.length - 1] ?? null;
}

/** Esc schliesst das oberste Fenster (wie ein Tipp daneben). Die Foto-Ansicht kümmert sich selbst darum. */
function onEscape(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented || document.body.classList.contains("drag-moving")) return;
  const top = topOverlay();
  if (!top || top.classList.contains("viewer")) return;
  e.preventDefault();
  (top as HTMLElement).click();
}

/** Einmal beim Start aufrufen: beobachtet, ob ein Fenster offen ist. */
export function initScrollLock() {
  // Springt die App während eines offenen Fensters woandershin (z. B. Ordner öffnen → nach oben),
  // gilt diese Stelle nach dem Schliessen – nicht die alte
  window.scrollTo = ((a?: ScrollToOptions | number, b?: number) => {
    const top = typeof a === "object" ? a?.top : b;
    if (lockedAt !== null) {
      if (typeof top === "number") lockedAt = top;
      return;
    }
    if (typeof a === "object") window.scroll(a);
    else nativeScrollTo(a ?? 0, b ?? 0);
  }) as typeof window.scrollTo;
  window.addEventListener("keydown", onEscape);
  window.addEventListener("hashchange", () => {
    if (lockedAt !== null) lockedAt = 0;
  });
  let queued = false;
  const check = () => {
    queued = false;
    if (document.querySelector(OVERLAYS)) lock();
    else unlock();
  };
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(check);
  }).observe(document.body, { childList: true, subtree: true });
}
