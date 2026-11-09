// Welches Konto bekommt ein neues Foto bzw. einen neuen Ordner? (Regel 3)
import { isSealed } from "./areas";
import type { Account, Role } from "./types";

export interface AccountState {
  id: string;
  role: Role;
  free: number;
  active: boolean;
}

export function accountStates(accounts: Account[]): AccountState[] {
  return accounts.map((a) => ({
    id: a.id,
    role: a.role,
    free: a.quota_limit === null ? Number.POSITIVE_INFINITY : Math.max(0, a.quota_limit - (a.quota_usage ?? 0)),
    active: a.status === "active",
  }));
}

/** Bereich aus dem obersten Ordner des Pfads („Archiv“, früher „Schule“ → Rolle "schule"; „Privat“; „Claude“). */
export function areaOf(path: string): Role | null {
  const top = path.split("/")[0]?.toLowerCase();
  if (top === "archiv" || top === "schule") return "schule";
  if (top === "privat") return "privat";
  return top === "claude" ? "claude" : null;
}

function mostFree(list: AccountState[]): string | null {
  let best: AccountState | null = null;
  for (const a of list) if (!best || a.free > best.free) best = a;
  return best?.id ?? null;
}

/** Privat und Claude sind abgeschottet: verlässt ein Verschieben von `from` nach `to` so einen Bereich (oder kommt hinein)? */
export function crossesSealed(from: string, to: string): boolean {
  const a = areaOf(from);
  const b = areaOf(to);
  return a !== b && (isSealed(a) || isSealed(b));
}

/**
 * Jeder Bereich ist ein eigenes Gebiet: Privat-Ordner liegen nur in Privat-Konten, Claude-Ordner nur in
 * Claude-Konten, Archiv-Ordner nur in Archiv-Konten. Ohne erkennbaren Bereich (z. B. Ordner ganz oben) ist jedes Konto erlaubt.
 * Reihenfolge innerhalb des Gebiets:
 * 1. Konto, in dem der Ordner schon liegt (bei mehreren: das mit dem meisten Platz)
 * 2. Konto mit dem meisten Platz
 */
export function chooseAccount(
  accounts: AccountState[],
  opts: { folderAccounts: string[]; area: Role | null; size: number },
): string | null {
  // Ohne Bereich nur offene Konten: abgeschottete Konten (Privat, Claude) nehmen nur ihren eigenen Bereich auf
  const ok = accounts.filter((a) => a.active && a.free >= opts.size && (opts.area ? a.role === opts.area : !isSealed(a.role)));
  const inFolder = ok.filter((a) => opts.folderAccounts.includes(a.id));
  if (inFolder.length) return mostFree(inFolder);
  return mostFree(ok);
}

/** Fehlermeldung, wenn chooseAccount kein Konto findet. */
export function noAccountMessage(area: Role | null): string {
  if (area === "privat") return "Kein Privat-Konto mit genug freiem Speicher";
  if (area === "claude") return "Kein Claude-Konto mit genug freiem Speicher";
  if (area === "schule") return "Kein Archiv-Konto mit genug freiem Speicher";
  return "Kein Konto mit genug freiem Speicher";
}
