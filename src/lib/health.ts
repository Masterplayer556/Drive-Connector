// Konto-Gesundheit (Ampel pro Konto) und Prüfbericht der Abschottung (Privat & Claude).
import { writeLog } from "./db";
import { formatBytes } from "./format";
import { supabase } from "./supabase";
import type { Account, Role } from "./types";

export type Level = "ok" | "warn" | "bad";

export interface Health {
  level: Level;
  /** Gründe, schlimmste zuerst – leer, wenn alles gut ist */
  reasons: string[];
  /** Tage bis voll beim aktuellen Tempo (null = wächst nicht oder unbekannt) */
  daysToFull: number | null;
}

const DAY = 86_400_000;
const rank: Record<Level, number> = { ok: 0, warn: 1, bad: 2 };

/**
 * Ampel für ein Konto: Zugriff gültig? Wann zuletzt abgeglichen? Wie voll – und wie schnell wird es voll?
 * `added30` = in den letzten 30 Tagen neu hinzugekommene Bytes.
 */
export function healthOf(a: Account, added30: number, now = Date.now()): Health {
  const found: { level: Level; text: string }[] = [];
  if (a.status === "error") found.push({ level: "bad", text: a.status_message || "Zugriff fehlt – neu verbinden" });

  if (!a.last_sync_at) found.push({ level: "warn", text: "Noch nie abgeglichen" });
  else {
    const days = (now - Date.parse(a.last_sync_at)) / DAY;
    if (days > 7) found.push({ level: "bad", text: `Seit ${Math.floor(days)} Tagen nicht abgeglichen` });
    else if (days > 2) found.push({ level: "warn", text: `Seit ${Math.floor(days)} Tagen nicht abgeglichen` });
  }

  let daysToFull: number | null = null;
  const limit = a.quota_limit ?? 0;
  const used = a.quota_usage ?? 0;
  if (limit > 0) {
    const pct = (used / limit) * 100;
    if (pct >= 95) found.push({ level: "bad", text: `${Math.round(pct)} % voll` });
    else if (pct >= 85) found.push({ level: "warn", text: `${Math.round(pct)} % voll` });
    const perDay = added30 / 30;
    if (perDay > 0) {
      daysToFull = Math.max(0, Math.floor((limit - used) / perDay));
      if (pct < 95) {
        if (daysToFull < 7) found.push({ level: "bad", text: `In ~${daysToFull} Tagen voll` });
        else if (daysToFull < 30) found.push({ level: "warn", text: `In ~${daysToFull} Tagen voll` });
      }
    }
  }

  found.sort((x, y) => rank[y.level] - rank[x.level]);
  return { level: found[0]?.level ?? "ok", reasons: found.map((f) => f.text), daysToFull };
}

/** Neu hinzugekommene Bytes pro Konto in den letzten 30 Tagen. */
export async function fetchGrowth(): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc("account_growth", { p_days: 30 });
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as { account_id: string; bytes: number }[]).map((r) => [r.account_id, Number(r.bytes)]));
}

/* ---------- Prüfbericht der Abschottung ---------- */

export interface Violation {
  account_id: string;
  email: string;
  role: Role;
  path: string;
  is_folder: boolean;
  size: number | null;
}

export interface SealReport {
  at: string;
  /** alle betroffenen Einträge (auch die in falsch liegenden Ordnern) */
  total: number;
  /** oberste betroffene Einträge (höchstens 200) */
  items: Violation[];
}

const REPORT_KEY = "drivepool.sealReport";
const WEEK = 7 * DAY;

export function lastSealReport(): SealReport | null {
  try {
    return JSON.parse(localStorage.getItem(REPORT_KEY) ?? "null");
  } catch {
    return null;
  }
}

/** Kurzer Text für Liste und Protokoll. */
export function sealSummary(r: SealReport): string {
  if (!r.total) return "Abschottung geprüft: alles am richtigen Ort ✓";
  return `Abschottung geprüft: ${r.total} ${r.total === 1 ? "Eintrag liegt" : "Einträge liegen"} im falschen Bereich`;
}

export async function runSealCheck(): Promise<SealReport> {
  const { data, error } = await supabase.rpc("seal_violations", { p_limit: 200 });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as (Violation & { total: number })[];
  const report: SealReport = {
    at: new Date().toISOString(),
    total: Number(rows[0]?.total ?? 0),
    items: rows.map(({ total: _t, ...v }) => ({ ...v, size: v.size === null ? null : Number(v.size) })),
  };
  try {
    localStorage.setItem(REPORT_KEY, JSON.stringify(report));
  } catch {
    /* ignorieren */
  }
  const bytes = report.items.reduce((s, v) => s + (v.size ?? 0), 0);
  await writeLog(report.total ? "error" : "check", sealSummary(report), report.total
    ? { eintraege: report.items.slice(0, 50).map((v) => `${v.path} (${v.email})`), groesse: formatBytes(bytes) }
    : undefined);
  return report;
}

/** Einmal pro Woche automatisch (beim Öffnen der App). */
export async function sealCheckIfDue(): Promise<SealReport | null> {
  const last = lastSealReport();
  if (last && Date.now() - Date.parse(last.at) < WEEK) return null;
  return runSealCheck();
}
