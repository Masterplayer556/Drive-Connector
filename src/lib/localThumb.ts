// Vorschaubilder für Fotos/Videos vom Gerät (vor dem Hochladen).
//
// Früher wurde jedes Foto in voller Grösse als Vorschau angezeigt. Bei grossen Fotos (mehrere MB, 12–48 MP)
// sprengt das auf dem Handy den Speicher für Bilder – der Browser lässt dann einzelne Kacheln einfach leer.
// Darum wird jedes Foto hier einmal (nacheinander, höchstens zwei gleichzeitig) auf max. 320 px verkleinert
// und nur das kleine Bild angezeigt. Videos bekommen ein Standbild aus der ersten Sekunde.
import { useEffect, useState } from "react";

export const LOCAL_THUMB_SIZE = 320;
const PARALLEL = 2;
const VIDEO_TIMEOUT = 8000;

const isVideo = (f: File) => f.type.startsWith("video/") || /\.(mov|mp4|m4v|3gp|webm|mkv|avi)$/i.test(f.name);

function once(el: HTMLElement, ok: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(t);
      el.removeEventListener(ok, onOk);
      el.removeEventListener("error", onErr);
      fn();
    };
    const onOk = () => done(resolve);
    const onErr = () => done(() => reject(new Error("Vorschau nicht möglich")));
    const t = setTimeout(() => done(() => reject(new Error("Zeitüberschreitung"))), timeout);
    el.addEventListener(ok, onOk);
    el.addEventListener("error", onErr);
  });
}

/** Quadratisch zugeschnitten (wie object-fit: cover) auf max. `size` px zeichnen und als JPEG ausgeben. */
async function draw(src: CanvasImageSource, w: number, h: number, size: number): Promise<Blob> {
  if (!w || !h) throw new Error("Leeres Bild");
  const side = Math.min(w, h);
  const out = Math.min(size, side);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kein Canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
  // Speicher des Canvas sofort freigeben (Safari hält ihn sonst lange fest)
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error("Vorschau nicht möglich");
  return blob;
}

async function imageThumb(file: File, size: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return await draw(img, img.naturalWidth, img.naturalHeight, size);
  } finally {
    img.removeAttribute("src"); // dekodiertes Grossbild freigeben
    URL.revokeObjectURL(url);
  }
}

async function videoThumb(file: File, size: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  try {
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const meta = once(v, "loadedmetadata", VIDEO_TIMEOUT);
    v.src = url;
    await meta;
    const seeked = once(v, "seeked", VIDEO_TIMEOUT);
    v.currentTime = Math.min(1, (v.duration || 0) / 2) || 0.01;
    await seeked;
    return await draw(v, v.videoWidth, v.videoHeight, size);
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}

/** Kleines Vorschaubild (Object-URL) – oder null, wenn der Browser die Datei nicht anzeigen kann. */
export async function makeLocalThumb(file: File, size = LOCAL_THUMB_SIZE): Promise<string | null> {
  try {
    const blob = isVideo(file) ? await videoThumb(file, size) : await imageThumb(file, size);
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/**
 * Vorschaubilder für eine Auswahl vom Gerät, der Reihe nach erstellt.
 * Wert pro ID: undefined = wird noch erstellt, null = nicht darstellbar, sonst Object-URL.
 */
export function useLocalThumbs(files: Map<string, File>): Map<string, string | null> {
  const [thumbs, setThumbs] = useState<Map<string, string | null>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    setThumbs(new Map());
    const queue = [...files];
    const worker = async () => {
      for (let next = queue.shift(); next && !cancelled; next = queue.shift()) {
        const [id, f] = next;
        const url = await makeLocalThumb(f);
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          break;
        }
        if (url) created.push(url);
        setThumbs((m) => new Map(m).set(id, url));
      }
    };
    void Promise.all(Array.from({ length: PARALLEL }, worker));
    return () => {
      cancelled = true;
      // Kurz verzögert freigeben, falls ein Bild gerade noch angezeigt wird
      setTimeout(() => created.forEach((u) => URL.revokeObjectURL(u)), 1000);
    };
  }, [files]);
  return thumbs;
}
