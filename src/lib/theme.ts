// Designs: Aurora (Standard), Sunset, Polar (hell), Neon. Farben stehen in styles.css unter [data-theme].

export type ThemeId = "aurora" | "sunset" | "polar" | "neon";

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  description: string;
  light: boolean;
  themeColor: string;
  /** Vorschau-Kachel */
  preview: { bg: string; blobs: [string, string, string]; card: string; pill: string };
}

export const THEMES: ThemeInfo[] = [
  {
    id: "aurora",
    name: "Aurora",
    description: "Nordlicht in Violett & Türkis",
    light: false,
    themeColor: "#060913",
    preview: {
      bg: "#060913",
      blobs: ["#7c3aed", "#0ea5e9", "#db2777"],
      card: "rgba(255,255,255,0.12)",
      pill: "linear-gradient(135deg,#8b5cf6,#3b82f6,#22d3ee)",
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Warm – Orange, Pink, Magenta",
    light: false,
    themeColor: "#0e0507",
    preview: {
      bg: "#0e0507",
      blobs: ["#f97316", "#db2777", "#7c3aed"],
      card: "rgba(255,255,255,0.12)",
      pill: "linear-gradient(135deg,#fb923c,#ec4899,#a855f7)",
    },
  },
  {
    id: "polar",
    name: "Polar",
    description: "Hell & klar, ideal bei Sonne",
    light: true,
    themeColor: "#eef2fb",
    preview: {
      bg: "#eef2fb",
      blobs: ["#a5b4fc", "#7dd3fc", "#f9a8d4"],
      card: "rgba(255,255,255,0.75)",
      pill: "linear-gradient(135deg,#6366f1,#3b82f6,#06b6d4)",
    },
  },
  {
    id: "neon",
    name: "Neon",
    description: "Schwarz mit leuchtenden Kanten",
    light: false,
    themeColor: "#000000",
    preview: {
      bg: "#000",
      blobs: ["transparent", "transparent", "transparent"],
      card: "rgba(163,230,53,0.12)",
      pill: "linear-gradient(135deg,#a3e635,#22d3ee)",
    },
  },
];

export interface ThemePrefs {
  theme: ThemeId;
  /** Hell/Dunkel vom iPhone übernehmen: hell → Polar, dunkel → gewähltes dunkles Design */
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

export function resolveTheme(prefs: ThemePrefs): ThemeId {
  if (!prefs.auto) return prefs.theme;
  if (lightQuery()?.matches) return "polar";
  return prefs.theme === "polar" ? "aurora" : prefs.theme;
}

export function applyTheme(prefs: ThemePrefs, animate = false) {
  const id = resolveTheme(prefs);
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-switching");
    setTimeout(() => root.classList.remove("theme-switching"), 600);
  }
  root.dataset.theme = id;
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
  lightQuery()?.addEventListener?.("change", () => {
    const prefs = readPrefs();
    if (prefs.auto) applyTheme(prefs, true);
  });
}

/** Feste, kräftige Farben pro Konto (Reihenfolge der Verbindung). */
export const ACCOUNT_COLORS = ["#a78bfa", "#22d3ee", "#fbbf24", "#f472b6", "#4ade80", "#60a5fa", "#fb7185", "#2dd4bf"];

export function accountColor(index: number): string {
  return ACCOUNT_COLORS[index % ACCOUNT_COLORS.length];
}

/** Stabiler Farbton aus einem Ordnernamen (für die Ordner-Symbole). */
export function folderHue(name: string): number {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
