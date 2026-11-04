// KI-SUCHE (Test): Verbindung zu den Workern.
// Auf dem iPhone teilen sich App und alle Worker denselben Arbeitsspeicher – darum sparsam:
// ein Bild-Worker (lernt) und ein Such-Worker, nie beide gleichzeitig. Beides läuft auf dem Prozessor.
// Suchbegriffe übersetzt ein kleines Wörterbuch statt eines Übersetzungsmodells.
import { keywordsOf, toEnglish } from "./dict";
import { keywordPrompts, searchPrompts } from "./prompts";
import { setRisk, takeCrash, type Risk } from "./guard";
import { MODEL_CACHE } from "./store";
import { aiModel, learningDevice } from "./flag";
import { MODELS, type FromWorker, type ModelId, type ToWorker } from "./protocol";

type Part = "bild" | "text";
type WithoutId<T> = T extends unknown ? Omit<T, "id" | "model"> : never;
type Pending = { resolve: (m: FromWorker) => void; reject: (e: Error) => void; slot: number };

const VISION = 0; // Bild-Worker (lernt)
const TEXT = 1; // Such-Worker

// ---- Nach einem Absturz beim letzten Mal ----
const crashed: Risk | null = takeCrash();

/** Bei welchem Schritt ist die App letztes Mal abgestürzt? (null = gar nicht) */
export const crashedDuring = (): Risk | null => crashed;

/** Hinweis, wenn die App letztes Mal bei der KI abgestürzt ist, sonst null. */
export function crashNote(): string | null {
  return crashed ? "Letztes Mal ist die App bei der KI-Suche abgestürzt. Bitte melden, falls das wieder passiert." : null;
}

// ---- Aufräumen: Dateien und Merker früherer Versionen (Grafikchip, Übersetzer, mehrere Worker) ----
async function dropModelFiles(part: string) {
  try {
    const cache = await caches.open(MODEL_CACHE);
    for (const r of await cache.keys()) if (r.url.includes(part)) await cache.delete(r);
  } catch {
    /* ignorieren */
  }
}
void dropModelFiles("vision_model_fp16");
void dropModelFiles("opus-mt");
forgetOldSettings();

/** Merker früherer Versionen entfernen (auch beim Ausschalten der KI-Suche). */
export function forgetOldSettings() {
  for (const k of ["drivepool.ai.gpu", "drivepool.ai.maxw", "drivepool.ai.notr"]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignorieren */
    }
  }
}

const workers: (Worker | null)[] = [null, null];
const busy = [0, 0];
let visionReady = false;
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
  setRisk(searching ? "search" : visionReady ? "learn" : null);
}

function kill(slot: number) {
  workers[slot]?.terminate();
  workers[slot] = null;
  busy[slot] = 0;
  if (slot === VISION) visionReady = false;
  for (const [id, p] of pending) {
    if (p.slot !== slot) continue;
    pending.delete(id);
    p.reject(new Error("KI-Worker beendet"));
  }
  updateRisk();
}

function getWorker(slot: number): Worker {
  const existing = workers[slot];
  if (existing) return existing;
  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === "progress") {
      files[m.part].set(m.file, { loaded: m.loaded, total: m.total });
      for (const cb of progressListeners) cb();
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    busy[slot]--;
    if (m.type === "error") p.reject(new Error(m.message));
    else p.resolve(m);
  };
  w.onerror = () => kill(slot);
  workers[slot] = w;
  return w;
}

function send(msg: WithoutId<ToWorker>, slot: number, model: ModelId = aiModel()): Promise<FromWorker> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, slot });
    busy[slot]++;
    // Gewähltes Modell (Standard oder Test) – beim Umschalten werden die Worker neu gestartet
    getWorker(slot).postMessage({ ...msg, id, model } as ToWorker);
  });
}

/** Bildmodell bereitmachen (beim ersten Mal herunterladen, danach aus dem Gerätespeicher). */
/** Auf dem Lern-Gerät (PC) rechnet ein Cloud-Modell auf der Grafikkarte, wenn möglich. */
const useGpu = () => MODELS[aiModel()].cloud && learningDevice();
let device: "webgpu" | "wasm" | null = null;
/** Worauf das Bildmodell rechnet (null = noch nicht geladen). */
export const visionDevice = () => device;

export function prepareVision(): Promise<void> {
  if (visionReady) return Promise.resolve();
  preparing ??= (async () => {
    const m = await send({ type: "warm", part: "bild", gpu: useGpu() }, VISION);
    device = m.type === "ok" ? (m.device ?? "wasm") : "wasm";
    visionReady = true;
    updateRisk();
  })().finally(() => (preparing = null));
  return preparing;
}

/** Bild-Worker beenden, wenn er gerade nichts rechnet (Speicher frei für die Suche). */
export function releaseIdleVision() {
  if (workers[VISION] && busy[VISION] === 0) kill(VISION);
}

/** Suche offen/zu – während der Suche läuft kein Lernen. */
export function setSearching(on: boolean) {
  searching = on;
  updateRisk();
}

let textTimer: ReturnType<typeof setTimeout> | null = null;
/** Such-Worker beenden, sobald nicht mehr gesucht wird (Speicher frei fürs Lernen). */
export function releaseTextLater(ms = 0) {
  if (textTimer) clearTimeout(textTimer);
  textTimer = setTimeout(() => {
    textTimer = null;
    if (!searching) kill(TEXT);
  }, ms);
}

/** Lebt der Such-Worker noch? (Das Bildmodell lädt erst, wenn er weg ist.) */
export const textAlive = () => !!workers[TEXT];

/** Ein Bild → Vektor; null = Bild nicht lesbar. */
export async function embedImage(blob: Blob): Promise<Float32Array | null> {
  if (!visionReady) throw new Error("Bildmodell nicht bereit");
  const m = await send({ type: "images", blobs: [blob], gpu: useGpu() }, VISION);
  if (m.type !== "vecs") throw new Error("Unerwartete Antwort");
  return m.vecs[0] ?? null;
}

/** Erst wenn das Bildmodell entladen ist (Lernen pausiert, sobald die Suche offen ist), sonst wären beide im Speicher. */
async function readyForText() {
  if (textTimer) clearTimeout(textTimer);
  for (let t = 0; t < 100 && workers[VISION]; t++) {
    releaseIdleVision();
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Viele einzelne Begriffe → je ein Vektor („a photo of …“). In kleinen Portionen (Speicher). */
export async function embedConcepts(labels: string[], onProgress?: (done: number) => void): Promise<Float32Array[]> {
  await readyForText();
  const out: Float32Array[] = [];
  for (let i = 0; i < labels.length; i += 24) {
    const part = labels.slice(i, i + 24);
    const m = await send({ type: "text", groups: part.map((l) => [`a photo of ${l}.`]) }, TEXT);
    if (m.type !== "vec") throw new Error("Unerwartete Antwort");
    out.push(...m.vecs);
    onProgress?.(out.length);
  }
  return out;
}

/** Text der Suche → Vektor. Lädt das Textmodell beim ersten Mal (im eigenen Such-Worker). */
export async function embedText(text: string, model?: ModelId): Promise<{ vec: Float32Array; english: string; kvecs: Float32Array[] }> {
  await readyForText();
  const english = toEnglish(text) || text;
  const keywords = keywordsOf(text);
  const m = await send({ type: "text", groups: [searchPrompts(english), ...keywords.map(keywordPrompts)] }, TEXT, model);
  if (m.type !== "vec") throw new Error("Unerwartete Antwort");
  const [vec, ...kvecs] = m.vecs;
  return { vec, english, kvecs };
}

/** Alle Worker beenden und Arbeitsspeicher freigeben. */
export function shutdown() {
  kill(VISION);
  kill(TEXT);
  pending.clear();
  files.bild.clear();
  files.text.clear();
  setRisk(null);
}
