// Assistent „Neues Google-Konto“: Vorschläge und Formatierung (reine Funktionen, getestet).
import type { Role } from "./types";

/** Wartet auf die Rückkehr vom Verbinden: welcher Bereich für welche Adresse */
export const PENDING_KEY = "drivepool.newaccount.pending";

export function readPending(): { email: string; role: Role } | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null");
    return p && typeof p.email === "string" && (p.role === "schule" || p.role === "privat" || p.role === "claude") ? p : null;
  } catch {
    return null;
  }
}

export function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignorieren */
  }
}

/** Nächste freie Gmail-Adresse nach dem Muster der bisherigen Konten (z. B. tablettbee2 → tablettbee3). */
export function suggestUsername(emails: string[], fallback = "drivepool.pool"): string {
  const locals = emails
    .map((e) => e.toLowerCase())
    .filter((e) => e.endsWith("@gmail.com"))
    .map((e) => e.slice(0, -"@gmail.com".length));
  // Häufigster Stamm (ohne Zahl am Ende), bei Gleichstand der zuletzt verbundene
  const stems = new Map<string, number>();
  for (const l of locals) {
    const stem = l.replace(/\d+$/, "");
    if (stem.length >= 3) stems.set(stem, (stems.get(stem) ?? 0) + 1);
  }
  let base = fallback;
  let best = 0;
  for (const [stem, n] of stems) if (n >= best) [base, best] = [stem, n];
  const used = new Set(locals);
  let i = 1;
  for (const l of locals) {
    if (l.replace(/\d+$/, "") !== base) continue;
    const m = /(\d+)$/.exec(l);
    if (m) i = Math.max(i, Number(m[1]) + 1);
    else i = Math.max(i, 2);
  }
  while (used.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** "2008-05-03" → { day: "3", month: "Mai", year: "2008" } (so fragt Google). */
export function splitBirthday(iso: string): { day: string; month: string; year: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return { day: String(Number(m[3])), month, year: m[1] };
}

/** Gültiger Gmail-Name: 6–30 Zeichen, Buchstaben, Zahlen, Punkte (nicht am Anfang/Ende, nicht doppelt). */
export function usernameError(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (n.length < 6 || n.length > 30) return "6 bis 30 Zeichen";
  if (!/^[a-z0-9.]+$/.test(n)) return "Nur Buchstaben (a–z), Zahlen und Punkte";
  if (n.startsWith(".") || n.endsWith(".") || n.includes("..")) return "Punkt nicht am Anfang/Ende und nicht doppelt";
  return null;
}
