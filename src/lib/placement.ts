// Welches Konto bekommt ein neues Foto bzw. einen neuen Ordner? (Regel 3)
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

/** Bereich (Schule/Privat) aus dem obersten Ordner des Pfads. */
export function areaOf(path: string): Role | null {
  const top = path.split("/")[0]?.toLowerCase();
  return top === "schule" ? "schule" : top === "privat" ? "privat" : null;
}

function mostFree(list: AccountState[]): string | null {
  let best: AccountState | null = null;
  for (const a of list) if (!best || a.free > best.free) best = a;
  return best?.id ?? null;
}

/**
 * Reihenfolge:
 * 1. Konto, in dem der Ordner schon liegt (bei mehreren: das mit dem meisten Platz)
 * 2. Konto mit passender Rolle (Schule/Privat)
 * 3. irgendein Konto mit Platz
 */
export function chooseAccount(
  accounts: AccountState[],
  opts: { folderAccounts: string[]; area: Role | null; size: number },
): string | null {
  const ok = accounts.filter((a) => a.active && a.free >= opts.size);
  const inFolder = ok.filter((a) => opts.folderAccounts.includes(a.id));
  if (inFolder.length) return mostFree(inFolder);
  if (opts.area) {
    const sameArea = ok.filter((a) => a.role === opts.area);
    if (sameArea.length) return mostFree(sameArea);
  }
  return mostFree(ok);
}
