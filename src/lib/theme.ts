// Designs: Aurora (Standard, Polarnacht), Sunset, Polar (hell, Polartag), Neon, Riso (hell), Tinte, Botanik (hell), Terminal, Tiefsee, Kosmos. Farben stehen in styles.css unter [data-theme].

export type ThemeId = "aurora" | "sunset" | "polar" | "neon" | "riso" | "tinte" | "botanik" | "terminal" | "tiefsee" | "kosmos";

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
    description: "Polarnacht – Nordlicht über den Bergen",
    light: false,
    themeColor: "#040915",
    preview: {
      bg: "linear-gradient(180deg,#07122e,#050c1c 70%,#040915)",
      blobs: ["#10b981", "#7c3aed", "transparent"],
      // Sterne, darunter der Nordlicht-Vorhang (Strahlen, die nach unten im Nachthimmel auslaufen)
      overlay:
        "radial-gradient(1px 1px at 84% 10%,#fff,transparent),radial-gradient(1px 1px at 58% 20%,#d1fae5,transparent),radial-gradient(1px 1px at 94% 58%,#fff,transparent),linear-gradient(180deg,rgba(5,12,28,0) 18%,#050c1c 64%),repeating-linear-gradient(90deg,rgba(110,231,183,0) 0 4px,rgba(110,231,183,.42) 7px,rgba(110,231,183,0) 10px,rgba(167,139,250,.3) 14px,rgba(167,139,250,0) 18px,rgba(94,234,212,.3) 21px,rgba(94,234,212,0) 25px)",
      title: "linear-gradient(100deg,#a7f3d0,#7dd3fc,#c4b5fd)",
      card: "linear-gradient(165deg,rgba(190,255,238,.2),rgba(196,170,255,.08))",
      cardShadow: "inset 0 1px 0 rgba(167,243,208,.6), inset 0 0 0 .5px rgba(167,243,208,.25)",
      ring: "conic-gradient(#8b5cf6 0 18%,transparent 0 20%,#0891b2 0 32%,transparent 0 34%,#d97706 0 42%,rgba(222,244,255,.12) 0)",
      line: "rgba(222,244,255,.35)",
      areas: ["linear-gradient(180deg,#0f9f86,#0b3f66 62%,#0a2450)", "linear-gradient(180deg,#c026d3,#4c2aa6 62%,#251a6e)"],
      areaShadow: "inset 0 1px 0 rgba(210,255,240,.55)",
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
    description: "Polartag – Eis, Halo und Schnee",
    light: true,
    themeColor: "#bedbf8",
    preview: {
      bg: "linear-gradient(180deg,#bcd9f8,#ecf3fb 62%,#f6f9fd)",
      blobs: ["#bae6fd", "transparent", "#ffd9bf"],
      // Sonne mit Halo-Ring, dazu ein paar Schneeflocken
      overlay:
        "radial-gradient(circle at 80% 64%,#fff 0 4px,rgba(255,214,170,.7) 9px,rgba(255,214,170,0) 18px),radial-gradient(circle at 80% 64%,rgba(255,255,255,0) 0 31px,rgba(255,168,112,.55) 32.5px,#fff 34.5px,rgba(120,190,255,.55) 36.5px,rgba(255,255,255,0) 40px),radial-gradient(1.6px 1.6px at 14% 20%,rgba(140,182,230,.95),transparent),radial-gradient(1.6px 1.6px at 46% 12%,rgba(140,182,230,.95),transparent),radial-gradient(1.6px 1.6px at 30% 70%,rgba(140,182,230,.95),transparent)",
      title: "linear-gradient(100deg,#0b3a8c,#1d6fe0,#0891b2)",
      card: "linear-gradient(168deg,rgba(255,255,255,.92),rgba(236,246,255,.74))",
      cardShadow: "inset 0 1px 0 #fff, 0 4px 12px rgba(30,76,128,.14)",
      ring: "conic-gradient(#8b5cf6 0 18%,transparent 0 20%,#0891b2 0 32%,transparent 0 34%,#d97706 0 42%,rgba(12,38,66,.1) 0)",
      line: "rgba(12,38,66,.2)",
      areas: ["linear-gradient(155deg,#1e40af,#0369a1 48%,#0e9fc4)", "linear-gradient(155deg,#86198f,#c0266d 46%,#ea6a4b)"],
      areaShadow: "inset 0 1px 0 rgba(255,255,255,.6), 0 4px 10px rgba(14,116,214,.22)",
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
  {
    id: "botanik",
    pair: "aurora",
    name: "Botanik",
    description: "Gewächshaus – Salbei, Creme, Terrakotta",
    light: true,
    themeColor: "#e8ede0",
    preview: {
      bg: "radial-gradient(110% 70% at 100% 0%, #d3dfc8, #e8ede0 60%)",
      blobs: ["transparent", "transparent", "transparent"],
      overlay:
        "radial-gradient(18px 34px at 92% 18%, rgba(95,127,85,.35) 60%, transparent 62%),radial-gradient(14px 26px at 6% 92%, rgba(95,127,85,.28) 60%, transparent 62%)",
      title: "linear-gradient(100deg,#2f4a2a,#6f8f63)",
      card: "#fbf8f0",
      cardShadow: "0 4px 12px rgba(60,80,50,.14)",
      ring: "conic-gradient(#c8643b 0 18%,transparent 0 20%,#6f8f63 0 32%,transparent 0 34%,#d9a441 0 42%,rgba(47,74,42,.1) 0)",
      line: "rgba(47,74,42,.25)",
      areas: ["linear-gradient(140deg,#5f7f55,#87a878)", "linear-gradient(140deg,#b5532f,#d9895b)"],
      areaShadow: "0 4px 10px rgba(60,80,50,.2)",
      radius: 12,
    },
  },
  {
    id: "terminal",
    pair: "polar",
    name: "Terminal",
    description: "Bernstein-Monitor, Scanlines, blinkender Cursor",
    light: false,
    themeColor: "#0b0703",
    preview: {
      bg: "radial-gradient(120% 90% at 50% 40%, #1a1206, #0b0703 70%)",
      blobs: ["transparent", "transparent", "transparent"],
      overlay: "repeating-linear-gradient(0deg, rgba(0,0,0,.35) 0 1px, transparent 1px 3px)",
      title: "linear-gradient(#ffb547,#ffb547)",
      card: "rgba(255,176,0,.04)",
      cardShadow: "inset 0 0 0 1px rgba(255,181,71,.5), 0 0 10px rgba(255,176,0,.15)",
      ring: "conic-gradient(#ffb547 0 18%,transparent 0 20%,#ff8c1a 0 32%,transparent 0 34%,#ffd27a 0 42%,rgba(255,181,71,.12) 0)",
      line: "rgba(255,181,71,.45)",
      areas: ["#ffb547", "rgba(255,176,0,.05)"],
      areaShadow: "inset 0 0 0 1px rgba(255,181,71,.6)",
      radius: 3,
    },
  },
  {
    id: "tiefsee",
    pair: "polar",
    name: "Tiefsee",
    description: "Licht von oben, Blasen, leuchtende Quallen",
    light: false,
    themeColor: "#03161d",
    preview: {
      bg: "linear-gradient(180deg,#0a4d5c 0%,#06303d 35%,#031a24 70%,#01070b 100%)",
      blobs: ["#0e7490", "transparent", "#db2777"],
      overlay:
        "radial-gradient(circle at 18% 70%, transparent 2.5px, rgba(180,250,255,.5) 3px, transparent 3.6px),radial-gradient(circle at 84% 52%, transparent 3.5px, rgba(180,250,255,.45) 4px, transparent 4.8px),repeating-linear-gradient(100deg, rgba(150,240,255,.08) 0 5px, transparent 5px 18px)",
      title: "linear-gradient(100deg,#9ff3ff,#5ad1e6)",
      card: "linear-gradient(165deg,rgba(160,240,255,.18),rgba(160,240,255,.05))",
      cardShadow: "inset 0 1px 0 rgba(200,255,255,.45), inset 0 0 0 .5px rgba(200,255,255,.25)",
      ring: "conic-gradient(#5ad1e6 0 18%,transparent 0 20%,#14b8a6 0 32%,transparent 0 34%,#a78bfa 0 42%,rgba(160,240,255,.12) 0)",
      line: "rgba(200,255,255,.35)",
      areas: ["linear-gradient(150deg,#0e7490,#14b8a6)", "linear-gradient(150deg,#6d28d9,#db2777)"],
      areaShadow: "inset 0 1px 0 rgba(255,255,255,.4)",
      radius: 9,
    },
  },
  {
    id: "kosmos",
    pair: "polar",
    name: "Kosmos",
    description: "Sternenhimmel, Planeten, Sternschnuppen",
    light: false,
    themeColor: "#05050f",
    preview: {
      bg: "radial-gradient(90% 70% at 85% 0%, #2a1b5c 0%, #0b0b24 55%, #04040d 100%)",
      blobs: ["transparent", "#4c1d95", "transparent"],
      overlay:
        "radial-gradient(1px 1px at 12% 20%,#fff,transparent),radial-gradient(1px 1px at 40% 8%,#fff,transparent),radial-gradient(1.4px 1.4px at 70% 30%,#fff,transparent),radial-gradient(1px 1px at 92% 64%,#cfe0ff,transparent),radial-gradient(1px 1px at 28% 88%,#fff,transparent),radial-gradient(1.4px 1.4px at 58% 96%,#ffe9c9,transparent)",
      title: "linear-gradient(100deg,#ecebff,#b9b0ff)",
      card: "rgba(20,18,50,.6)",
      cardShadow: "inset 0 0 0 .5px rgba(190,180,255,.4), 0 0 18px rgba(110,90,255,.2)",
      ring: "conic-gradient(#7c6cff 0 18%,transparent 0 20%,#22d3ee 0 32%,transparent 0 34%,#ff7ab8 0 42%,rgba(190,180,255,.12) 0)",
      line: "rgba(190,180,255,.4)",
      areas: ["radial-gradient(circle at 75% 25%,#7c6cff,#2b1d78 70%)", "radial-gradient(circle at 75% 25%,#ff7ab8,#5a1747 70%)"],
      areaShadow: "inset 0 1px 0 rgba(255,255,255,.3)",
      radius: 9,
    },
  },
];

export interface ThemePrefs {
  theme: ThemeId;
  /** Hell/Dunkel vom iPhone übernehmen */
  auto: boolean;
  /** Design bei hellem iPhone (mit Automatik) */
  light: ThemeId;
  /** Design bei dunklem iPhone (mit Automatik) */
  dark: ThemeId;
}

const KEY = "drivepool.theme";
const DEFAULT: ThemePrefs = { theme: "aurora", auto: false, light: "polar", dark: "aurora" };
const known = (id: unknown): id is ThemeId => THEMES.some((t) => t.id === id);

export function readPrefs(): ThemePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (raw && known(raw.theme)) {
      // Ältere Einstellungen ohne eigene Hell/Dunkel-Wahl: Paar aus dem gewählten Design ableiten
      const pair = autoPair(raw.theme);
      return {
        theme: raw.theme,
        auto: !!raw.auto,
        light: known(raw.light) ? raw.light : pair.light,
        dark: known(raw.dark) ? raw.dark : pair.dark,
      };
    }
  } catch {
    /* ignorieren */
  }
  return DEFAULT;
}

const lightQuery = () => window.matchMedia?.("(prefers-color-scheme: light)");

export const isLight = (id: ThemeId) => THEMES.find((t) => t.id === id)?.light ?? false;

/** Vorschlag fürs Paar: das gewählte Design plus sein Gegenstück (Riso ↔ Tinte, sonst Polar ↔ Aurora bzw. das dunkle Design). */
export function autoPair(theme: ThemeId): { light: ThemeId; dark: ThemeId } {
  const pair = THEMES.find((t) => t.id === theme)?.pair ?? "aurora";
  return isLight(theme) ? { light: theme, dark: pair } : { light: pair, dark: theme };
}

export function resolveTheme(prefs: ThemePrefs): ThemeId {
  if (!prefs.auto) return prefs.theme;
  return lightQuery()?.matches ? prefs.light : prefs.dark;
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
