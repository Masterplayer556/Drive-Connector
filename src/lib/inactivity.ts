// Erinnerung gegen das Löschen inaktiver Google-Konten (KONZEPT: „App erinnert daran“).
import type { Account } from "./types";

const DAY = 86_400_000;
const MONTH = 30.44 * DAY;

/** Ab so vielen Monaten ohne eigenes Login: gelb bzw. rot (Google löscht inaktive Konten nach 24 Monaten). */
export const INACTIVE_WARN_MONTHS = 12;
export const INACTIVE_BAD_MONTHS = 18;

export interface Inactivity {
  level: "ok" | "warn" | "bad";
  /** Ganze Monate seit dem letzten eigenen Login (bzw. seit dem Verbinden) */
  months: number;
  /** Datum des letzten bekannten Logins */
  since: string | null;
  text: string | null;
}

/**
 * Erinnerung gegen das Löschen inaktiver Google-Konten: Wann war der Nutzer zuletzt selbst eingeloggt?
 * Ohne Bestätigung zählt das Verbinden des Kontos (das war ein Google-Login).
 */
export function inactivityOf(a: Pick<Account, "last_login_at" | "created_at">, now = Date.now()): Inactivity {
  const since = a.last_login_at || a.created_at || null;
  const t = since ? Date.parse(since) : NaN;
  if (Number.isNaN(t)) return { level: "ok", months: 0, since: null, text: null };
  const months = Math.max(0, Math.floor((now - t) / MONTH));
  const left = Math.max(0, 24 - months);
  const text = `Seit ${months} Monaten nicht selbst eingeloggt – Google löscht inaktive Konten nach 2 Jahren (noch ~${left} Monate)`;
  if (months >= INACTIVE_BAD_MONTHS) return { level: "bad", months, since, text };
  if (months >= INACTIVE_WARN_MONTHS) return { level: "warn", months, since, text };
  return { level: "ok", months, since, text: null };
}

