// KI-SUCHE (Test): „KI trainieren“ – Begriffe aus deiner eigenen Ablage (Namen, Ordner, Tags, frühere
// Suchen) und je Begriff eine Reihe Fotos zum Wischen (passt / passt nicht). Reine Funktionen (getestet).

export interface Term {
  label: string;
  /** Woher der Begriff kommt – für die Anzeige */
  source: "name" | "ordner" | "tag" | "suche";
}

// Ordnernamen, die nichts über den Inhalt sagen
const GENERIC = new Set([
  "archiv", "privat", "schule", "drive", "neuer ordner", "new folder", "ordner", "fotos", "photos", "bilder",
  "images", "camera roll", "kamera", "dcim", "downloads", "screenshots", "sonstiges", "diverses", "misc", "temp",
]);

/** Taugt ein Ordnername als Begriff? (keine Jahre/Daten, keine Sammelnamen) */
export function usefulFolderName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n.length < 3 || GENERIC.has(n)) return false;
  if (/^[\d\s._-]+$/.test(n)) return false; // 2024, 2024-05, 01.03.
  if (/^(img|dsc|pxl|vid)[_-]?\d/i.test(n)) return false;
  return /\p{L}{3}/u.test(n);
}

/**
 * Begriffe aus der eigenen Ablage, ohne Doppelte. Ordner zählen nur, wenn sie genug Fotos haben.
 * `folders` = Ordnername → Anzahl Fotos darin.
 */
export function collectTerms(input: {
  names: string[];
  folders: Map<string, number>;
  tags: string[];
  searches: string[];
  minFolderFiles?: number;
}): Term[] {
  const seen = new Set<string>();
  const out: Term[] = [];
  const add = (label: string, source: Term["source"]) => {
    const l = label.trim().replace(/\s+/g, " ");
    const k = l.toLowerCase();
    if (!l || seen.has(k)) return;
    seen.add(k);
    out.push({ label: l, source });
  };
  for (const n of input.names) add(n, "name");
  for (const [name, count] of [...input.folders].sort((a, b) => b[1] - a[1])) {
    if (count >= (input.minFolderFiles ?? 5) && usefulFolderName(name)) add(name, "ordner");
  }
  for (const t of input.tags) add(t, "tag");
  for (const s of input.searches) add(s, "suche");
  return out;
}

/**
 * Fotos zum Wischen: abwechselnd sichere Treffer (vorne in der Rangliste) und unsichere (weiter hinten –
 * dort lernt die Suche am meisten). Schon bewertete fallen weg.
 */
export function pickCards(ranked: string[], voted: Set<string>, n = 12, random: () => number = Math.random): string[] {
  const open = ranked.filter((k) => !voted.has(k));
  const sure = open.slice(0, 30);
  const unsure = open.slice(30, 200);
  const take = (list: string[]) => (list.length ? list.splice(Math.floor(random() * Math.min(list.length, 15)), 1)[0] : undefined);
  const out: string[] = [];
  while (out.length < n && (sure.length || unsure.length)) {
    const k = out.length % 2 === 0 ? (take(sure) ?? take(unsure)) : (take(unsure) ?? take(sure));
    if (k) out.push(k);
  }
  return out;
}
