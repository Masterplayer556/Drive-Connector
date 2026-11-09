// KI-SUCHE: Namen und 👍/👎 zusätzlich in Supabase sichern und zwischen Geräten abgleichen.
// Grund: Auf dem iPhone löscht iOS den App-Speicher, wenn die App vom Home-Bildschirm entfernt wird.
import { supabase } from "../lib/supabase";
import { decodeVec, encodeVec } from "./vecCodec";

export interface FeedbackRow {
  id: string;
  q: Float32Array;
  english: string;
  key: string;
  vote: 1 | -1;
  at: number;
}

export interface CloudRow {
  id: string;
  key: string | null;
  english: string | null;
  vote: number | null;
  q: string | null;
  at: number;
  deleted: boolean;
}

/** Was nach dem Vergleich zu tun ist: neuere Seite gewinnt, Löschungen gelten auf allen Geräten. */
export function mergeFeedback(local: FeedbackRow[], cloud: CloudRow[]) {
  const mine = new Map(local.map((f) => [f.id, f]));
  const theirs = new Map(cloud.map((c) => [c.id, c]));
  const putLocal: FeedbackRow[] = [];
  const deleteLocal: string[] = [];
  const upload: FeedbackRow[] = [];
  for (const c of cloud) {
    const l = mine.get(c.id);
    if (c.deleted) {
      if (l && l.at <= c.at) deleteLocal.push(c.id);
      else if (l) upload.push(l); // lokal nach dem Löschen neu gesetzt
      continue;
    }
    if (!l || c.at > l.at) {
      if (c.key && c.english && (c.vote === 1 || c.vote === -1)) {
        putLocal.push({ id: c.id, key: c.key, english: c.english, vote: c.vote, at: c.at, q: c.q ? decodeVec(c.q) : new Float32Array(0) });
      }
    } else if (l.at > c.at) upload.push(l);
  }
  for (const l of local) if (!theirs.has(l.id)) upload.push(l);
  return { putLocal, deleteLocal, upload };
}

const toRow = (f: FeedbackRow) => ({
  id: f.id,
  key: f.key,
  english: f.english,
  vote: f.vote,
  q: f.q.length ? encodeVec(f.q) : null,
  at: f.at,
  deleted: false,
});

export async function uploadFeedback(rows: FeedbackRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("ai_feedback").upsert(rows.slice(i, i + 200).map(toRow), { onConflict: "owner_id,id" });
    if (error) throw new Error(error.message);
  }
}

export async function tombstoneFeedback(id: string): Promise<void> {
  const { error } = await supabase
    .from("ai_feedback")
    .upsert({ id, key: null, english: null, vote: null, q: null, at: Date.now(), deleted: true }, { onConflict: "owner_id,id" });
  if (error) throw new Error(error.message);
}

export async function pullFeedback(): Promise<CloudRow[]> {
  const out: CloudRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("ai_feedback").select("id,key,english,vote,q,at,deleted").order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as CloudRow[]).map((r) => ({ ...r, at: Number(r.at) })));
    if (!data || data.length < 1000) return out;
  }
}

/** „KI-Daten löschen“: auch die Sicherung leeren – als Löschmarke, damit andere Geräte nichts zurückholen. */
export async function wipeCloudFeedback(): Promise<void> {
  const { error } = await supabase
    .from("ai_feedback")
    .update({ key: null, english: null, vote: null, q: null, at: Date.now(), deleted: true })
    .eq("deleted", false);
  if (error) throw new Error(error.message);
}
