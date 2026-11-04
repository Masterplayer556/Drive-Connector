// KI-SUCHE (Test): läuft in einem eigenen Thread, damit die App beim Rechnen flüssig bleibt.
// Alles passiert auf dem Gerät. Übers Netz kommen nur die Modelldateien (einmalig, danach im Gerätespeicher).
import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  env,
  RawImage,
} from "@huggingface/transformers";
import { MODELS, type FromWorker, type ModelId, type ModelSpec, type ToWorker } from "./protocol";

env.allowLocalModels = false;
const onnx = env.backends.onnx as { wasm?: { numThreads?: number; wasmPaths?: unknown } };
if (onnx.wasm) {
  // GitHub Pages erlaubt kein Multithreading (fehlende COOP/COEP-Header) → ein Thread pro Worker;
  // für mehr Tempo laufen stattdessen mehrere Worker parallel
  onnx.wasm.numThreads = 1;
  // Laufzeit nicht vom CDN holen, sondern die mit der App ausgelieferte Datei nehmen
  delete onnx.wasm.wasmPaths;
}

const ctx = self as unknown as {
  postMessage(m: FromWorker): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

type Fn = (...args: unknown[]) => Promise<Record<string, { data: Float32Array; dims: number[] }>>;

const progress = (part: "bild" | "text") => (p: { status: string; file?: string; loaded?: number; total?: number }) => {
  if (p.status === "progress" && p.file) {
    ctx.postMessage({ type: "progress", part, file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
  }
};

// Weniger Arbeitsspeicher auf dem Prozessor: kein vorab reservierter Speicherblock, keine Vorausplanung
// (etwas langsamer, aber auf dem iPhone teilen sich App und alle Worker denselben Speicher)
const LEAN = { enableCpuMemArena: false, enableMemPattern: false };

// Pro Worker immer nur ein Modell; beim Umschalten beendet die App die Worker
let vision: Promise<{ processor: Fn; model: Fn }> | null = null;
// Textmodelle je Modell (im Vergleichsmodus werden beide gebraucht)
const texts = new Map<string, Promise<{ tokenizer: (t: string[], o: object) => unknown; model: Fn; spec: ModelSpec }>>();

function normalized(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** Zeilen aus einem [n, 512]-Ergebnis. */
function rows(t: { data: Float32Array; dims: number[] }): Float32Array[] {
  const d = t.dims[t.dims.length - 1];
  const out: Float32Array[] = [];
  for (let i = 0; i < t.data.length / d; i++) out.push(normalized(t.data.subarray(i * d, (i + 1) * d)));
  return out;
}

function loadVision(spec: ModelSpec) {
  vision ??= (async () => {
    const [processor, model] = await Promise.all([
      AutoProcessor.from_pretrained(spec.repo, { progress_callback: progress("bild") }),
      CLIPVisionModelWithProjection.from_pretrained(spec.repo, {
        device: "wasm",
        dtype: spec.visionDtype,
        progress_callback: progress("bild"),
        session_options: LEAN,
      }),
    ]);
    return { processor: processor as unknown as Fn, model: model as unknown as Fn };
  })().catch((e) => {
    vision = null;
    throw e;
  });
  return vision;
}

function loadText(spec: ModelSpec) {
  let p = texts.get(spec.repo);
  if (p) return p;
  p = (async () => {
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(spec.repo, { progress_callback: progress("text") }),
      CLIPTextModelWithProjection.from_pretrained(spec.repo, {
        device: "wasm",
        dtype: spec.textDtype,
        progress_callback: progress("text"),
        session_options: LEAN,
      }),
    ]);
    return { tokenizer: tokenizer as unknown as (t: string[], o: object) => unknown, model: model as unknown as Fn, spec };
  })().catch((e) => {
    texts.delete(spec.repo);
    throw e;
  });
  texts.set(spec.repo, p);
  return p;
}

/** Bilder → Vektoren (null = Bild nicht lesbar). */
async function embedImages(blobs: Blob[]): Promise<(Float32Array | null)[]> {
  if (!vision) throw new Error("Bildmodell nicht geladen");
  const { processor, model } = await vision;
  const images = await Promise.all(blobs.map((b) => RawImage.fromBlob(b).catch(() => null)));
  const ok = images.map((img, i) => (img ? i : -1)).filter((i) => i >= 0);
  const out: (Float32Array | null)[] = blobs.map(() => null);
  if (!ok.length) return out;
  const { image_embeds } = await model(await processor(ok.map((i) => images[i])));
  rows(image_embeds).forEach((v, j) => (out[ok[j]] = v));
  return out;
}

/**
 * Gruppen von Formulierungen (prompts.ts) → je Gruppe ein Vektor: Mittel aller Formulierungen.
 * Alles in einem Durchgang durchs Textmodell.
 */
async function embedGroups(spec: ModelSpec, groups: string[][]): Promise<Float32Array[]> {
  const { tokenizer, model } = await loadText(spec);
  const flat = groups.flat();
  const { text_embeds } = await model(tokenizer(flat, { padding: spec.padMax ? "max_length" : true, truncation: true }));
  const all = rows(text_embeds);
  const out: Float32Array[] = [];
  let i = 0;
  for (const g of groups) {
    const mean = new Float32Array(all[0].length);
    for (const v of all.slice(i, i + g.length)) for (let j = 0; j < mean.length; j++) mean[j] += v[j];
    out.push(normalized(mean));
    i += g.length;
  }
  return out;
}

ctx.onmessage = async (e) => {
  const m = e.data;
  try {
    const spec = MODELS[m.model as ModelId] ?? MODELS.clip;
    if (m.type === "warm") {
      await (m.part === "bild" ? loadVision(spec) : loadText(spec));
      ctx.postMessage({ type: "ok", id: m.id });
    } else if (m.type === "images") {
      await loadVision(spec);
      ctx.postMessage({ type: "vecs", id: m.id, vecs: await embedImages(m.blobs) });
    } else if (m.type === "text") {
      ctx.postMessage({ type: "vec", id: m.id, vecs: await embedGroups(spec, m.groups) });
    }
  } catch (err) {
    ctx.postMessage({ type: "error", id: m.id, message: err instanceof Error ? err.message : String(err) });
  }
};
