// KI-SUCHE (Test): baut den Index nebenbei auf, solange die App offen ist.
// Portionsweise (ein Ordner, max. 30 Fotos), Pause bei Bedienung oder wenn die App im Hintergrund ist.
import type { Item } from "../lib/types";
import { catalog, thumbsFor } from "./catalog";
import { embedImage, shutdown, warm } from "./engine";
import { itemKey, markSkip, putVector, removeKeys, skipped, vectorKeys } from "./store";

export type Phase = "start" | "model" | "indexing" | "done" | "paused" | "error" | "off";

export interface IndexState {
  phase: Phase;
  done: number;
  total: number;
  error: string | null;
}

const CHUNK = 30;
const RETRY_SKIP_MS = 7 * 24 * 3600_000; // Fotos ohne Vorschau nach einer Woche nochmals versuchen
const RECHECK_MS = 10 * 60_000;
const QUIET_MS = 1500; // so lange nach dem letzten Tippen/Scrollen warten

let state: IndexState = { phase: "off", done: 0, total: 0, error: null };
const listeners = new Set<() => void>();
// Jeder Start bekommt eine neue Nummer; ein alter Durchlauf merkt so, dass er aufhören muss.
let generation = 0;
let active = 0;
let wake: (() => void) | null = null;
let lastInput = 0;

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
      wake = null;
      resolve();
    }
    wake = done;
  });

const onInput = () => (lastInput = Date.now());
const onVisible = () => document.visibilityState === "visible" && wake?.();

/** Warten, bis die App sichtbar ist und gerade nicht bedient wird. */
async function waitForQuiet(stopped: () => boolean) {
  for (;;) {
    if (stopped()) return;
    if (document.visibilityState !== "visible") {
      set({ phase: "paused" });
      await sleep(60_000);
      continue;
    }
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
  const total = indexed + todo.length;
  set({ total, done: indexed, error: null });
  if (!todo.length) return;

  set({ phase: "model" });
  await warm("bild");

  let done = indexed;
  while (todo.length && !stopped()) {
    await waitForQuiet(stopped);
    if (stopped()) break;
    set({ phase: "indexing" });
    const chunk = nextChunk(todo);
    let blobs: Map<string, Blob>;
    try {
      blobs = await thumbsFor(chunk);
    } catch {
      // Netz weg o. ä. → später nochmals
      todo.push(...chunk);
      await sleep(30_000);
      continue;
    }
    for (const it of chunk) {
      if (stopped()) break;
      const k = itemKey(it);
      const blob = blobs.get(k);
      try {
        if (!blob) throw new Error("keine Vorschau");
        await putVector(k, await embedImage(blob));
      } catch {
        await markSkip(k);
      }
      done++;
      set({ done });
      await waitForQuiet(stopped);
    }
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
  set({ phase: "start", error: null });

  void (async () => {
    while (!stopped()) {
      try {
        await pass(stopped);
        if (!stopped()) set({ phase: "done" });
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
  wake?.();
  window.removeEventListener("pointerdown", onInput);
  window.removeEventListener("scroll", onInput, { capture: true });
  window.removeEventListener("touchmove", onInput);
  document.removeEventListener("visibilitychange", onVisible);
  shutdown();
  set({ phase: "off" });
}
