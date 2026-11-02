// Favoriten (#11) – im Speicher gehalten, damit das Herz in der Foto-Ansicht sofort reagiert.
import { fetchFavoriteKeys, setFavorite } from "./db";
import type { Item } from "./types";

let keys: Set<string> | null = null;
let loading: Promise<Set<string>> | null = null;
const listeners = new Set<() => void>();

export const favKey = (i: Item) => `${i.account_id}|${i.drive_id}`;

export function loadFavorites(): Promise<Set<string>> {
  if (keys) return Promise.resolve(keys);
  if (!loading) {
    loading = fetchFavoriteKeys()
      .then((k) => (keys = k))
      .catch(() => (keys = new Set()))
      .finally(() => (loading = null));
  }
  return loading;
}

export function isFavorite(i: Item): boolean {
  return keys?.has(favKey(i)) ?? false;
}

export function onFavoritesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function toggleFavorite(i: Item): Promise<boolean> {
  await loadFavorites();
  const on = !keys!.has(favKey(i));
  if (on) keys!.add(favKey(i));
  else keys!.delete(favKey(i));
  listeners.forEach((l) => l());
  try {
    await setFavorite(i, on);
  } catch (e) {
    if (on) keys!.delete(favKey(i));
    else keys!.add(favKey(i));
    listeners.forEach((l) => l());
    throw e;
  }
  return on;
}
