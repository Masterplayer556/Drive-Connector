// KI-SUCHE (Test): Fingerabdrücke über Supabase teilen – am PC gelernt (genaues Modell), auf dem iPhone
// nur heruntergeladen und zum Suchen benutzt. Es sind nur Zahlen, keine Fotos.
// Kompakt gespeichert: [Float32 Skalierung][512 × Int8] als Base64 (≈ 700 Zeichen pro Foto).
import { supabase } from "../lib/supabase";
import { MODELS, type ModelId } from "./protocol";
import { getMeta, putMeta, putVectors } from "./store";

/** Vektor → kurzer Text (gerundet auf 8 Bit; für die Suche genau genug). */
export function encodeVec(v: Float32Array): string {
  let max = 0;
  for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i]));
  const scale = max || 1;
  const bytes = new Uint8Array(4 + v.length);
  new DataView(bytes.buffer).setFloat32(0, scale, true);
  for (let i = 0; i < v.length; i++) bytes[4 + i] = (Math.round((v[i] / scale) * 127) + 256) % 256;
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** Text → Vektor (wieder auf Länge 1 gebracht). */
export function decodeVec(text: string): Float32Array {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const scale = new DataView(bytes.buffer).getFloat32(0, true);
  const v = new Float32Array(bytes.length - 4);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const b = bytes[4 + i];
    v[i] = ((b > 127 ? b - 256 : b) / 127) * scale;
    sum += v[i] * v[i];
  }
  const n = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

const split = (key: string) => {
  const i = key.indexOf("/");
  return { account_id: key.slice(0, i), drive_id: key.slice(i + 1) };
};

/** Gelernte Fingerabdrücke hochladen (Schlüssel = "konto/datei"). */
export async function uploadVectors(model: string, entries: [string, Float32Array][]) {
  const at = new Date().toISOString();
  for (let i = 0; i < entries.length; i += 200) {
    const rows = entries.slice(i, i + 200).map(([k, v]) => ({ model, ...split(k), v: encodeVec(v), updated_at: at }));
    const { error } = await supabase.from("ai_vectors").upsert(rows, { onConflict: "owner_id,model,account_id,drive_id" });
    if (error) throw new Error(error.message);
  }
}

let syncing: Promise<number> | null = null;

/** Neue Fingerabdrücke vom PC holen (nur, was seit dem letzten Mal dazukam). Ergebnis: Anzahl neue. */
export function syncDown(id: ModelId, onProgress?: (n: number) => void): Promise<number> {
  const model = MODELS[id].version;
  syncing ??= (async () => {
    const last = (await getMeta<string>("cloud-sync", id).catch(() => undefined)) ?? "1970-01-01T00:00:00Z";
    let newest = last;
    let count = 0;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("ai_vectors")
        .select("account_id,drive_id,v,updated_at")
        .eq("model", model)
        .gt("updated_at", last)
        .order("updated_at")
        .order("account_id")
        .order("drive_id")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      await putVectors(rows.map((r) => [`${r.account_id}/${r.drive_id}`, decodeVec(r.v)] as [string, Float32Array]), id);
      for (const r of rows) if (r.updated_at > newest) newest = r.updated_at;
      count += rows.length;
      onProgress?.(count);
      if (rows.length < 1000) break;
    }
    if (newest !== last) await putMeta("cloud-sync", newest, id);
    return count;
  })().finally(() => (syncing = null));
  return syncing;
}
