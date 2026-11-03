// KI-SUCHE (Test): Modelle und Nachrichten zwischen App und Worker.

/** Bild-Text-Modell (OpenAI CLIP ViT-B/32, als ONNX für den Browser). */
export const CLIP_MODEL = "Xenova/clip-vit-base-patch32";
/** Übersetzer Deutsch → Englisch für die Suchanfrage. */
export const MT_MODEL = "Xenova/opus-mt-de-en";
/**
 * Ändert sich das Modell, muss der Index neu aufgebaut werden.
 * (q8 auf dem Prozessor und fp16 auf dem Grafikchip sind Varianten desselben Modells → gleicher Index.)
 */
export const INDEX_VERSION = `${CLIP_MODEL}@q8`;

/** Womit das Bildmodell rechnet. */
export type VisionDevice = "webgpu" | "wasm";

export type ToWorker =
  | { type: "warm"; id: number; part: "bild"; device: VisionDevice }
  | { type: "warm"; id: number; part: "text" }
  | { type: "images"; id: number; blobs: Blob[] }
  | { type: "text"; id: number; text: string; translate: boolean };

export type FromWorker =
  | { type: "progress"; part: "bild" | "text"; file: string; loaded: number; total: number }
  | { type: "ok"; id: number }
  | { type: "vecs"; id: number; vecs: (Float32Array | null)[] }
  | { type: "vec"; id: number; vec: Float32Array; english?: string }
  | { type: "error"; id: number; message: string };
