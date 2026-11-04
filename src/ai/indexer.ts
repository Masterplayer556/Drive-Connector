// KI-SUCHE: baut den Index nebenbei auf, solange die App offen ist.
// Portionsweise (ein Ordner, max. 30 Fotos). Normal: Pause bei Bedienung. „Schnell lernen“: keine Pausen,
// Bildschirm bleibt an. Im Hintergrund friert iOS Web-Apps ein – dann geht es beim nächsten Öffnen weiter.
import type { Item } from "../lib/types";
import { catalog, thumbsFor } from "./catalog";
import { aiModel, learningDevice } from "./flag";
import { fetchKeys, syncDown, uploadVectors } from "./cloud";
import { MODELS } from "./protocol";
import { crashedDuring, embedImage, embedImages, prepareVision, releaseIdleVision, releaseTextLater, setSearching, shutdown, textAlive } from "./engine";
import { itemKey, markSkip, putVector, putVectors, removeKeys, skipped, vectorKeys } from "./store";

export type Phase =
  | "start"
  | "model"
  | "indexing"
  | "done"
  | "paused"
  | "searching"
  | "held"
  | "syncing" // holt Fingerabdrücke vom PC
  | "cloud" // iPhone: wartet, bis der PC lernt
  | "ready" // PC: neue Fotos da, wartet auf den Knopf
  | "error"
  | "off";

export interface IndexState {
  phase: Phase;
  done: number;
  total: number;
  error: string | null;
  /** Fotos pro Sekunde (gleitender Schnitt), 0 = noch unbekannt */
  rate: number;
  /** „Schnell lernen“ aktiv */
  turbo: boolean;
}

const CHUNK = 30;
/** Fotos ohne Vorschau nochmals versuchen: nach 10 min, 1 h, 6 h, 36 h, dann wöchentlich (frisch hochgeladen → Google braucht etwas). */
const retryAfter = (n: number) => Math.min(7 * 24 * 3600_000, 10 * 60_000 * 6 ** Math.max(0, n - 1));
const RECHECK_MS = 10 * 60_000;
const QUIET_MS = 1500; // so lange nach dem letzten Tippen/Scrollen warten

let state: IndexState = { phase: "off", done: 0, total: 0, error: null, rate: 0, turbo: false };
const listeners = new Set<() => void>();
// Jeder Start bekommt eine neue Nummer; ein alter Durchlauf merkt so, dass er aufhören muss.
let generation = 0;
let active = 0;
const wakers = new Set<() => void>();
let lastInput = 0;
let wakeLock: WakeLockSentinel | null = null;
let searchOpen = 0;

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
/** Nach einem Sync (z. B. nach einem Upload) neue Fotos gleich lernen statt erst beim nächsten Durchgang.
 *  Kurz warten: Google braucht nach dem Hochladen einen Moment für die Vorschaubilder. */
let syncTimer: ReturnType<typeof setTimeout> | null = null;
const onSynced = () => {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    pendingRecheck = true;
    wakeAll();
  }, 20_000);
};
let pendingRecheck = false;
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

// Nach einem Absturz beim Lernen nicht gleich wieder loslegen (sonst stürzt die App immer wieder ab)
let held = crashedDuring() === "learn";

/** Nach einem Absturz angehalten? */
export const learningHeld = () => held;

// Lern-Gerät (PC) bei einem Cloud-Modell: lernt nur nach Knopfdruck
let cloudRun = false;

/** PC: „Neue Fotos lernen“ – lernt alle noch fehlenden Fotos und lädt die Fingerabdrücke hoch. */
export function startCloudLearning() {
  cloudRun = true;
  held = false;
  pendingRecheck = true;
  wakeAll();
}

/** PC: Lernen anhalten (Gelerntes bleibt). */
export function stopCloudLearning() {
  cloudRun = false;
  wakeAll();
}

export const cloudLearning = () => cloudRun;

/** Nach einem Absturz bewusst weiterlernen. */
export function resumeLearning() {
  held = false;
  wakeAll();
}

/** „Schnell lernen“ ein/aus. */
export function setTurbo(on: boolean) {
  if (on) held = false; // bewusst gestartet
  set({ turbo: on });
  if (on) void lockScreen();
  else releaseScreen();
  wakeAll();
}

/** Suchfenster offen/zu: solange gesucht wird, pausiert das Lernen und gibt seinen Speicher frei. */
export function searchOpened() {
  searchOpen++;
  setSearching(true);
}
export function searchClosed() {
  searchOpen = Math.max(0, searchOpen - 1);
  if (searchOpen) return;
  setSearching(false);
  releaseTextLater(0); // Suchmodell sofort entladen, bevor das Bildmodell wieder lädt
  wakeAll();
}

/** Warten, bis die App sichtbar ist, nicht gesucht und (ausser bei „Schnell lernen“) gerade nicht bedient wird. */
async function waitForQuiet(stopped: () => boolean) {
  for (;;) {
    if (stopped()) return;
    if (searchOpen || textAlive()) {
      set({ phase: "searching" });
      releaseIdleVision();
      await sleep(400);
      continue;
    }
    // PC (Knopf gedrückt): auch im Hintergrund-Tab weiterlernen
    if (cloudRun) return;
    if (document.visibilityState !== "visible") {
      set({ phase: "paused" });
      await sleep(60_000);
      continue;
    }
    if (held) {
      releaseIdleVision();
      if (state.phase !== "held") set({ phase: "held", rate: 0 });
      await sleep(2000);
      continue;
    }
    if (state.turbo || cloudRun) return;
    if (MODELS[aiModel()].cloud) return; // PC ohne Knopf / iPhone: der Durchgang bricht danach ab
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
  // Zeitpunkte mit Anzahl Fotos (bei Paketen mehrere auf einmal)
  const marks: { t: number; n: number }[] = [];
  return {
    tick(n = 1) {
      marks.push({ t: performance.now(), n });
      while (marks.length > 2 && marks.reduce((s, m) => s + m.n, 0) - marks[0].n > 60) marks.shift();
      const span = (marks[marks.length - 1].t - marks[0].t) / 1000;
      const count = marks.slice(1).reduce((s, m) => s + m.n, 0);
      if (marks.length >= 3 && span > 0) set({ rate: count / span });
    },
    reset: () => (marks.length = 0),
  };
}

/** Am PC (Cloud-Modell) so viele Fotos auf einmal durchs Modell schicken. */
const BATCH = 16;

/** Ein Durchgang. "wait" = es gäbe noch zu lernen, aber nicht hier/jetzt (Cloud-Modell). */
async function pass(stopped: () => boolean): Promise<"done" | "wait"> {
  const spec = MODELS[aiModel()];
  const items = await catalog(true);
  // Cloud-Modell: zuerst holen, was der PC schon gelernt hat
  if (spec.cloud) {
    set({ phase: "syncing" });
    try {
      await syncDown(spec.id);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  let [have, skips] = await Promise.all([vectorKeys(), skipped()]);

  // iPhone: fehlt trotz Abgleich noch etwas, gezielt genau diese Fotos holen (falls der PC sie schon hat)
  if (spec.cloud && !learningDevice()) {
    const missing = [...items.keys()].filter((k) => !have.has(k) && !skips.has(k));
    if (missing.length && missing.length <= 3000) {
      try {
        if (await fetchKeys(spec.id, missing)) [have, skips] = await Promise.all([vectorKeys(), skipped()]);
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // Gelöschte Fotos aus dem Index entfernen
  await removeKeys([...have, ...skips.keys()].filter((k) => !items.has(k)));

  const now = Date.now();
  const todo = [...items.values()]
    .filter((it) => {
      const k = itemKey(it);
      if (have.has(k)) return false;
      const s = skips.get(k);
      // Geräte, die beim Cloud-Modell nur herunterladen: vom PC als nicht lernbar gemeldet = erledigt
      if (s && spec.cloud && !learningDevice()) return false;
      return !s || now - s.at > retryAfter(s.n);
    })
    // Neueste zuerst – die sucht man am ehesten
    .sort((a, b) => (b.taken_at ?? "").localeCompare(a.taken_at ?? ""));

  const indexed = [...have].filter((k) => items.has(k)).length;
  set({ total: indexed + todo.length, done: indexed, error: null });
  if (!todo.length) {
    cloudRun = false;
    return "done";
  }
  if (spec.cloud && !learningDevice()) {
    set({ phase: "cloud", rate: 0 }); // iPhone: lernt das grosse Modell nicht selbst
    return "wait";
  }
  if (spec.cloud && !cloudRun) {
    set({ phase: "ready", rate: 0 }); // PC: wartet auf „Neue Fotos lernen“
    return "wait";
  }
  // Am PC Gelerntes laufend hochladen
  const upload: [string, Float32Array | null][] = [];
  const flush = async (force = false) => {
    if (!spec.cloud || !upload.length || (!force && upload.length < 50)) return;
    const part = upload.splice(0, upload.length);
    try {
      await uploadVectors(spec.version, part);
    } catch (e) {
      upload.unshift(...part); // später nochmals
      set({ error: `Hochladen: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  // Erst laden, wenn gelernt werden darf (z. B. nicht nach einem Absturz)
  await waitForQuiet(stopped);
  if (stopped() || (spec.cloud && !cloudRun)) return "wait";
  set({ phase: "model" });
  await prepareVision();

  let done = indexed;
  const meter = rateMeter();
  const retried = new Set<string>(); // nach einem Abbruch einmal neu versuchen statt gleich überspringen
  const queue: { chunk: Item[]; blobs: Promise<Map<string, Blob>> }[] = [];
  // Vorschaubilder im Voraus laden (bei „Schnell lernen“ zwei Portionen), damit nie aufs Netz gewartet wird
  const refill = () => {
    while (todo.length && queue.length < (cloudRun ? 3 : state.turbo ? 2 : 1)) {
      const chunk = nextChunk(todo);
      const blobs = thumbsFor(chunk);
      blobs.catch(() => undefined); // Fehler wird beim Abholen behandelt
      queue.push({ chunk, blobs });
    }
  };

  refill();
  while (queue.length && !stopped()) {
    await waitForQuiet(stopped);
    if (stopped() || (spec.cloud && !cloudRun)) break; // PC: „Anhalten“ gedrückt
    set({ phase: "indexing" });

    await prepareVision(); // nach einer Suche wurde das Bildmodell entladen → neu laden

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

    // PC (Cloud-Modell): in Paketen lernen – viel schneller, vor allem auf der Grafikkarte
    if (spec.cloud && cloudRun) {
      for (let i = 0; i < chunk.length && !stopped() && cloudRun; i += BATCH) {
        const part = chunk.slice(i, i + BATCH);
        const withBlob = part.filter((it) => blobs.has(itemKey(it)));
        let vecs: (Float32Array | null)[] = [];
        try {
          vecs = withBlob.length ? await embedImages(withBlob.map((it) => blobs.get(itemKey(it))!)) : [];
        } catch {
          // Paket hängt (Zeitlimit) oder Worker beendet → einzeln versuchen: so hält ein kaputtes Foto
          // nicht alles auf. Was auch allein nicht geht, wird übersprungen und später nochmals versucht.
          vecs = [];
          for (const it of withBlob) {
            if (stopped() || !cloudRun) break;
            try {
              await prepareVision();
              vecs.push((await embedImages([blobs.get(itemKey(it))!]))[0] ?? null);
            } catch {
              vecs.push(null);
            }
          }
          if (vecs.length < withBlob.length) {
            todo.push(...part); // angehalten → Paket bleibt für später
            break;
          }
        }
        const got = new Map(withBlob.map((it, j) => [itemKey(it), vecs[j] ?? null]));
        const learned: [string, Float32Array][] = [];
        for (const it of part) {
          const k = itemKey(it);
          const v = got.get(k) ?? null;
          if (v) learned.push([k, v]);
          else await markSkip(k);
          upload.push([k, v]); // auch „nicht lernbar“ melden
        }
        await putVectors(learned);
        done += part.length;
        meter.tick(part.length);
        set({ done });
        await flush();
      }
      continue;
    }

    for (const it of chunk) {
      if (stopped()) break;
      const k = itemKey(it);
      const blob = blobs.get(k);
      let vec: Float32Array | null = null;
      if (blob) {
        try {
          vec = await embedImage(blob);
        } catch {
          // Worker beendet (z. B. Suche geöffnet) → Foto einmal neu einreihen statt überspringen
          if (!retried.has(k)) {
            retried.add(k);
            todo.push(it);
            refill();
            continue;
          }
        }
      }
      await (vec ? putVector(k, vec) : markSkip(k));
      if (spec.cloud) {
        upload.push([k, vec]); // auch „nicht lernbar“ melden, sonst warten andere Geräte ewig darauf
        await flush();
      }
      done++;
      meter.tick();
      set({ done });
      const before = performance.now();
      await waitForQuiet(stopped);
      if (performance.now() - before > 1000) meter.reset(); // Pause verfälscht sonst das Tempo
      if (stopped() || (spec.cloud && !cloudRun)) break;
      await prepareVision();
    }
  }
  await flush(true);
  if (stopped()) return "wait";
  if (queue.length || todo.length || (spec.cloud && !cloudRun)) {
    set({ phase: "ready", rate: 0 }); // angehalten, Rest bleibt für später
    return "wait";
  }
  cloudRun = false; // alles gelernt
  return "done";
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
  window.addEventListener("drivepool-synced", onSynced);
  set({ phase: "start", error: null, rate: 0 });

  void (async () => {
    while (!stopped()) {
      try {
        const result = await pass(stopped);
        if (!stopped() && result === "done") {
          set({ phase: "done", rate: 0 });
          if (state.turbo) setTurbo(false); // fertig → Bildschirm darf wieder ausgehen
        }
      } catch (e) {
        if (!stopped()) set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
      }
      // Neue Fotos? Nach einem Sync sofort, sonst alle 10 Minuten (beim Öffnen der App ebenfalls sofort)
      if (!stopped() && !pendingRecheck) await sleep(RECHECK_MS);
      pendingRecheck = false;
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
  window.removeEventListener("drivepool-synced", onSynced);
  if (syncTimer) clearTimeout(syncTimer);
  shutdown();
  set({ phase: "off", turbo: false, rate: 0 });
}
