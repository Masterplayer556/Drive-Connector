// Notfall-Export: Liste aller Dateien mit Konto und Pfad – fällt ein Google-Konto weg, weisst du genau, was dort lag.
import { AREA_LABEL } from "./areas";
import { formatBytes } from "./format";
import { supabase } from "./supabase";
import type { Account } from "./types";
import { buildZip } from "./zip";

export interface InventoryRow {
  account_id: string;
  drive_id: string;
  name: string;
  is_folder: boolean;
  mime_type: string | null;
  size: number | null;
  md5: string | null;
  taken_at: string | null;
  path: string | null;
}

/** CSV mit Semikolon (öffnet in Excel/Numbers auf Deutsch direkt richtig); Felder bei Bedarf in Anführungszeichen. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

export function inventoryCsv(rows: InventoryRow[], accounts: Account[]): string {
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const sorted = [...rows].sort((x, y) => (x.path ?? "").localeCompare(y.path ?? "", "de"));
  return toCsv(
    ["Konto", "Bereich des Kontos", "Pfad", "Name", "Art", "Grösse (Bytes)", "Grösse", "MD5", "Typ", "Aufgenommen", "Drive-ID"],
    sorted.map((r) => {
      const a = acc.get(r.account_id);
      return [
        a?.email ?? r.account_id,
        a ? AREA_LABEL[a.role] : "",
        r.path ?? "(ausserhalb von „Meine Ablage“)",
        r.name,
        r.is_folder ? "Ordner" : "Datei",
        r.size ?? "",
        r.size ? formatBytes(r.size) : "",
        r.md5 ?? "",
        r.mime_type ?? "",
        r.taken_at ?? "",
        r.drive_id,
      ];
    }),
  );
}

async function fetchInventory(onProgress?: (n: number) => void): Promise<InventoryRow[]> {
  const out: InventoryRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("items")
      .select("account_id,drive_id,name,is_folder,mime_type,size,md5,taken_at,path")
      .order("account_id")
      .order("drive_id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as InventoryRow[]));
    onProgress?.(out.length);
    if (!data || data.length < 1000) return out;
  }
}

/** Baut das ZIP: inventar.csv (alle Dateien), konten.csv (Speicher pro Konto) und eine kurze Anleitung. */
export async function buildInventoryZip(accounts: Account[], onProgress?: (n: number) => void): Promise<File> {
  const rows = await fetchInventory(onProgress);
  const enc = new TextEncoder();
  const bom = "﻿";
  const day = new Date().toISOString().slice(0, 10);
  const files = rows.filter((r) => !r.is_folder);
  const konten = toCsv(
    ["Konto", "Bereich", "Belegt", "Speicher", "Dateien", "Status", "Letzter Abgleich"],
    accounts.map((a) => [
      a.email,
      AREA_LABEL[a.role],
      formatBytes(a.quota_usage ?? 0),
      formatBytes(a.quota_limit ?? 0),
      files.filter((f) => f.account_id === a.id).length,
      a.status === "active" ? "aktiv" : `Fehler: ${a.status_message ?? ""}`,
      a.last_sync_at ?? "",
    ]),
  );
  const readme = [
    `Drive Pool – Notfall-Export vom ${day}`,
    "",
    `inventar.csv: alle ${rows.length} Einträge (${files.length} Dateien) mit Konto, Pfad, Grösse und MD5-Prüfsumme.`,
    "konten.csv: Speicher und Anzahl Dateien pro Google-Konto.",
    "",
    "Fällt ein Konto weg: in inventar.csv nach dem Konto filtern – das ist genau, was dort lag.",
    "Mit der MD5-Prüfsumme lässt sich jede Datei eindeutig wiederfinden (z. B. in einem Backup).",
  ].join("\r\n");
  const zip = buildZip([
    { name: "inventar.csv", data: enc.encode(bom + inventoryCsv(rows, accounts)) },
    { name: "konten.csv", data: enc.encode(bom + konten) },
    { name: "LIESMICH.txt", data: enc.encode(readme) },
  ]);
  return new File([zip], `drive-pool-inventar-${day}.zip`, { type: "application/zip" });
}

/** Über das Teilen-Menü sichern (iPhone: „In Dateien sichern“), sonst als Download. */
export async function saveFile(file: File): Promise<void> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (e) {
      if ((e as Error).name !== "AbortError") throw e;
    }
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
