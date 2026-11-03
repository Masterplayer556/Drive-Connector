// KI-SUCHE (Test): Verbindung zu den Workern.
// Bildmodell: zuerst Grafikchip (WebGPU) versuchen, sonst Prozessor – bei „Schnell lernen“ bis zu zwei
// Worker parallel. Die Suche hat einen eigenen Worker; während gesucht wird, gibt das Lernen seinen
// Speicher frei. Auf dem iPhone teilen sich App und alle Worker denselben Arbeitsspeicher.
import { setRisk, takeCrash, type Risk } from "./guard";
import { MODEL_CACHE } from "./store";
import type { FromWorker, ToWorker, VisionDevice } from "./protocol";

type Part = "bild" | "text";
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
type Pending = { resolve: (m: FromWorker) => void; reject: (e: Error) => void; slot: number };

const GPU_KEY = "drivepool.ai.gpu"; // "no" = Grafikchip hat hier nicht geklappt
const CAP_KEY = "drivepool.ai.maxw"; // Obergrenze Prozessor-Worker nach einem Absturz
const NOTR_KEY = "drivepool.ai.notr"; // "1" = ohne Übersetzer suchen (nach Absturz bei der Suche)

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignorieren */
  }
}

// ---- Nach einem Absturz beim letzten Mal: eine Stufe sparsamer ----
const crashed: Risk | null = takeCrash();
if (crashed === "gpu") lsSet(GPU_KEY, "no");
else if (crashed?.startsWith("workers:")) lsSet(CAP_KEY, String(Math.max(1, Number(crashed.split(":")[1]) - 1)));
else if (crashed === "search") lsSet(NOTR_KEY, "1");

/** Was nach dem letzten Absturz geändert wurde (für die Anzeige), sonst null. */
export function crashNote(): string | null {
  if (crashed === "gpu") return "Letztes Mal ist die App auf dem Grafikchip abgestürzt – ab jetzt rechnet der Prozessor.";
  if (crashed?.startsWith("workers:")) return "Letztes Mal ist die App beim schnellen Lernen abgestürzt – ab jetzt mit weniger Kernen.";
  if (crashed === "search") return "Letztes Mal ist die App bei der Suche abgestürzt – ab jetzt ohne Übersetzer (spart Speicher, Suche am besten auf Englisch).";
  return null;
}

const cap = Number(lsGet(CAP_KEY)) || 2;
/** Höchstens so viele Prozessor-Worker fürs Lernen (je eine Kopie des Bildmodells im Speicher). */
export const MAX_WORKERS = Math.max(1, Math.min(cap, (navigator.hardwareConcurrency || 2) - 1, 2));
const TEXT = MAX_WORKERS; // eigener Platz für den Such-Worker
const SLOTS = MAX_WORKERS + 1;

const workers: (Worker | null)[] = Array.from({ length: SLOTS }, () => null);
const busy: number[] = Array.from({ length: SLOTS }, () => 0);
const visionReady = new Set<number>();
let visionDevice: VisionDevice | null = null;
let preparing: Promise<void> | null = null;
let searching = false;
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

/** Absturz-Merker auf den aktuellen Stand bringen. */
function updateRisk() {
  if (searching) setRisk("search");
  else if (visionDevice === "webgpu" && visionReady.size) setRisk("gpu");
  else if (visionReady.size > 1) setRisk(`workers:${visionReady.size}`);
  else setRisk(null);
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
  if (slot !== TEXT && !visionReady.size) visionDevice = null;
  updateRisk();
}

function getWorker(slot: number): Worker {
  const existing = workers[slot];
  if (existing) return existing;
  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === "progress") {
      // Downloads zeigen nur der erste Bild-Worker und der Such-Worker (die anderen laden aus dem Gerätespeicher)
      if (slot === 0 || slot === TEXT) {
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
    // Abgestürzt. Beim Grafikchip: künftig den Prozessor nehmen.
    if (slot !== TEXT && visionDevice === "webgpu") lsSet(GPU_KEY, "no");
    kill(slot);
  };
  workers[slot] = w;
  return w;
}

function send(msg: WithoutId<ToWorker>, slot: number): Promise<FromWorker> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, slot });
    busy[slot]++;
    getWorker(slot).postMessage({ ...msg, id } as ToWorker);
  });
}

/** Beim Ausschalten der KI-Suche: alle Merker zurücksetzen. */
export function forgetGpu() {
  for (const k of [GPU_KEY, CAP_KEY, NOTR_KEY]) lsSet(k, null);
}

/** Nicht mehr gebrauchte Bildmodell-Dateien aus dem Gerätespeicher entfernen. */
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
      if ("gpu" in navigator && lsGet(GPU_KEY) !== "no") {
        setRisk("gpu"); // falls das Laden auf dem Grafikchip die App abschiesst
        try {
          await send({ type: "warm", part: "bild", device: "webgpu" }, 0);
          visionDevice = "webgpu";
          visionReady.add(0);
          // Prozessor-Variante des Bildmodells wird nicht mehr gebraucht (Platz sparen; bei Bedarf neu geladen)
          void dropModelFiles("vision_model_quantized");
        } catch {
          lsSet(GPU_KEY, "no");
          kill(0);
          files.bild.clear();
          await dropModelFiles("vision_model_fp16");
        }
      }
      if (!visionDevice) {
        await send({ type: "warm", part: "bild", device: "wasm" }, 0);
        visionDevice = "wasm";
        visionReady.add(0);
      }
      updateRisk();
    }
    if (visionDevice !== "wasm") return;
    const n = Math.min(MAX_WORKERS, Math.max(1, wanted));
    // Zusätzliche Worker nacheinander starten (laden aus dem Gerätespeicher, kein Download)
    for (let slot = 1; slot < n; slot++) {
      if (visionReady.has(slot)) continue;
      setRisk(`workers:${slot + 1}`);
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
    updateRisk();
  })().finally(() => (preparing = null));
  return preparing;
}

/** Bild-Worker, die gerade nichts rechnen, beenden (Speicher frei für die Suche). Wahr, wenn keiner mehr läuft. */
export function releaseIdleVision(): boolean {
  for (let slot = 0; slot < MAX_WORKERS; slot++) if (workers[slot] && busy[slot] === 0) kill(slot);
  return !workers.slice(0, MAX_WORKERS).some(Boolean);
}

/** Suche offen/zu – während der Suche läuft kein Lernen. */
export function setSearching(on: boolean) {
  searching = on;
  updateRisk();
}

let textTimer: ReturnType<typeof setTimeout> | null = null;
/** Such-Worker nach einer Weile ohne Suche beenden (Speicher frei fürs Lernen). */
export function releaseTextLater(ms = 20_000) {
  if (textTimer) clearTimeout(textTimer);
  textTimer = setTimeout(() => {
    textTimer = null;
    if (!searching && busy[TEXT] === 0) kill(TEXT);
  }, ms);
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

/** Text der Suche → Vektor. Lädt das Textmodell beim ersten Mal (im eigenen Such-Worker). */
export async function embedText(text: string): Promise<{ vec: Float32Array; english: string }> {
  if (textTimer) clearTimeout(textTimer);
  const m = await send({ type: "text", text, translate: lsGet(NOTR_KEY) !== "1" }, TEXT);
  if (m.type !== "vec") throw new Error("Unerwartete Antwort");
  return { vec: m.vec, english: m.english ?? text };
}

/** Alle Worker beenden und Arbeitsspeicher freigeben. */
export function shutdown() {
  for (let i = 0; i < SLOTS; i++) kill(i);
  visionDevice = null;
  pending.clear();
  files.bild.clear();
  files.text.clear();
  setRisk(null);
}
