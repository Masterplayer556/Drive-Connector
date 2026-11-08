// Designs: Aurora (Standard), Sunset, Polar (hell), Neon, Riso (hell), Tinte. Farben stehen in styles.css unter [data-theme].

export type ThemeId = "aurora" | "sunset" | "polar" | "neon" | "riso" | "tinte";

/** Mini-Ansicht der App für die Design-Kachel unter „Mehr“ (Titel, Speicher-Karte mit Ring, Archiv/Privat). */
export interface ThemePreview {
  bg: string;
  blobs: [string, string, string];
  /** Muster über dem Hintergrund (Raster, Punkte …) */
  overlay?: string;
  title: string;
  card: string;
  cardShadow: string;
  ring: string;
  line: string;
  areas: [string, string];
  areaShadow: string;
  radius: number;
}

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  description: string;
  light: boolean;
  /** Gegenstück für „Automatisch hell/dunkel“ (hell ↔ dunkel) */
  pair: ThemeId;
  themeColor: string;
  preview: ThemePreview;
}

const INK = "#1b1a17";

export const THEMES: ThemeInfo[] = [
  {
    id: "aurora",
    pair: "polar",
    name: "Aurora",
    description: "Nordlicht in Violett & Türkis",
    light: false,
    themeColor: "#060913",
    preview: {
      bg: "radial-gradient(120% 80% at 50% -10%, #111a3a, #060913 60%)",
      blobs: ["#7c3aed", "#0ea5e9", "#db2777"],
      title: "linear-gradient(100deg,#c4b5fd,#93c5fd,#67e8f9)",
      card: "linear-gradient(165deg,rgba(255,255,255,.2),rgba(255,255,255,.06))",
      cardShadow: "inset 0 1px 0 rgba(255,255,255,.45), inset 0 0 0 .5px rgba(255,255,255,.2)",
      ring: "conic-gradient(#8b5cf6 0 18%,transparent 0 20%,#0891b2 0 32%,transparent 0 34%,#d97706 0 42%,rgba(255,255,255,.12) 0)",
      line: "rgba(255,255,255,.35)",
      areas: ["linear-gradient(140deg,#6d28d9,#2563eb 60%,#0891b2)", "linear-gradient(140deg,#db2777,#e11d48 45%,#f97316)"],
      areaShadow: "inset 0 1px 0 rgba(255,255,255,.5)",
      radius: 9,
    },
  },
  {
    id: "sunset",
    pair: "polar",
    name: "Sunset",
    description: "Goldene Stunde über dem Meer",
    light: false,
    themeColor: "#12060c",
    preview: {
      bg: "radial-gradient(90% 60% at 50% 120%, #c2410c 0%, #4a0f24 45%, #12060c 75%)",
      blobs: ["#f97316", "#db2777", "#7c3aed"],
      title: "linear-gradient(100deg,#fde68a,#fdba74,#f9a8d4)",
      card: "linear-gradient(165deg,rgba(255,228,214,.2),rgba(255,228,214,.06))",
      cardShadow: "inset 0 1px 0 rgba(255,236,224,.5), inset 0 0 0 .5px rgba(255,220,200,.22)",
      ring: "conic-gradient(#fbbf24 0 18%,transparent 0 20%,#f43f5e 0 32%,transparent 0 34%,#a855f7 0 42%,rgba(255,230,220,.14) 0)",
      line: "rgba(255,226,214,.38)",
      areas: ["linear-gradient(150deg,#fbbf24,#f97316 45%,#e11d48)", "linear-gradient(150deg,#7c3aed,#c026d3 55%,#fb7185)"],
      areaShadow: "inset 0 1px 0 rgba(255,255,255,.5)",
      radius: 9,
    },
  },
  {
    id: "polar",
    pair: "aurora",
    name: "Polar",
    description: "Hell & klar, ideal bei Sonne",
    light: true,
    themeColor: "#eef2fb",
    preview: {
      bg: "radial-gradient(120% 80% at 50% -10%, #dde5ff, #eef2fb 60%)",
      blobs: ["#a5b4fc", "#7dd3fc", "#f9a8d4"],
      title: "linear-gradient(100deg,#4f46e5,#2563eb,#0891b2)",
      card: "rgba(255,255,255,.82)",
      cardShadow: "inset 0 1px 0 #fff, 0 4px 12px rgba(42,54,110,.12)",
      ring: "conic-gradient(#8b5cf6 0 18%,transparent 0 20%,#0891b2 0 32%,transparent 0 34%,#d97706 0 42%,rgba(15,23,42,.08) 0)",
      line: "rgba(15,23,42,.18)",
      areas: ["linear-gradient(140deg,#6366f1,#3b82f6 60%,#06b6d4)", "linear-gradient(140deg,#ec4899,#fb7185 50%,#fb923c)"],
      areaShadow: "0 4px 10px rgba(99,102,241,.25)",
      radius: 9,
    },
  },
  {
    id: "neon",
    pair: "polar",
    name: "Neon",
    description: "Schwarz, Raster, leuchtende Kanten",
    light: false,
    themeColor: "#000000",
    preview: {
      bg: "radial-gradient(100% 50% at 50% 115%, rgba(217,70,239,.35), #000 70%)",
      blobs: ["transparent", "transparent", "transparent"],
      overlay:
        "linear-gradient(rgba(163,230,53,.13) 1px,transparent 1px) 0 0/12px 12px,linear-gradient(90deg,rgba(163,230,53,.13) 1px,transparent 1px) 0 0/12px 12px",
      title: "linear-gradient(100deg,#d9f99d,#a3e635,#22d3ee)",
      card: "rgba(163,230,53,.06)",
      cardShadow: "inset 0 0 0 1px rgba(163,230,53,.7), 0 0 12px rgba(163,230,53,.35)",
      ring: "conic-gradient(#a3e635 0 18%,transparent 0 20%,#22d3ee 0 32%,transparent 0 34%,#e879f9 0 42%,rgba(163,230,53,.12) 0)",
      line: "rgba(163,230,53,.45)",
      areas: ["#040805", "#080406"],
      areaShadow: "inset 0 0 0 1px rgba(163,230,53,.7), 0 0 10px rgba(163,230,53,.3)",
      radius: 5,
    },
  },
  {
    id: "riso",
    pair: "tinte",
    name: "Riso",
    description: "Druckfarbe auf Papier – Pink, Blau, Gelb, harte Kanten",
    light: true,
    themeColor: "#f3ecdc",
    preview: {
      bg: "#f3ecdc",
      blobs: ["transparent", "transparent", "transparent"],
      overlay:
        "radial-gradient(circle at 100% 0, rgba(255,72,176,.55) 1.4px, transparent 1.8px) 0 0/7px 7px",
      title: `linear-gradient(${INK},${INK})`,
      card: "#fffaf0",
      cardShadow: `inset 0 0 0 1.5px ${INK}, 3px 3px 0 ${INK}`,
      ring: "conic-gradient(#ff48b0 0 18%,transparent 0 20%,#0078bf 0 32%,transparent 0 34%,#ffd400 0 42%,rgba(27,26,23,.12) 0)",
      line: "rgba(27,26,23,.35)",
      areas: ["#0078bf", "#ff48b0"],
      areaShadow: `inset 0 0 0 1.5px ${INK}, 3px 3px 0 ${INK}`,
      radius: 7,
    },
  },
  {
    id: "tinte",
    pair: "riso",
    name: "Tinte",
    description: "Tusche, Serifen, ein roter Stempel",
    light: false,
    themeColor: "#0c0b0a",
    preview: {
      bg: "#0c0b0a",
      blobs: ["transparent", "transparent", "transparent"],
      overlay:
        "radial-gradient(circle at 88% 30%, transparent 25px, rgba(242,239,232,.14) 26px, rgba(242,239,232,.1) 31px, transparent 32px)",
      title: "linear-gradient(#f2efe8,#f2efe8)",
      card: "#161513",
      cardShadow: "inset 0 0 0 1px rgba(242,239,232,.16)",
      ring: "conic-gradient(#f2efe8 0 18%,transparent 0 20%,#a29d93 0 32%,transparent 0 34%,#e63b2e 0 42%,rgba(242,239,232,.1) 0)",
      line: "rgba(242,239,232,.3)",
      areas: ["#f2efe8", "#e63b2e"],
      areaShadow: "none",
      radius: 4,
    },
  },
];

export interface ThemePrefs {
  theme: ThemeId;
  /** Hell/Dunkel vom iPhone übernehmen (siehe autoPair) */
  auto: boolean;
}

const KEY = "drivepool.theme";
const DEFAULT: ThemePrefs = { theme: "aurora", auto: false };

export function readPrefs(): ThemePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (raw && THEMES.some((t) => t.id === raw.theme)) return { theme: raw.theme, auto: !!raw.auto };
  } catch {
    /* ignorieren */
  }
  return DEFAULT;
}

const lightQuery = () => window.matchMedia?.("(prefers-color-scheme: light)");

export const isLight = (id: ThemeId) => THEMES.find((t) => t.id === id)?.light ?? false;

/** Mit Automatik: das gewählte Design plus sein Gegenstück (Riso ↔ Tinte, sonst Polar ↔ Aurora bzw. das dunkle Design). */
export function autoPair(theme: ThemeId): { light: ThemeId; dark: ThemeId } {
  const pair = THEMES.find((t) => t.id === theme)?.pair ?? "aurora";
  return isLight(theme) ? { light: theme, dark: pair } : { light: pair, dark: theme };
}

export function resolveTheme(prefs: ThemePrefs): ThemeId {
  if (!prefs.auto) return prefs.theme;
  const pair = autoPair(prefs.theme);
  return lightQuery()?.matches ? pair.light : pair.dark;
}

/** Wird bei jedem Designwechsel ausgelöst (z. B. für das Speicher-Diagramm). */
export const THEME_EVENT = "drivepool:theme";

export function currentTheme(): ThemeId {
  const id = document.documentElement.dataset.theme as ThemeId | undefined;
  return id && THEMES.some((t) => t.id === id) ? id : "aurora";
}

export function applyTheme(prefs: ThemePrefs, animate = false) {
  const id = resolveTheme(prefs);
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-switching");
    setTimeout(() => root.classList.remove("theme-switching"), 600);
  }
  root.dataset.theme = id;
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: id }));
  const info = THEMES.find((t) => t.id === id)!;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", info.themeColor);
  document
    .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.setAttribute("content", info.light ? "default" : "black-translucent");
}

export function savePrefs(prefs: ThemePrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignorieren */
  }
  applyTheme(prefs, true);
}

/** Beim Start aufrufen: Design setzen und auf Hell/Dunkel-Wechsel des iPhones reagieren. */
export function initTheme() {
  applyTheme(readPrefs());
  applyFolderBlend(readFolderBlend());
  applyStillBackground(readStillBackground());
  lightQuery()?.addEventListener?.("change", () => {
    const prefs = readPrefs();
    if (prefs.auto) applyTheme(prefs, true);
  });
}

/** Feste, kräftige Farben pro Konto (Reihenfolge der Verbindung). */
export const ACCOUNT_COLORS = ["#8b5cf6", "#0891b2", "#d97706", "#ec4899", "#16a34a", "#3b82f6", "#e11d48", "#0d9488"];

export function accountColor(index: number): string {
  return ACCOUNT_COLORS[index % ACCOUNT_COLORS.length];
}

/** Stabiler Farbton aus einem Ordnernamen (für die Ordner-Symbole). */
export function folderHue(name: string): number {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

// Ordnerfarben-Verlauf: wie stark das Ordner-Symbol in einen zweiten Farbton übergeht (0 = aus, einfarbig).
// Gilt nur auf diesem Gerät, wie das Design.
const BLEND_KEY = "drivepool.folderBlend";
export const BLEND_DEFAULT = 45;
export const BLEND_MAX = 120;

export function readFolderBlend(): number {
  try {
    const v = Number(localStorage.getItem(BLEND_KEY));
    if (localStorage.getItem(BLEND_KEY) !== null && Number.isFinite(v)) return Math.min(BLEND_MAX, Math.max(0, v));
  } catch {
    /* ignorieren */
  }
  return BLEND_DEFAULT;
}

export function applyFolderBlend(deg: number) {
  document.documentElement.style.setProperty("--folder-blend", String(deg));
}

export function saveFolderBlend(deg: number) {
  try {
    localStorage.setItem(BLEND_KEY, String(deg));
  } catch {
    /* ignorieren */
  }
  applyFolderBlend(deg);
}

// Hintergrund-Bewegung (Nordlicht, Sonne, Raster …) – aus spart etwas Akku. Gilt nur auf diesem Gerät.
const STILL_KEY = "drivepool.stillBg";

export function readStillBackground(): boolean {
  try {
    return localStorage.getItem(STILL_KEY) === "1";
  } catch {
    return false;
  }
}

export function applyStillBackground(still: boolean) {
  document.documentElement.classList.toggle("still-bg", still);
}

export function saveStillBackground(still: boolean) {
  try {
    localStorage.setItem(STILL_KEY, still ? "1" : "0");
  } catch {
    /* ignorieren */
  }
  applyStillBackground(still);
}
