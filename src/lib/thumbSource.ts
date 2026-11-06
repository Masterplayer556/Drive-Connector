// Woher die Vorschaubilder kommen: zuerst direkt von Google (kostet keinen Supabase-Datenverkehr),
// sonst über die Supabase-Funktion „thumb“ (die holt sie bei Google und reicht sie weiter – das zählt als
// Supabase-Egress, das Gratis-Kontingent ist klein).
//
// Direkt heisst: Vorschau-Links bei der Drive-API abfragen (geht vom Handy aus) und die Bilder ohne
// Anmeldung laden. Klappt das bei einem Bild nicht, kommt es über die Funktion. Klappt es gar nicht
// (z. B. Google lässt es nicht zu), wird der direkte Weg einen Tag lang ausgelassen und dann neu probiert.
import { thumbnailLinks } from "./google";
import { callFunction } from "./supabase";

const STATE_KEY = "drivepool.thumbDirect";
const RETRY_AFTER = 24 * 3600_000;
const LINK_TTL = 30 * 60_000;

/** Vorschau-Links pro Konto+Ordner kurz merken (sonst bei jedem Paket die Ordnerliste neu abfragen). */
const linkCache = new Map<string, { at: number; links: Map<string, string> }>();

/** Zähler zum Nachprüfen (in der Konsole: drivepoolThumbStats) */
export const thumbStats = { direct: 0, viaSupabase: 0 };
(globalThis as Record<string, unknown>).drivepoolThumbStats = thumbStats;

function directBlocked(): boolean {
  try {
    const at = Number(localStorage.getItem(STATE_KEY) ?? 0);
    return at > 0 && Date.now() - at < RETRY_AFTER;
  } catch {
    return false;
  }
}

function setDirectBlocked(blocked: boolean) {
  try {
    if (blocked) localStorage.setItem(STATE_KEY, String(Date.now()));
    else localStorage.removeItem(STATE_KEY);
  } catch {
    /* ignorieren */
  }
}

export function sized(link: string, size: number): string {
  return /=s\d+(-[a-z0-9-]+)?$/i.test(link) ? link.replace(/=s\d+(-[a-z0-9-]+)?$/i, `=s${size}`) : `${link}=s${size}`;
}

async function linksFor(accountId: string, folderId: string | null, ids: string[]): Promise<Map<string, string>> {
  const key = `${accountId}|${folderId ?? ""}`;
  const hit = linkCache.get(key);
  const fresh = hit && Date.now() - hit.at < LINK_TTL ? hit.links : null;
  if (fresh && ids.every((id) => fresh.has(id))) return fresh;
  const links = await thumbnailLinks(accountId, folderId, ids.filter((id) => !fresh?.has(id)));
  const merged = new Map([...(fresh ?? []), ...links]);
  if (folderId) linkCache.set(key, { at: fresh ? hit!.at : Date.now(), links: merged });
  return merged;
}

async function direct(accountId: string, folderId: string | null, ids: string[], size: number): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  const links = await linksFor(accountId, folderId, ids);
  let tried = 0;
  const queue = ids.filter((id) => links.has(id));
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      tried++;
      try {
        const res = await fetch(sized(links.get(id)!, size), { credentials: "omit", referrerPolicy: "no-referrer" });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (blob.size && blob.type.startsWith("image/")) out.set(id, blob);
      } catch {
        /* z. B. von Google blockiert → über Supabase */
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  // Kein einziges Bild direkt bekommen → Weg vorerst auslassen
  if (tried >= 3 && out.size === 0) setDirectBlocked(true);
  else if (out.size > 0) setDirectBlocked(false);
  return out;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",", 2);
  const type = /data:([^;]+)/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Vorschaubilder mehrerer Fotos desselben Kontos/Ordners (max. 40) – direkt von Google, Rest über Supabase.
 * Fehlende Bilder sind im Ergebnis einfach nicht enthalten.
 */
export async function fetchThumbBlobs(
  accountId: string,
  folderId: string | null,
  ids: string[],
  size: number,
  { timeout }: { timeout?: number } = {},
): Promise<Map<string, Blob>> {
  let out = new Map<string, Blob>();
  if (!directBlocked()) out = await direct(accountId, folderId, ids, size).catch(() => out);
  thumbStats.direct += out.size;
  const missing = ids.filter((id) => !out.has(id));
  if (missing.length) {
    const r = await callFunction<{ thumbs: Record<string, string>; missing: string[] }>(
      "thumb",
      { account_id: accountId, folder_id: folderId, ids: missing, size },
      timeout ? { timeout } : {},
    );
    for (const id of missing) {
      const data = r.thumbs[id];
      if (data) out.set(id, dataUrlToBlob(data));
    }
    thumbStats.viaSupabase += missing.length;
  }
  return out;
}
