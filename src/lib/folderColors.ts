// Eigene Ordnerfarben: einmal laden, im Speicher halten, Änderungen sofort an alle Ansichten melden.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { folderHue } from "./theme";

/** Auswahl für die Farbpalette (Farbtöne) */
export const FOLDER_HUES = [0, 22, 42, 95, 145, 175, 198, 220, 255, 280, 315, 340];

let colors: Map<string, number> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load(): Promise<void> {
  if (colors) return Promise.resolve();
  loading ??= (async () => {
    try {
      const { data } = await supabase.from("folder_colors").select("path_key,hue");
      colors = new Map((data ?? []).map((r) => [r.path_key as string, r.hue as number]));
    } catch {
      colors = new Map();
    }
    emit();
  })();
  return loading;
}

/** Farbton eines Ordners: eigene Farbe, sonst automatisch aus dem Namen. */
export function hueOf(key: string, name: string): number {
  return colors?.get(key) ?? folderHue(name);
}

export function customHue(key: string): number | null {
  return colors?.get(key) ?? null;
}

export async function setFolderHue(key: string, hue: number | null): Promise<void> {
  await load();
  if (hue === null) {
    colors!.delete(key);
    emit();
    const { error } = await supabase.from("folder_colors").delete().eq("path_key", key);
    if (error) throw new Error(error.message);
  } else {
    colors!.set(key, hue);
    emit();
    const { error } = await supabase
      .from("folder_colors")
      .upsert({ path_key: key, hue, updated_at: new Date().toISOString() }, { onConflict: "owner_id,path_key" });
    if (error) throw new Error(error.message);
  }
}

/** Beim Umbenennen/Verschieben die Farbe mitnehmen (auch für Unterordner). */
export async function moveFolderHues(fromKey: string, toKey: string): Promise<void> {
  await load();
  const moves = [...colors!].filter(([k]) => k === fromKey || k.startsWith(fromKey + "/"));
  for (const [k, h] of moves) {
    await setFolderHue(k, null);
    await setFolderHue(toKey + k.slice(fromKey.length), h);
  }
}

/** React: neu zeichnen, sobald Farben geladen oder geändert wurden. */
export function useFolderColors(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const l = () => setV((x) => x + 1);
    listeners.add(l);
    void load();
    return () => void listeners.delete(l);
  }, []);
  return v;
}
