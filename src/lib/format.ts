export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "nie";
  return new Date(iso).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Aufnahmezeit (taken_at) anzeigen. Die EXIF-Zeit hat keine Zeitzone – sie ist die Uhrzeit, die die Kamera
 * zeigte. Der Sync speichert sie unverändert mit „Z“ (siehe _shared/sync.ts), darum hier in UTC formatieren:
 * sonst verschiebt die Anzeige sie um die eigene Zeitzone (1–2 h, an Silvester sogar ins falsche Jahr).
 * Nur für taken_at – echte Zeitstempel (created_at, last_sync_at …) weiter mit formatDateTime.
 */
export function formatTakenAt(iso: string | null): string {
  if (!iso) return "Unbekannt";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unbekannt";
  return d.toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });
}
