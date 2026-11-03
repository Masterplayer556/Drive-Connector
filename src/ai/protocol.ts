// KI-SUCHE (Test): Modelle und Nachrichten zwischen App und Worker.

/** Bild-Text-Modell (OpenAI CLIP ViT-B/32, als ONNX für den Browser). */
export const CLIP_MODEL = "Xenova/clip-vit-base-patch32";
/** Übersetzer Deutsch → Englisch für die Suchanfrage. */
export const MT_MODEL = "Xenova/opus-mt-de-en";
/** Ändert sich das Modell, muss der Index neu aufgebaut werden. */
export const INDEX_VERSION = `${CLIP_MODEL}@q8`;

export type ToWorker =
  | { type: "warm"; id: number; part: "bild" | "text" }
  | { type: "image"; id: number; blob: Blob }
  | { type: "text"; id: number; text: string };

export type FromWorker =
  | { type: "progress"; part: "bild" | "text"; file: string; loaded: number; total: number }
  | { type: "ok"; id: number }
  | { type: "vec"; id: number; vec: Float32Array; english?: string }
  | { type: "error"; id: number; message: string };
