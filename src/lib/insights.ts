// Hinweise auf der Startseite (statt Push-Nachrichten): Füllstand, Prognose, volle Konten,
// Ordner nahe 15 GB (Regel 4), Duplikate.
import { AREA_LABEL, ROLES } from "./areas";
import { formatBytes } from "./format";
import type { Account } from "./types";

export type InsightLevel = "info" | "warn" | "crit";
export type InsightAction = { kind: "route"; to: "duplikate" | "papierkorb" | "konten" | "regal" } | { kind: "folder"; path: string };

export interface Insight {
  id: string;
  level: InsightLevel;
  title: string;
  text: string;
  action?: InsightAction;
}

export interface PoolStats {
  files: number;
  bytes: number;
  added_30d: number;
  added_90d: number;
  duplicates: number;
}

export interface BigFolder {
  parent_key: string;
  path: string;
  bytes: number;
  files: number;
}

export const LIMIT_15GB = 15 * 1024 ** 3;

export function computeInsights(accounts: Account[], stats: PoolStats | null, big: BigFolder[]): Insight[] {
  const out: Insight[] = [];
  const active = accounts.filter((a) => a.status === "active");
  const total = active.reduce((s, a) => s + (a.quota_limit ?? 0), 0);
  const used = active.reduce((s, a) => s + (a.quota_usage ?? 0), 0);
  const free = Math.max(0, total - used);
  const pct = total > 0 ? (used / total) * 100 : 0;

  if (pct >= 95) {
    out.push({ id: "fill", level: "crit", title: `Pool zu ${Math.round(pct)} % voll`, text: `Nur noch ${formatBytes(free)} frei – Zeit für ein neues Konto.`, action: { kind: "route", to: "konten" } });
  } else if (pct >= 90) {
    out.push({ id: "fill", level: "warn", title: `Pool zu ${Math.round(pct)} % voll`, text: `Noch ${formatBytes(free)} frei.`, action: { kind: "route", to: "konten" } });
  } else if (pct >= 80) {
    out.push({ id: "fill", level: "info", title: `Pool zu ${Math.round(pct)} % voll`, text: `Noch ${formatBytes(free)} frei.` });
  }


  // Jeder Bereich ist abgeschottet: ausgewichen wird nur auf Konten desselben Gebiets
  const isFull = (a: (typeof active)[number]) => !!a.quota_limit && (a.quota_usage ?? 0) / a.quota_limit >= 0.98;
  for (const role of ROLES) {
    const area = active.filter((a) => a.role === role);
    const label = AREA_LABEL[role];
    if (area.length && area.every(isFull)) {
      out.push({ id: `area-${role}`, level: "warn", title: `${label} ist voll`, text: `Kein ${label}-Konto hat mehr Platz – Uploads nach ${label} gehen erst mit einem neuen ${label}-Konto.` });
      continue;
    }
    for (const a of area.filter(isFull)) {
      out.push({ id: `acc-${a.id}`, level: "info", title: `${a.email} ist voll`, text: `Neue Fotos landen automatisch in anderen ${label}-Konten.` });
    }
  }

  for (const f of big) {
    if (f.bytes >= LIMIT_15GB) {
      out.push({ id: `big-${f.parent_key}`, level: "crit", title: `„${f.path}“ hat 15 GB erreicht`, text: "Uploads dorthin sind gesperrt – bitte in Unterordner aufteilen.", action: { kind: "folder", path: f.path } });
    } else {
      out.push({ id: `big-${f.parent_key}`, level: "warn", title: `„${f.path}“ ist fast bei 15 GB`, text: `${formatBytes(f.bytes)} – bald in Unterordner aufteilen.`, action: { kind: "folder", path: f.path } });
    }
  }

  if (stats && stats.duplicates > 0) {
    out.push({ id: "dup", level: "info", title: `${stats.duplicates} doppelte Fotos`, text: "Antippen zum Aufräumen.", action: { kind: "route", to: "duplikate" } });
  }

  const order: Record<InsightLevel, number> = { crit: 0, warn: 1, info: 2 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}
