// Rebalancing-Planer (Regel 5–7). Erzeugt nur Vorschläge – ausgeführt wird erst nach „Ausführen“.
//
// Einheit = ein Ordner mit seinen direkten Fotos in einem Konto. Liegt derselbe Ordner in mehreren
// Konten, sind das mehrere Teile eines „Blocks“. Für den Gruppenordner (Regel 5) bilden alle
// Unterordner A–M bzw. N–Z je einen Block. Gesperrte Ordner (Regel 7) bewegen sich nie.
// Privat ist abgeschottet: Privat-Ordner ziehen nur zwischen Privat-Konten um, alles andere nur
// zwischen Archiv-Konten.
import { areaOf } from "./placement";
import type { Role } from "./types";

export interface Unit {
  account_id: string;
  parent_key: string;
  path: string;
  folder_id: string;
  files: number;
  bytes: number;
  has_subfolders?: boolean;
}

export interface AccountCap {
  id: string;
  email: string;
  limit: number;
  usage: number;
  /** Privat-Konten bilden ein abgeschottetes Gebiet (ohne Angabe: Archiv) */
  role?: Role;
}

export interface StepUnit {
  account_id: string;
  parent_key: string;
  folder_id: string;
  path: string;
  files: number;
  bytes: number;
}

export interface Step {
  /** Block-Schlüssel (Ordner-Pfad oder Gruppenordner#A–M) */
  block: string;
  label: string;
  from: string;
  to: string;
  bytes: number;
  files: number;
  reason: "zusammenführen" | "entlasten" | "einordnen";
  units: StepUnit[];
}

export interface Plan {
  steps: Step[];
  bytes: number;
  signature: string;
  before: Record<string, number>;
  after: Record<string, number>;
}

export const GB = 1024 ** 3;
/** So viel bleibt in jedem Zielkonto mindestens frei */
export const RESERVE = 0.5 * GB;
/** Ab diesem Füllstand wird ein Konto entlastet … */
export const HIGH = 0.92;
/** … bis es wieder darunter liegt; Ziele werden höchstens bis hierhin gefüllt */
export const TARGET = 0.85;

export const GROUPS = ["A–M", "N–Z"] as const;

/** A–M oder N–Z nach dem ersten Buchstaben (Umlaute wie Grundbuchstabe, Ziffern/Sonstiges zu A–M). */
export function letterGroup(name: string): (typeof GROUPS)[number] {
  const c = name.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
  return c >= "N" && c <= "Z" ? "N–Z" : "A–M";
}

export function isLocked(parentKey: string, locks: Iterable<string>): boolean {
  for (const l of locks) if (parentKey === l || parentKey.startsWith(l + "/")) return true;
  return false;
}

/** Block, zu dem eine Einheit gehört (Gruppenregel nur für den einen Gruppenordner). */
export function blockOf(unit: Pick<Unit, "parent_key" | "path">, groupFolder: string | null): { key: string; label: string } {
  if (groupFolder && unit.parent_key.startsWith(groupFolder + "/")) {
    const rest = unit.path.split("/").slice(groupFolder.split("/").length);
    const g = letterGroup(rest[0] ?? "");
    const base = unit.path.split("/").slice(0, groupFolder.split("/").length).join("/");
    return { key: `${groupFolder}#${g}`, label: `${base} (${g})` };
  }
  return { key: unit.parent_key, label: unit.path };
}

interface Block {
  key: string;
  label: string;
  /** Gehört ins Gebiet Privat */
  privat: boolean;
  /** Gebiet ergibt sich aus dem Pfad (Archiv/… oder Privat/…), nicht nur aus dem Konto */
  zoneKnown: boolean;
  parts: Map<string, StepUnit[]>;
  total: number;
}

const sum = (units: StepUnit[], f: "bytes" | "files") => units.reduce((s, u) => s + u[f], 0);

export function planRebalance(input: {
  accounts: AccountCap[];
  units: Unit[];
  locks?: Iterable<string>;
  groupFolder?: string | null;
}): Plan {
  const locks = [...(input.locks ?? [])];
  const groupFolder = input.groupFolder ?? null;
  const accounts = input.accounts.filter((a) => a.limit > 0);
  const limit = new Map(accounts.map((a) => [a.id, a.limit]));
  const usage = new Map(accounts.map((a) => [a.id, a.usage]));
  const before = Object.fromEntries(usage);
  const free = (id: string) => (limit.get(id) ?? 0) - (usage.get(id) ?? 0);
  const isPrivat = new Map(accounts.map((a) => [a.id, a.role === "privat"]));
  /** Darf der Block in dieses Konto? (nie über die Grenze von Privat) */
  const allowed = (b: Block, id: string) => isPrivat.get(id) === b.privat;

  // Blöcke bilden
  const blocks = new Map<string, Block>();
  for (const u of input.units) {
    if (!limit.has(u.account_id) || u.bytes <= 0 || isLocked(u.parent_key, locks)) continue;
    const { key, label } = blockOf(u, groupFolder);
    const area = areaOf(u.path);
    const privat = area ? area === "privat" : !!isPrivat.get(u.account_id);
    const b = blocks.get(key) ?? { key, label, privat, zoneKnown: !!area, parts: new Map(), total: 0 };
    const list = b.parts.get(u.account_id) ?? [];
    list.push({ account_id: u.account_id, parent_key: u.parent_key, folder_id: u.folder_id, path: u.path, files: u.files, bytes: u.bytes });
    b.parts.set(u.account_id, list);
    b.total += u.bytes;
    blocks.set(key, b);
  }

  const steps: Step[] = [];
  const move = (b: Block, from: string, to: string, reason: Step["reason"]) => {
    const units = b.parts.get(from) ?? [];
    const bytes = sum(units, "bytes");
    steps.push({ block: b.key, label: b.label, from, to, bytes, files: sum(units, "files"), reason, units });
    usage.set(from, (usage.get(from) ?? 0) - bytes);
    usage.set(to, (usage.get(to) ?? 0) + bytes);
    b.parts.delete(from);
    b.parts.set(to, [...(b.parts.get(to) ?? []), ...units.map((x) => ({ ...x, account_id: to }))]);
  };

  // 0. Ordner im falschen Gebiet (z. B. Privat-Ordner in einem Archiv-Konto) ins richtige Gebiet holen
  for (const b of [...blocks.values()].filter((x) => x.zoneKnown).sort((x, y) => y.total - x.total)) {
    const wrong = [...b.parts.keys()].filter((id) => !allowed(b, id));
    if (!wrong.length) continue;
    const need = wrong.reduce((s, id) => s + sum(b.parts.get(id) ?? [], "bytes"), 0);
    const dest = [...limit.keys()]
      .filter((id) => allowed(b, id) && free(id) - need >= RESERVE)
      .sort((x, y) => Number(b.parts.has(y)) - Number(b.parts.has(x)) || free(y) - free(x))[0];
    if (!dest) continue;
    for (const from of wrong) move(b, from, dest, "einordnen");
  }

  // 1. Verteilte Blöcke zusammenführen („möglichst viele Einheiten ganz in einem Konto“)
  for (const b of [...blocks.values()].filter((x) => x.parts.size > 1).sort((x, y) => y.total - x.total)) {
    const partBytes = (id: string) => sum(b.parts.get(id) ?? [], "bytes");
    // Ziel: das Konto mit dem grössten Teil, in das alle übrigen Teile passen
    const homes = [...limit.keys()]
      .filter((id) => allowed(b, id) && free(id) - (b.total - partBytes(id)) >= RESERVE)
      .sort((x, y) => partBytes(y) - partBytes(x) || free(y) - free(x));
    const home = homes[0];
    if (!home) continue;
    for (const from of [...b.parts.keys()].filter((id) => id !== home).sort((x, y) => partBytes(x) - partBytes(y))) {
      move(b, from, home, "zusammenführen");
    }
  }

  // 2. Volle Konten entlasten – lieber wenige grosse Blöcke als viele kleine
  const whole = () => [...blocks.values()].filter((b) => b.parts.size === 1);
  for (const a of [...limit.keys()].sort((x, y) => free(x) - free(y))) {
    let guard = 0;
    while ((usage.get(a) ?? 0) > HIGH * limit.get(a)! && guard++ < 50) {
      const need = (usage.get(a) ?? 0) - TARGET * limit.get(a)!;
      const fits = (b: Block) =>
        [...limit.keys()]
          .filter(
            (d) =>
              d !== a &&
              allowed(b, d) &&
              (usage.get(d) ?? 0) + b.total <= TARGET * limit.get(d)! &&
              free(d) - b.total >= RESERVE,
          )
          .sort((x, y) => free(y) - free(x))[0];
      const cands = whole()
        .filter((b) => b.parts.has(a) && fits(b))
        .sort((x, y) => x.total - y.total);
      if (!cands.length) break;
      // Kleinster Block, der allein reicht – sonst der grösste, der passt
      const pick = cands.find((b) => b.total >= need) ?? cands[cands.length - 1];
      move(pick, a, fits(pick)!, "entlasten");
    }
  }

  // Mehrfach-Umzüge zusammenfassen: jede Einheit zieht direkt vom Ursprung an ihren Endort
  // (sonst würde z. B. „zusammenführen“ + „entlasten“ jedes Foto zweimal kopieren).
  const origin = new Map<string, string>(); // folder_id → ursprüngliches Konto
  for (const u of input.units) origin.set(u.folder_id, u.account_id);
  const finalSteps = new Map<string, Step>();
  for (const b of blocks.values()) {
    const moved = steps.filter((s) => s.block === b.key);
    if (!moved.length) continue;
    const origins = new Set([...b.parts.values()].flat().map((u) => origin.get(u.folder_id)));
    const misplaced = [...origins].some((id) => id !== undefined && limit.has(id) && !allowed(b, id));
    const reason: Step["reason"] = misplaced ? "einordnen" : origins.size > 1 ? "zusammenführen" : "entlasten";
    for (const [to, units] of b.parts) {
      for (const u of units) {
        const from = origin.get(u.folder_id)!;
        if (from === to) continue;
        const key = `${b.key}|${from}|${to}`;
        const s = finalSteps.get(key) ?? { block: b.key, label: b.label, from, to, bytes: 0, files: 0, reason, units: [] };
        s.units.push({ ...u, account_id: from });
        s.bytes += u.bytes;
        s.files += u.files;
        finalSteps.set(key, s);
      }
    }
  }
  steps.splice(0, steps.length, ...finalSteps.values());

  const signature = steps
    .map((s) => `${s.block}:${s.from}>${s.to}`)
    .sort()
    .join("|");
  return { steps, bytes: steps.reduce((s, x) => s + x.bytes, 0), signature, before, after: Object.fromEntries(usage) };
}
