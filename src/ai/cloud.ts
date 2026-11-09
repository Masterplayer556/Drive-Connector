// KI-SUCHE: Fingerabdrücke über Supabase teilen – am PC gelernt (genaues Modell), auf dem iPhone
// nur heruntergeladen und zum Suchen benutzt. Es sind nur Zahlen, keine Fotos.
// Kompakt gespeichert: [Float32 Skalierung][512 × Int8] als Base64 (≈ 700 Zeichen pro Foto).
import { supabase } from "../lib/supabase";
import { MODELS, type ModelId } from "./protocol";
import { getMeta, putMeta, putSkips, putVectors } from "./store";

export { decodeVec, encodeVec } from "./vecCodec";
import { decodeVec, encodeVec } from "./vecCodec";

const split = (key: string) => {
  const i = key.indexOf("/");
  return { account_id: key.slice(0, i), drive_id: key.slice(i + 1) };
};

/** Gelernte Fingerabdrücke hochladen (Schlüssel = "konto/datei"). null = nicht lernbar (kein Vorschaubild). */
export async function uploadVectors(model: string, entries: [string, Float32Array | null][]) {
  const at = new Date().toISOString();
  for (let i = 0; i < entries.length; i += 200) {
    const rows = entries.slice(i, i + 200).map(([k, v]) => ({ model, ...split(k), v: v ? encodeVec(v) : "", updated_at: at }));
    const { error } = await supabase.from("ai_vectors").upsert(rows, { onConflict: "owner_id,model,account_id,drive_id" });
    if (error) throw new Error(error.message);
  }
}

let syncing: Promise<number> | null = null;
const OVERLAP_MS = 15 * 60_000;

/**
 * Bestimmte Fotos gezielt holen (Selbstheilung): fehlen dem iPhone Fotos, die der PC schon gelernt hat,
 * werden genau diese nachgeladen. Ergebnis: Anzahl gefundene.
 */
export async function fetchKeys(id: ModelId, keys: string[]): Promise<number> {
  const model = MODELS[id].version;
  const byAccount = new Map<string, string[]>();
  for (const k of keys) {
    const { account_id, drive_id } = split(k);
    byAccount.set(account_id, [...(byAccount.get(account_id) ?? []), drive_id]);
  }
  let found = 0;
  for (const [account_id, ids] of byAccount) {
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await supabase
        .from("ai_vectors")
        .select("account_id,drive_id,v")
        .eq("model", model)
        .eq("account_id", account_id)
        .in("drive_id", ids.slice(i, i + 150));
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      await putVectors(rows.filter((r) => r.v).map((r) => [`${r.account_id}/${r.drive_id}`, decodeVec(r.v)] as [string, Float32Array]), id);
      await putSkips(rows.filter((r) => !r.v).map((r) => `${r.account_id}/${r.drive_id}`), id);
      found += rows.length;
    }
  }
  return found;
}

/** Neue Fingerabdrücke vom PC holen (nur, was seit dem letzten Mal dazukam). Ergebnis: Anzahl neue. */
export function syncDown(id: ModelId, onProgress?: (n: number) => void): Promise<number> {
  const model = MODELS[id].version;
  syncing ??= (async () => {
    const last = (await getMeta<string>("cloud-sync", id).catch(() => undefined)) ?? "1970-01-01T00:00:00Z";
    // Mit Überlappung abfragen: der PC lädt Pakete mit gleicher Zeit in mehreren Teilen hoch – sonst
    // könnte ein Teil, der erst nach dem letzten Abgleich ankam, für immer fehlen (doppelt holen schadet nicht)
    const since = new Date(Math.max(0, Date.parse(last) - OVERLAP_MS)).toISOString();
    let newest = last;
    let count = 0;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("ai_vectors")
        .select("account_id,drive_id,v,updated_at")
        .eq("model", model)
        .gt("updated_at", since)
        .order("updated_at")
        .order("account_id")
        .order("drive_id")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      // Leerer Eintrag = der PC konnte das Foto nicht lernen (kein Vorschaubild) → hier als erledigt merken
      await putVectors(rows.filter((r) => r.v).map((r) => [`${r.account_id}/${r.drive_id}`, decodeVec(r.v)] as [string, Float32Array]), id);
      await putSkips(rows.filter((r) => !r.v).map((r) => `${r.account_id}/${r.drive_id}`), id);
      for (const r of rows) if (Date.parse(r.updated_at) > Date.parse(newest)) newest = new Date(r.updated_at).toISOString();
      count += rows.length;
      onProgress?.(count);
      if (rows.length < 1000) break;
    }
    if (newest !== last) await putMeta("cloud-sync", newest, id);
    return count;
  })().finally(() => (syncing = null));
  return syncing;
}
