// Text in Fotos suchen (Arbeitsblätter, Tafelbilder): Google Drive liest Text in Bildern selbst (OCR) und
// macht ihn über „fullText contains“ durchsuchbar. Gesucht wird direkt bei Google in jedem Konto; die
// Treffer werden danach den Einträgen im Index zugeordnet (nur Fotos, die im Pool sichtbar sind).

/** Wörter der Suche; Text in "…" bleibt als Wortgruppe zusammen. Höchstens 6 Teile. */
export function searchTerms(input: string): string[] {
  const out: string[] = [];
  const re = /["“„«]([^"”“»]+)["”“»]?|(\S+)/g;
  for (let m = re.exec(input); m; m = re.exec(input)) {
    const part = (m[1] ?? m[2] ?? "").trim();
    if (part) out.push(m[1] ? `"${part}"` : part);
  }
  return out.slice(0, 6);
}

/** Wert für eine Drive-Abfrage in '…' (Backslash und Hochkomma maskieren). */
const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** Drive-Abfrage: alle Wörter müssen im Bildtext (oder Namen/Beschreibung) vorkommen, nur eigene Bilder. */
export function fullTextQuery(input: string): string | null {
  const terms = searchTerms(input);
  if (!terms.length) return null;
  return [...terms.map((t) => `fullText contains ${quote(t)}`), "mimeType contains 'image/'", "trashed = false", "'me' in owners"].join(" and ");
}

/** Treffer mehrerer Konten zu einer Liste mischen – abwechselnd nach Rang, damit kein Konto alle verdrängt. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}
