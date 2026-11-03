// KI-SUCHE (Test): baut den Index nebenbei auf, solange die App offen ist.
// Portionsweise (ein Ordner, max. 30 Fotos). Normal: Pause bei Bedienung. „Schnell lernen“: keine Pausen,
// Bildschirm bleibt an. Im Hintergrund friert iOS Web-Apps ein – dann geht es beim nächsten Öffnen weiter.
import type { Item } from "../lib/types";
import { catalog, thumbsFor } from "./catalog";
import { embedImages, MAX_WORKERS, prepareVision, shutdown, visionInfo } from "./engine";
import type { VisionDevice } from "./protocol";
import { itemKey, markSkip, putVector, removeKeys, skipped, vectorKeys } from "./store";

export type Phase = "start" | "model" | "indexing" | "done" | "paused" | "error" | "off";

export interface IndexState {
  phase: Phase;
  done: number;
  total: number;
  error: string | null;
  /** Fotos pro Sekunde (gleitender Schnitt), 0 = noch unbekannt */
  rate: number;
  /** „Schnell lernen“ aktiv */
  turbo: boolean;
  /** Womit gerechnet wird und mit wie vielen Workern */
  device: VisionDevice | null;
  workers: number;
}

const CHUNK = 30;
const RETRY_SKIP_MS = 7 * 24 * 3600_000; // Fotos ohne Vorschau nach einer Woche nochmals versuchen
const RECHECK_MS = 10 * 60_000;
const QUIET_MS = 1500; // so lange nach dem letzten Tippen/Scrollen warten

let state: IndexState = { phase: "off", done: 0, total: 0, error: null, rate: 0, turbo: false, device: null, workers: 0 };
const listeners = new Set<() => void>();
// Jeder Start bekommt eine neue Nummer; ein alter Durchlauf merkt so, dass er aufhören muss.
let generation = 0;
let active = 0;
const wakers = new Set<() => void>();
let lastInput = 0;
let wakeLock: WakeLockSentinel | null = null;

export const indexState = () => state;
export function onIndexState(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function set(patch: Partial<IndexState>) {
  state = { ...state, ...patch };
  for (const cb of listeners) cb();
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      wakers.delete(done);
      resolve();
    }
    wakers.add(done);
  });
const wakeAll = () => [...wakers].forEach((w) => w());

const onInput = () => (lastInput = Date.now());
const onVisible = () => {
  if (document.visibilityState !== "visible") return;
  if (state.turbo) void lockScreen();
  wakeAll();
};

/** Bildschirm wach halten (geht nur, solange die App sichtbar ist; iOS gibt ihn im Hintergrund frei). */
async function lockScreen() {
  try {
    if (!wakeLock || wakeLock.released) wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    wakeLock = null;
  }
}
function releaseScreen() {
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}

/** „Schnell lernen“ ein/aus. */
export function setTurbo(on: boolean) {
  set({ turbo: on });
  if (on) void lockScreen();
  else releaseScreen();
  wakeAll();
}

/** Warten, bis die App sichtbar ist und (ausser bei „Schnell lernen“) gerade nicht bedient wird. */
async function waitForQuiet(stopped: () => boolean) {
  for (;;) {
    if (stopped()) return;
    if (document.visibilityState !== "visible") {
      set({ phase: "paused" });
      await sleep(60_000);
      continue;
    }
    if (state.turbo) return;
    const idle = Date.now() - lastInput;
    if (idle >= QUIET_MS) return;
    await sleep(QUIET_MS - idle + 50);
  }
}

/** Nächste Portion: Fotos aus demselben Ordner (ein Aufruf für alle Vorschaubilder). */
function nextChunk(todo: Item[]): Item[] {
  const first = todo[0];
  const chunk: Item[] = [];
  for (let i = 0; i < todo.length && chunk.length < CHUNK; ) {
    const it = todo[i];
    if (it.account_id === first.account_id && it.parent_drive_id === first.parent_drive_id) {
      chunk.push(it);
      todo.splice(i, 1);
    } else i++;
  }
  return chunk;
}

/** Tempo über die letzten ~60 Fotos messen (Pausen zählen nicht mit). */
function rateMeter() {
  const times: number[] = [];
  return {
    tick() {
      times.push(performance.now());
      if (times.length > 60) times.shift();
      if (times.length >= 5) set({ rate: (times.length - 1) / ((times[times.length - 1] - times[0]) / 1000) });
    },
    reset: () => (times.length = 0),
  };
}

async function pass(stopped: () => boolean): Promise<void> {
  const items = await catalog(true);
  const [have, skips] = await Promise.all([vectorKeys(), skipped()]);

  // Gelöschte Fotos aus dem Index entfernen
  await removeKeys([...have, ...skips.keys()].filter((k) => !items.has(k)));

  const now = Date.now();
  const todo = [...items.values()]
    .filter((it) => {
      const k = itemKey(it);
      if (have.has(k)) return false;
      const s = skips.get(k);
      return !s || now - s > RETRY_SKIP_MS;
    })
    // Neueste zuerst – die sucht man am ehesten
    .sort((a, b) => (b.taken_at ?? "").localeCompare(a.taken_at ?? ""));

  const indexed = [...have].filter((k) => items.has(k)).length;
  set({ total: indexed + todo.length, done: indexed, error: null });
  if (!todo.length) return;

  set({ phase: "model" });
  await prepareVision(state.turbo ? MAX_WORKERS : 1);

  let done = indexed;
  const meter = rateMeter();
  const retried = new Set<string>(); // nach einem Absturz einmal neu versuchen statt gleich überspringen
  const queue: { chunk: Item[]; blobs: Promise<Map<string, Blob>> }[] = [];
  // Vorschaubilder im Voraus laden (bei „Schnell lernen“ zwei Portionen), damit nie aufs Netz gewartet wird
  const refill = () => {
    while (todo.length && queue.length < (state.turbo ? 2 : 1)) {
      const chunk = nextChunk(todo);
      const blobs = thumbsFor(chunk);
      blobs.catch(() => undefined); // Fehler wird beim Abholen behandelt
      queue.push({ chunk, blobs });
    }
  };

  refill();
  while (queue.length && !stopped()) {
    await waitForQuiet(stopped);
    if (stopped()) break;
    set({ phase: "indexing" });

    // Normal: ein Worker. Schnell lernen: alles, was das Gerät hergibt.
    await prepareVision(state.turbo ? MAX_WORKERS : 1);
    const { device, workers } = visionInfo();
    set({ device, workers });
    const gpu = device === "webgpu";
    // Grafikchip bei „Schnell lernen“: zwei Spuren, damit Bilder lesen und Rechnen sich überlappen
    const lanes = state.turbo ? (gpu ? 2 : workers) : 1;
    const batch = gpu ? (state.turbo ? 8 : 4) : 1;

    const { chunk, blobs: pendingBlobs } = queue.shift()!;
    let blobs: Map<string, Blob>;
    try {
      blobs = await pendingBlobs;
    } catch {
      // Netz weg o. ä. → später nochmals
      todo.push(...chunk);
      meter.reset();
      await sleep(30_000);
      refill();
      continue;
    }
    refill();

    // Fotos in kleinen Stapeln auf die Spuren verteilen
    let i = 0;
    const lane = async () => {
      while (i < chunk.length && !stopped()) {
        const part = chunk.slice(i, i + batch);
        i += part.length;
        const keys = part.map(itemKey);
        const withBlob = keys.filter((k) => blobs.has(k));
        let vecs: (Float32Array | null)[] = [];
        let failed = false;
        try {
          vecs = withBlob.length ? await embedImages(withBlob.map((k) => blobs.get(k)!)) : [];
        } catch {
          failed = true;
        }
        for (const [n, k] of keys.entries()) {
          const j = withBlob.indexOf(k);
          if (failed && j >= 0 && !retried.has(k)) {
            retried.add(k);
            todo.push(part[n]);
            continue;
          }
          const v = j >= 0 ? vecs[j] : null;
          await (v ? putVector(k, v) : markSkip(k));
          done++;
          meter.tick();
        }
        if (failed) refill();
        set({ done });
        const before = performance.now();
        await waitForQuiet(stopped);
        if (performance.now() - before > 1000) meter.reset(); // Pause verfälscht sonst das Tempo
      }
    };
    await Promise.all(Array.from({ length: lanes }, lane));
  }
}

/** Startet den Hintergrund-Index (mehrfacher Aufruf ist harmlos). */
export function startIndexer() {
  if (active && active === generation) return;
  const mine = ++generation;
  active = mine;
  const stopped = () => generation !== mine;
  window.addEventListener("pointerdown", onInput, { passive: true });
  window.addEventListener("scroll", onInput, { passive: true, capture: true });
  window.addEventListener("touchmove", onInput, { passive: true });
  document.addEventListener("visibilitychange", onVisible);
  set({ phase: "start", error: null, rate: 0 });

  void (async () => {
    while (!stopped()) {
      try {
        await pass(stopped);
        if (!stopped()) {
          set({ phase: "done", rate: 0 });
          if (state.turbo) setTurbo(false); // fertig → Bildschirm darf wieder ausgehen
        }
      } catch (e) {
        if (!stopped()) set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
      }
      if (!stopped()) await sleep(RECHECK_MS); // neue Fotos? (beim Öffnen der App sofort)
    }
  })();
}

export function stopIndexer() {
  generation++;
  active = 0;
  wakeAll();
  releaseScreen();
  window.removeEventListener("pointerdown", onInput);
  window.removeEventListener("scroll", onInput, { capture: true });
  window.removeEventListener("touchmove", onInput);
  document.removeEventListener("visibilitychange", onVisible);
  shutdown();
  set({ phase: "off", turbo: false, rate: 0 });
}
