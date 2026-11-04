// Eigene Ordnerfarben: einmal laden, im Speicher halten, Änderungen sofort an alle Ansichten melden.
// Reihenfolge: eigene Farbe → Farbe aus den Fotos im Ordner → Farbe aus dem Namen.
import { useEffect, useState } from "react";
import { dominantHue, hueHistogram, needsUpdate } from "./photoHue";
import { supabase } from "./supabase";
import { folderHue } from "./theme";
import { getThumb } from "./thumbs";
import type { Item } from "./types";

/** Auswahl für die Farbpalette (Farbtöne) */
export const FOLDER_HUES = [0, 22, 42, 95, 145, 175, 198, 220, 255, 280, 315, 340];

let colors: Map<string, number> | null = null;
/** Aus den Fotos berechnet (hue null = Fotos fast ohne Farbe) */
let photo: Map<string, { hue: number | null; photos: number; at: number }> = new Map();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load(): Promise<void> {
  if (colors) return Promise.resolve();
  loading ??= (async () => {
    try {
      const [{ data }, { data: auto }] = await Promise.all([
        supabase.from("folder_colors").select("path_key,hue"),
        supabase.from("folder_photo_hues").select("path_key,hue,photos,updated_at"),
      ]);
      colors = new Map((data ?? []).map((r) => [r.path_key as string, r.hue as number]));
      photo = new Map(
        (auto ?? []).map((r) => [r.path_key as string, { hue: r.hue as number | null, photos: r.photos as number, at: Date.parse(r.updated_at as string) }]),
      );
    } catch {
      colors = new Map();
    }
    emit();
  })();
  return loading;
}

/** Farbton eines Ordners: eigene Farbe, sonst aus den Fotos darin, sonst aus dem Namen. */
export function hueOf(key: string, name: string): number {
  return colors?.get(key) ?? photo.get(key)?.hue ?? folderHue(name);
}

/** Farbton aus den Fotos (null = keiner berechnet oder Fotos ohne Farbe). */
export const photoHueOf = (key: string): number | null => photo.get(key)?.hue ?? null;

const PIXELS = 32;
/** Farbton-Verteilung eines Vorschaubilds (verkleinert auf 32×32 Bildpunkte). */
async function histogramOf(url: string) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob); // ohne Grössen-Optionen (Safari kennt sie nicht überall)
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(PIXELS, PIXELS) : Object.assign(document.createElement("canvas"), { width: PIXELS, height: PIXELS });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("Kein Canvas");
  ctx.drawImage(bmp, 0, 0, PIXELS, PIXELS);
  bmp.close();
  return hueHistogram(ctx.getImageData(0, 0, PIXELS, PIXELS).data);
}

let photoRun: Promise<void> | null = null;
/**
 * Ordnerfarben aus den Fotos berechnen (nebenbei, ein Ordner nach dem anderen): je Ordner bis zu 12 kleine
 * Vorschaubilder ansehen. Nur, was neu ist oder sich deutlich verändert hat. Ergebnis landet in der Datenbank
 * (gilt auf allen Geräten).
 */
export function updatePhotoHues(): Promise<void> {
  photoRun ??= (async () => {
    await load();
    const { data, error } = await supabase.rpc("folder_photo_samples");
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { parent_key: string; photos: number; samples: Pick<Item, "account_id" | "drive_id" | "parent_drive_id">[] }[]) {
      if (!needsUpdate(photo.get(row.parent_key), row.photos)) continue;
      const hists = [];
      for (const s of row.samples) {
        try {
          hists.push(await histogramOf(await getThumb(s as Item, 100)));
        } catch {
          /* Foto ohne Vorschau – überspringen */
        }
      }
      if (!hists.length) continue;
      const hue = dominantHue(hists);
      photo.set(row.parent_key, { hue, photos: row.photos, at: Date.now() });
      emit();
      await supabase
        .from("folder_photo_hues")
        .upsert({ path_key: row.parent_key, hue, photos: row.photos, updated_at: new Date().toISOString() }, { onConflict: "owner_id,path_key" });
      await new Promise((r) => setTimeout(r, 200)); // die App nicht ausbremsen
    }
  })()
    .catch(() => undefined)
    .finally(() => (photoRun = null));
  return photoRun;
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
