// Hinweise auf der Startseite (statt Push-Nachrichten): Füllstand, Prognose, volle Konten,
// Ordner nahe 15 GB (Regel 4), Duplikate.
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

  // Prognose aus dem Upload-Tempo der letzten 30 (sonst 90) Tage
  if (stats && total > 0) {
    const perDay = stats.added_30d > 0 ? stats.added_30d / 30 : stats.added_90d / 90;
    if (perDay > 0) {
      const days = free / perDay;
      const perMonth = formatBytes(perDay * 30);
      const when =
        days < 14 ? `in ca. ${Math.max(1, Math.round(days))} Tagen` : days < 70 ? `in ca. ${Math.round(days / 7)} Wochen` : `in ca. ${Math.round(days / 30)} Monaten`;
      out.push({
        id: "forecast",
        level: days < 30 ? "warn" : "info",
        title: `Voll ${when}`,
        text: `Bei deinem Tempo von ${perMonth} pro Monat.`,
      });
    }
  }

  for (const a of active) {
    if (a.quota_limit && (a.quota_usage ?? 0) / a.quota_limit >= 0.98) {
      out.push({ id: `acc-${a.id}`, level: "info", title: `${a.email} ist voll`, text: "Neue Fotos landen automatisch in anderen Konten." });
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
