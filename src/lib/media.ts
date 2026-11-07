// Fotos und Videos: erkennen, richtig benennen („3 Fotos“, „2 Videos“, „5 Dateien“) und sortieren.
// Reine Funktionen (getestet).

const VIDEO_EXT = /\.(mov|mp4|m4v|avi|mkv|webm|3gp|3g2|hevc|mts|m2ts|wmv|flv|mpg|mpeg)$/i;

/** Ist das ein Video? Nach Dateityp (File.type / mime_type), sonst nach Endung. */
export function isVideo(f: { name: string; type?: string | null; mime_type?: string | null }): boolean {
  const t = f.mime_type ?? f.type ?? "";
  if (t) return t.startsWith("video/");
  return VIDEO_EXT.test(f.name);
}

/**
 * Universelle Regel: Videos immer ganz unten, nach allen Fotos – egal wie sie heissen.
 * Stabil: die Reihenfolge innerhalb der Fotos bzw. Videos bleibt.
 */
export function videosLast<T extends { name: string; type?: string | null; mime_type?: string | null }>(list: T[]): T[] {
  return [...list.filter((f) => !isVideo(f)), ...list.filter((f) => isVideo(f))];
}

export interface MediaCount {
  photos: number;
  videos: number;
}

export function countMedia(list: { name: string; type?: string | null; mime_type?: string | null }[]): MediaCount {
  const videos = list.filter((f) => isVideo(f)).length;
  return { photos: list.length - videos, videos };
}

/**
 * Wort für die Menge: nur Fotos → „Fotos“, nur Videos → „Videos“, beides → `mixed`
 * („Dateien“ in der App, „Fotos/Videos“ im Protokoll).
 */
export function mediaWord({ photos, videos }: MediaCount, mixed = "Dateien"): string {
  const n = photos + videos;
  if (photos && videos) return mixed;
  if (videos) return n === 1 ? "Video" : "Videos";
  return n === 1 ? "Foto" : "Fotos";
}

/** Anzahl mit Wort: „1 Foto“, „3 Videos“, „5 Dateien“. */
export function mediaCount(c: MediaCount, mixed = "Dateien"): string {
  return `${c.photos + c.videos} ${mediaWord(c, mixed)}`;
}
