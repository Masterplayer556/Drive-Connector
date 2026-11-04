// KI-SUCHE (Test): Filter im Suchtext. Reine Funktionen (getestet).
//   „O: Ferien Strand“ oder „O: "Ferien 2024" Strand“ → nur im Ordner „Ferien“ (inkl. Unterordner)
//   „Video Strand“, „Videos vom Geburtstag“      → nur Videos

export interface ParsedQuery {
  /** Was die KI suchen soll (ohne Filter). Kann leer sein, z. B. bei „O: Ferien“ allein. */
  text: string;
  /** Ordnername (oder Teil davon / Pfad wie „Ferien/2024“), sonst null */
  folder: string | null;
  /** Nur Videos? */
  video: boolean;
}

const VIDEO_WORDS = new Set(["video", "videos", "film", "filme", "filmli", "clip", "clips"]);
// Füllwörter, die nach dem Entfernen von „Video“ übrig bleiben würden („Videos vom …“)
const LEFTOVER = new Set(["vom", "von", "mit", "im", "am", "of", "from", "with", "the", "a", "an"]);

export function parseQuery(raw: string): ParsedQuery {
  let folder: string | null = null;
  // O: oder Ordner: – Name in Anführungszeichen (mit Leerzeichen) oder ein Wort
  let rest = raw.replace(/(^|\s)(?:o|ordner|folder)\s*:\s*(?:["“„«]([^"“”«»]+)["”“»]|(\S+))/i, (_m, pre: string, quoted?: string, word?: string) => {
    folder = (quoted ?? word ?? "").trim() || null;
    return pre;
  });

  let video = false;
  const words = rest.split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => {
    if (VIDEO_WORDS.has(w.toLowerCase().replace(/[^\p{L}]/gu, ""))) {
      video = true;
      return false;
    }
    return true;
  });
  // „Videos vom Strand“ → „Strand“ (Füllwort am Anfang weg)
  while (video && kept.length > 1 && LEFTOVER.has(kept[0].toLowerCase())) kept.shift();
  if (video && kept.length === 1 && LEFTOVER.has(kept[0].toLowerCase())) kept.shift();
  rest = kept.join(" ");

  return { text: rest.trim(), folder, video };
}

/** Liegt die Datei (Pfad „A/B/datei.jpg“) in einem Ordner, der zum Suchbegriff passt? Unterordner zählen mit. */
export function inFolder(path: string | null, folder: string): boolean {
  if (!path) return false;
  const dir = path.slice(0, Math.max(0, path.lastIndexOf("/"))).toLowerCase();
  const term = folder.toLowerCase().replace(/^\/+|\/+$/g, "");
  if (!dir || !term) return false;
  // Mit „/“: als Pfadstück suchen, sonst: ein Ordnername enthält den Begriff
  if (term.includes("/")) return `/${dir}/`.includes(`/${term}/`) || dir.includes(term);
  return dir.split("/").some((seg) => seg.includes(term));
}
