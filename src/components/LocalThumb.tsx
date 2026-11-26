import { useEffect, useRef, useState, type ReactNode } from "react";
import { isVideo } from "../lib/media";
import Icon from "./Icon";
import { observe } from "./Thumb";

// Vorschau für Dateien vom Gerät (Upload): erst wenn die Kachel bald sichtbar ist und verkleinert –
// sonst hält die Seite bei hunderten Fotos hunderte volle Bilder im Speicher. Videos zeigen ein Symbol.

/** Kürzere Seite der Vorschau in Bildpunkten */
const SIZE = 240;
/** So viele Bilder werden gleichzeitig entschlüsselt */
const PARALLEL = 2;

let running = 0;
const waiting: (() => void)[] = [];
async function inSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

async function shrink(file: File): Promise<string> {
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  let release: () => void;
  try {
    const bmp = await createImageBitmap(file);
    [source, w, h, release] = [bmp, bmp.width, bmp.height, () => bmp.close()];
  } catch {
    // z. B. HEIC: createImageBitmap kann es nicht überall, <img> schon
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
    [source, w, h, release] = [img, img.naturalWidth, img.naturalHeight, () => URL.revokeObjectURL(url)];
  }
  try {
    const scale = Math.min(1, SIZE / Math.max(1, Math.min(w, h)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    if (!blob) throw new Error("Vorschau nicht möglich");
    return URL.createObjectURL(blob);
  } finally {
    release();
  }
}

export default function LocalThumb({ file, children }: { file: File; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const video = isVideo(file);
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (video || !ref.current) return;
    let alive = true;
    let url: string | null = null;
    const stop = observe(ref.current, () => {
      inSlot(() => (alive ? shrink(file) : Promise.resolve(null)))
        .then((u) => {
          if (!u) return;
          if (alive) setSrc((url = u));
          else URL.revokeObjectURL(u);
        })
        .catch(() => alive && setFailed(true));
    });
    return () => {
      alive = false;
      stop();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, video]);

  return (
    <div ref={ref} className={`thumb-wrap ${!video && !loaded && !failed ? "skeleton" : ""}`}>
      {src && <img className={`thumb ${loaded ? "loaded" : ""}`} src={src} alt={file.name} decoding="async" onLoad={() => setLoaded(true)} />}
      {(video || failed) && (
        <div className="thumb-placeholder">
          <Icon name={video ? "play" : "image"} size={24} />
        </div>
      )}
      {children}
    </div>
  );
}
