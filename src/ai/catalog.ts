// KI-SUCHE (Test): welche Fotos/Videos es gibt (aus dem bestehenden Index in Postgres – nur lesen)
// und deren Vorschaubilder fürs Modell.
import { GRID_SIZE } from "../lib/thumbs";
import { callFunction, supabase } from "../lib/supabase";
import type { Item } from "../lib/types";
import { itemKey } from "./store";

const COLS = "account_id,drive_id,name,is_folder,mime_type,parent_drive_id,size,md5,taken_at,description,path,parent_key";
const PAGE = 1000;
const FRESH_MS = 10 * 60_000;

let cached: { at: number; items: Map<string, Item> } | null = null;
let loading: Promise<Map<string, Item>> | null = null;

/** Alle Fotos und Videos in „Meine Ablage“ aller Konten. */
export function catalog(force = false): Promise<Map<string, Item>> {
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return Promise.resolve(cached.items);
  loading ??= (async () => {
    const out = new Map<string, Item>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("items")
        .select(COLS)
        .eq("is_folder", false)
        .not("path", "is", null)
        .or("mime_type.like.image/*,mime_type.like.video/*")
        .order("account_id")
        .order("drive_id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const it of (data ?? []) as Item[]) out.set(itemKey(it), it);
      if (!data || data.length < PAGE) break;
    }
    cached = { at: Date.now(), items: out };
    return out;
  })().finally(() => (loading = null));
  return loading;
}

// Gleiche Adressen wie src/lib/thumbs.ts → bereits angesehene Fotos kommen direkt aus dem Gerätespeicher
const THUMB_CACHE = "drivepool-thumbs-v1";
const cacheUrl = (it: Item) => new URL(`./__thumbs/${it.account_id}/${it.drive_id}/${GRID_SIZE}`, document.baseURI).toString();

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",", 2);
  const type = /data:([^;]+)/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Vorschaubilder für mehrere Fotos desselben Ordners (max. 30).
 * Anders als getThumb() bleibt hier nichts im Arbeitsspeicher liegen – wichtig bei tausenden Fotos.
 */
/** Vorschaubilder holen: nach so langer Zeit abbrechen (sonst bleibt das Lernen hängen) und später nochmals. */
const THUMB_TIMEOUT = 45_000;

export async function thumbsFor(items: Item[]): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  const cache = "caches" in window ? await caches.open(THUMB_CACHE).catch(() => null) : null;
  const missing: Item[] = [];
  for (const it of items) {
    const hit = await cache?.match(cacheUrl(it)).catch(() => undefined);
    if (hit) out.set(itemKey(it), await hit.blob());
    else missing.push(it);
  }
  if (missing.length) {
    const first = missing[0];
    const r = await callFunction<{ thumbs: Record<string, string>; missing: string[] }>("thumb", {
      account_id: first.account_id,
      folder_id: first.parent_drive_id,
      ids: missing.map((m) => m.drive_id),
      size: GRID_SIZE,
    }, { timeout: THUMB_TIMEOUT });
    for (const it of missing) {
      const data = r.thumbs[it.drive_id];
      if (data) out.set(itemKey(it), dataUrlToBlob(data));
    }
  }
  return out;
}
