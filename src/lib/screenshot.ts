// Screenshots erkennen – am Namen (falls vorhanden) oder an den Bildmassen: Bildschirmfotos haben genau die
// Pixel eines Bildschirms (iPhone 13: 1170×2532), Kamerafotos dagegen 4:3/16:9 mit Kamera-Auflösung.

/** Bekannte Bildschirm-Auflösungen (Hochformat bzw. Querformat bei Computern). */
const PHONES: [number, number][] = [
  // iPhone (Plus-Modelle speichern 1242×2208, nicht 1080×1920 – das wäre auch ein Full-HD-Hintergrund)
  [640, 1136], [750, 1334], [828, 1792], [1125, 2436], [1170, 2532], [1179, 2556], [1206, 2622],
  [1242, 2208], [1242, 2688], [1284, 2778], [1290, 2796], [1320, 2868], [1080, 2340],
  // iPad
  [1536, 2048], [1488, 2266], [1620, 2160], [1640, 2360], [1668, 2224], [1668, 2388], [2048, 2732], [2064, 2752],
  // häufige Android-Geräte
  [720, 1600], [1080, 2400], [1080, 2412], [1080, 2408], [1440, 3200], [1440, 3088], [1440, 3120], [1080, 2280],
];
const COMPUTERS: [number, number][] = [
  [1280, 720], [1280, 800], [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1680, 1050], [1920, 1080],
  [1920, 1200], [2256, 1504], [2560, 1440], [2560, 1600], [2736, 1824], [2880, 1800], [2880, 1920], [3024, 1964],
  [3456, 2234], [3840, 2160], [2940, 1912], [2560, 1664],
];

const pairKey = (w: number, h: number) => `${Math.min(w, h)}x${Math.max(w, h)}`;
const PHONE_KEYS = new Set(PHONES.map(([w, h]) => pairKey(w, h)));
const SCREEN_KEYS = new Set([...PHONES, ...COMPUTERS].map(([w, h]) => pairKey(w, h)));

const NAME = /screenshot|screen shot|bildschirmfoto|capture d.écran|bildschirmaufnahme/i;

export interface ShotCandidate {
  name: string;
  mime_type: string | null;
  path?: string | null;
  width?: number | null;
  height?: number | null;
}

/** Bildschirmfoto? Name/Ordner, sonst Masse: PNG mit Bildschirm-Auflösung oder hohem Handy-Format; andere Formate nur mit exakter Handy-Auflösung. */
export function isScreenshot(it: ShotCandidate): boolean {
  if (!it.mime_type?.startsWith("image/")) return false;
  if (NAME.test(it.name) || /(^|\/)screenshots\//i.test(it.path ?? "")) return true;
  const w = it.width ?? 0;
  const h = it.height ?? 0;
  if (!w || !h) return false;
  const k = pairKey(w, h);
  if (it.mime_type === "image/png") {
    if (SCREEN_KEYS.has(k)) return true;
    // Handy-Hochformat (19,5:9 usw.): Kameras liefern höchstens 16:9 = 1,78
    const ratio = Math.max(w, h) / Math.min(w, h);
    return ratio >= 2 && ratio <= 2.4 && Math.min(w, h) >= 640 && Math.min(w, h) <= 1440;
  }
  // JPEG/HEIC: Desktop-Auflösungen kommen auch bei Hintergrundbildern vor – nur exakte Handy-Masse zählen
  return PHONE_KEYS.has(k);
}

/**
 * PostgREST-Filter (für .or()) – grenzt die Kandidaten auf dem Server ein: alle PNGs mit bekannten Massen
 * und Bilder mit exakter Handy-Auflösung. Die genaue Prüfung macht danach isScreenshot().
 */
export function screenshotFilter(): string {
  const pairs = PHONES.flatMap(([w, h]) => [`and(width.eq.${w},height.eq.${h})`, `and(width.eq.${h},height.eq.${w})`]);
  return ["and(mime_type.eq.image/png,width.not.is.null)", ...pairs].join(",");
}
