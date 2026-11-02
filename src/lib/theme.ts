// Design „Aurora“: Farben stehen in styles.css. Hier nur die Farben, die per Code vergeben werden.

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
