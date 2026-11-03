// KI-SUCHE (Test): Verbindung zu den Workern.
// Bildmodell: zuerst Grafikchip (WebGPU) versuchen, sonst Prozessor – dann bei „Schnell lernen“
// mehrere Worker parallel (je ein Kern). Die Suche (Textmodell) läuft immer im ersten Worker.
import { MODEL_CACHE } from "./store";
import type { FromWorker, ToWorker, VisionDevice } from "./protocol";

type Part = "bild" | "text";
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
type Pending = { resolve: (m: FromWorker) => void; reject: (e: Error) => void; slot: number };

/** Höchstens so viele Prozessor-Worker (je eine Kopie des Bildmodells im Arbeitsspeicher). */
export const MAX_WORKERS = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
const GPU_KEY = "drivepool.ai.gpu"; // "no" = Grafikchip hat hier nicht geklappt → nicht jedes Mal neu versuchen

const workers: (Worker | null)[] = Array.from({ length: MAX_WORKERS }, () => null);
const busy: number[] = Array.from({ length: MAX_WORKERS }, () => 0);
const visionReady = new Set<number>();
let visionDevice: VisionDevice | null = null;
let preparing: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

/** Download-Fortschritt der Modelldateien, pro Teil (Bild-/Textmodell). */
const files: Record<Part, Map<string, { loaded: number; total: number }>> = { bild: new Map(), text: new Map() };
const progressListeners = new Set<() => void>();

export function modelProgress(part: Part): { loaded: number; total: number } | null {
  const list = [...files[part].values()];
  if (!list.length) return null;
  return list.reduce((a, f) => ({ loaded: a.loaded + f.loaded, total: a.total + f.total }), { loaded: 0, total: 0 });
}

export function onModelProgress(cb: () => void): () => void {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}

function kill(slot: number) {
  workers[slot]?.terminate();
  workers[slot] = null;
  busy[slot] = 0;
  visionReady.delete(slot);
  for (const [id, p] of pending) {
    if (p.slot !== slot) continue;
    pending.delete(id);
    p.reject(new Error("KI-Worker beendet"));
  }
}

function getWorker(slot: number): Worker {
  const existing = workers[slot];
  if (existing) return existing;
  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === "progress") {
      // Nur der erste Worker lädt herunter, die anderen kommen aus dem Gerätespeicher
      if (slot === 0) {
        files[m.part].set(m.file, { loaded: m.loaded, total: m.total });
        for (const cb of progressListeners) cb();
      }
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    busy[slot]--;
    if (m.type === "error") p.reject(new Error(m.message));
    else p.resolve(m);
  };
  w.onerror = () => {
    // Abgestürzt (z. B. zu wenig Arbeitsspeicher). Beim Grafikchip: künftig Prozessor nehmen.
    if (slot === 0 && visionDevice === "webgpu") rememberNoGpu();
    if (slot === 0) visionDevice = null;
    kill(slot);
  };
  workers[slot] = w;
  return w;
}

function send(msg: WithoutId<ToWorker>, slot = 0): Promise<FromWorker> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, slot });
    busy[slot]++;
    getWorker(slot).postMessage({ ...msg, id } as ToWorker);
  });
}

function gpuPossible(): boolean {
  try {
    return "gpu" in navigator && localStorage.getItem(GPU_KEY) !== "no";
  } catch {
    return false;
  }
}
function rememberNoGpu() {
  try {
    localStorage.setItem(GPU_KEY, "no");
  } catch {
    /* ignorieren */
  }
}
/** Beim Ausschalten der KI-Suche mit aufräumen. */
export function forgetGpu() {
  try {
    localStorage.removeItem(GPU_KEY);
  } catch {
    /* ignorieren */
  }
}

/** Nicht mehr gebrauchte Bildmodell-Dateien aus dem Gerätespeicher entfernen (z. B. „_fp16“ oder „vision_model_quantized“). */
async function dropModelFiles(part: string) {
  try {
    const cache = await caches.open(MODEL_CACHE);
    for (const r of await cache.keys()) if (r.url.includes(part)) await cache.delete(r);
  } catch {
    /* ignorieren */
  }
}

/**
 * Bildmodell bereitmachen: beim ersten Mal Grafikchip oder Prozessor wählen,
 * auf dem Prozessor dann so viele Worker wie gewünscht (überzählige werden beendet).
 */
export function prepareVision(wanted: number): Promise<void> {
  preparing ??= (async () => {
    if (!visionDevice) {
      if (gpuPossible()) {
        try {
          await send({ type: "warm", part: "bild", device: "webgpu" }, 0);
          visionDevice = "webgpu";
          // Prozessor-Variante des Bildmodells wird nicht mehr gebraucht (Platz sparen; bei Bedarf neu geladen)
          void dropModelFiles("vision_model_quantized");
        } catch {
          rememberNoGpu();
          kill(0);
          files.bild.clear();
          await dropModelFiles("vision_model_fp16");
        }
      }
      if (!visionDevice) {
        await send({ type: "warm", part: "bild", device: "wasm" }, 0);
        visionDevice = "wasm";
      }
      visionReady.add(0);
    }
    if (visionDevice !== "wasm") return;
    const n = Math.min(MAX_WORKERS, Math.max(1, wanted));
    // Zusätzliche Worker nacheinander starten (laden aus dem Gerätespeicher, kein Download)
    for (let slot = 1; slot < n; slot++) {
      if (visionReady.has(slot)) continue;
      try {
        await send({ type: "warm", part: "bild", device: "wasm" }, slot);
        visionReady.add(slot);
      } catch {
        kill(slot);
        break;
      }
    }
    // Weniger gewünscht → Arbeitsspeicher freigeben (nur ruhende Worker)
    for (let slot = n; slot < MAX_WORKERS; slot++) if (visionReady.has(slot) && busy[slot] === 0) kill(slot);
  })().finally(() => (preparing = null));
  return preparing;
}

/** Womit gerade gerechnet wird. */
export function visionInfo(): { device: VisionDevice | null; workers: number } {
  return { device: visionDevice, workers: visionReady.size };
}

/** Mehrere Bilder auf einmal; null = Bild nicht lesbar. */
export async function embedImages(blobs: Blob[]): Promise<(Float32Array | null)[]> {
  let slot = -1;
  for (const s of visionReady) if (slot < 0 || busy[s] < busy[slot]) slot = s;
  if (slot < 0) throw new Error("Bildmodell nicht bereit");
  const m = await send({ type: "images", blobs }, slot);
  if (m.type !== "vecs") throw new Error("Unerwartete Antwort");
  return m.vecs;
}

/** Text der Suche → Vektor. Lädt das Textmodell beim ersten Mal. */
export async function embedText(text: string): Promise<{ vec: Float32Array; english: string }> {
  const m = await send({ type: "text", text });
  if (m.type !== "vec") throw new Error("Unerwartete Antwort");
  return { vec: m.vec, english: m.english ?? text };
}

/** Alle Worker beenden und Arbeitsspeicher freigeben. */
export function shutdown() {
  for (let i = 0; i < MAX_WORKERS; i++) kill(i);
  visionDevice = null;
  pending.clear();
  files.bild.clear();
  files.text.clear();
}
