// KI-SUCHE (Test): Verbindung zum Worker. Ein Worker für die ganze App.
import type { FromWorker, ToWorker } from "./protocol";

type Part = "bild" | "text";
type Pending = { resolve: (m: FromWorker) => void; reject: (e: Error) => void };
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

let worker: Worker | null = null;
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

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === "progress") {
      files[m.part].set(m.file, { loaded: m.loaded, total: m.total });
      for (const cb of progressListeners) cb();
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.type === "error") p.reject(new Error(m.message));
    else p.resolve(m);
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || "KI-Modell abgestürzt");
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function send(msg: WithoutId<ToWorker>): Promise<FromWorker> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id } as ToWorker);
  });
}

/** Modell vorab laden (beim ersten Mal: herunterladen). */
export async function warm(part: Part): Promise<void> {
  await send({ type: "warm", part });
}

export async function embedImage(blob: Blob): Promise<Float32Array> {
  const m = await send({ type: "image", blob });
  if (m.type !== "vec") throw new Error("Unerwartete Antwort");
  return m.vec;
}

export async function embedText(text: string): Promise<{ vec: Float32Array; english: string }> {
  const m = await send({ type: "text", text });
  if (m.type !== "vec") throw new Error("Unerwartete Antwort");
  return { vec: m.vec, english: m.english ?? text };
}

/** Worker beenden und Arbeitsspeicher freigeben. */
export function shutdown() {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error("KI-Suche beendet"));
  pending.clear();
  files.bild.clear();
  files.text.clear();
}
