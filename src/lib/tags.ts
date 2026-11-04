// Eigene Tags und Merkzeichen (Farben) an Fotos/Videos – wie die Favoriten im Speicher gehalten,
// damit Punkte im Raster und das Tag-Fenster sofort reagieren. Gespeichert in Supabase (item_tags).
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Item } from "./types";

/** Merkzeichen = Tags mit fester Farbe (wie in der Mac-Dateiablage). */
export const MARKERS = [
  { tag: "Rot", color: "#ef4444" },
  { tag: "Orange", color: "#f97316" },
  { tag: "Gelb", color: "#eab308" },
  { tag: "Grün", color: "#22c55e" },
  { tag: "Blau", color: "#3b82f6" },
  { tag: "Lila", color: "#a855f7" },
] as const;

export const markerColor = (tag: string): string | null => MARKERS.find((m) => m.tag.toLowerCase() === tag.toLowerCase())?.color ?? null;

export const tagKey = (i: Pick<Item, "account_id" | "drive_id">) => `${i.account_id}|${i.drive_id}`;

/** Leerzeichen zusammenfassen, „#“ vorne weg, max. 40 Zeichen. */
export function cleanTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").trim().replace(/\s+/g, " ").slice(0, 40);
}

/** Tags zählen (Gross/klein egal; Merkzeichen zuerst in fester Reihenfolge, dann nach Häufigkeit). */
export function countTags(byItem: Map<string, string[]>): { tag: string; count: number; color: string | null }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const tags of byItem.values()) {
    for (const t of tags) {
      const k = t.toLowerCase();
      const c = counts.get(k) ?? { tag: t, count: 0 };
      c.count++;
      counts.set(k, c);
    }
  }
  const order = (t: string) => {
    const i = MARKERS.findIndex((m) => m.tag.toLowerCase() === t.toLowerCase());
    return i < 0 ? MARKERS.length : i;
  };
  return [...counts.values()]
    .map((c) => ({ ...c, color: markerColor(c.tag) }))
    .sort((a, b) => order(a.tag) - order(b.tag) || b.count - a.count || a.tag.localeCompare(b.tag, "de"));
}

let byItem: Map<string, string[]> | null = null;
let loading: Promise<Map<string, string[]>> | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function loadTags(force = false): Promise<Map<string, string[]>> {
  if (byItem && !force) return Promise.resolve(byItem);
  loading ??= (async () => {
    const out = new Map<string, string[]>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("item_tags").select("account_id,drive_id,tag").order("created_at").range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        const k = tagKey(r);
        out.set(k, [...(out.get(k) ?? []), r.tag]);
      }
      if (!data || data.length < 1000) break;
    }
    byItem = out;
    changed();
    return out;
  })()
    .catch(() => (byItem ??= new Map()))
    .finally(() => (loading = null));
  return loading;
}

export const tagsOf = (i: Item): string[] => byItem?.get(tagKey(i)) ?? [];
export const allTags = () => countTags(byItem ?? new Map());

/** Tags laden und bei Änderungen neu zeichnen. */
export function useTags(): Map<string, string[]> | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    void loadTags();
    return () => void listeners.delete(l);
  }, []);
  return byItem;
}

/** Tag an mehrere Fotos hängen (schon vorhandene bleiben). */
export async function addTag(items: Item[], raw: string): Promise<void> {
  const tag = cleanTag(raw);
  if (!tag) return;
  await loadTags();
  // Schreibweise eines bestehenden Tags übernehmen („ferien“ → „Ferien“)
  const label = allTags().find((t) => t.tag.toLowerCase() === tag.toLowerCase())?.tag ?? markerColorLabel(tag) ?? tag;
  const todo = items.filter((i) => !tagsOf(i).some((t) => t.toLowerCase() === label.toLowerCase()));
  if (!todo.length) return;
  for (const i of todo) byItem!.set(tagKey(i), [...tagsOf(i), label]);
  changed();
  if (items.some((i) => i.is_folder)) folderTags = null; // Ordner-Tags neu laden
  const { error } = await supabase
    .from("item_tags")
    .upsert(todo.map((i) => ({ account_id: i.account_id, drive_id: i.drive_id, tag: label })), { onConflict: "owner_id,account_id,drive_id,tag" });
  if (error) {
    for (const i of todo) byItem!.set(tagKey(i), tagsOf(i).filter((t) => t !== label));
    changed();
    throw new Error(error.message);
  }
}

const markerColorLabel = (tag: string) => MARKERS.find((m) => m.tag.toLowerCase() === tag.toLowerCase())?.tag;

/** Tag von mehreren Fotos entfernen (Gross/klein egal). */
export async function removeTag(items: Item[], tag: string): Promise<void> {
  await loadTags();
  const low = tag.toLowerCase();
  const before = new Map(items.map((i) => [tagKey(i), tagsOf(i)]));
  const affected = items.filter((i) => tagsOf(i).some((t) => t.toLowerCase() === low));
  if (!affected.length) return;
  for (const i of affected) {
    const rest = tagsOf(i).filter((t) => t.toLowerCase() !== low);
    if (rest.length) byItem!.set(tagKey(i), rest);
    else byItem!.delete(tagKey(i));
  }
  changed();
  if (items.some((i) => i.is_folder)) folderTags = null;
  // Pro Konto ein Aufruf; alle Schreibweisen des Tags
  const variants = [...new Set(affected.flatMap((i) => (before.get(tagKey(i)) ?? []).filter((t) => t.toLowerCase() === low)))];
  const byAccount = new Map<string, string[]>();
  for (const i of affected) byAccount.set(i.account_id, [...(byAccount.get(i.account_id) ?? []), i.drive_id]);
  for (const [account, ids] of byAccount) {
    const { error } = await supabase.from("item_tags").delete().eq("account_id", account).in("drive_id", ids).in("tag", variants);
    if (error) {
      for (const [k, v] of before) if (v.length) byItem!.set(k, v);
      changed();
      throw new Error(error.message);
    }
  }
}

// ---- Ordner-Tags: gelten für alles darin ----
let folderTags: { tag: string; path: string }[] | null = null;
let folderLoading: Promise<{ tag: string; path: string }[]> | null = null;

/** Ordner mit Tags (Tag + Pfad). */
export function loadFolderTags(force = false): Promise<{ tag: string; path: string }[]> {
  if (folderTags && !force) return Promise.resolve(folderTags);
  folderLoading ??= (async () => {
    const { data, error } = await supabase.rpc("folder_tags");
    if (error) throw new Error(error.message);
    folderTags = (data ?? []) as { tag: string; path: string }[];
    return folderTags;
  })()
    .catch(() => (folderTags ??= []))
    .finally(() => (folderLoading = null));
  return folderLoading;
}

/** Hat die Datei (Pfad „A/B/x.jpg“) den Tag über einen ihrer Ordner? */
export function inheritsTag(path: string | null, tag: string, folders: { tag: string; path: string }[]): boolean {
  if (!path) return false;
  const p = path.toLowerCase();
  const t = tag.toLowerCase();
  return folders.some((f) => f.tag.toLowerCase() === t && p.startsWith(`${f.path.toLowerCase()}/`));
}

/** Alle Fotos/Videos mit diesem Tag (neueste Markierung zuerst). */
export async function taggedItems(tag: string): Promise<Item[]> {
  const { data, error } = await supabase.rpc("tagged_items", { p_tag: cleanTag(tag) });
  if (error) throw new Error(error.message);
  return (data ?? []) as Item[];
}

/**
 * Tags, die in einer Suche ohne „#“ vorkommen („Ferien Strand“ → Tag „Ferien“).
 * Liefert je Tag die Suche mit #Tag statt des Wortes – zum Antippen.
 */
export function tagHits(query: string, tags: { tag: string; count: number }[]): { tag: string; count: number; query: string }[] {
  const q = query.trim();
  if (!q || q.includes("#")) return [];
  const out: { tag: string; count: number; query: string }[] = [];
  for (const t of tags) {
    const esc = t.tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\s)${esc}(?=$|\\s)`, "iu");
    if (!re.test(q)) continue;
    const ref = t.tag.includes(" ") ? `#"${t.tag}"` : `#${t.tag}`;
    out.push({ ...t, query: q.replace(re, (_m, pre: string) => `${pre}${ref}`) });
  }
  return out.slice(0, 4);
}
