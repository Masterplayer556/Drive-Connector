// KI-SUCHE (Test): Modelle und Nachrichten zwischen App und Worker.

export type ModelId = "clip" | "mobileclip";

export interface ModelSpec {
  id: ModelId;
  label: string;
  /** Modell auf Hugging Face (ONNX für den Browser) */
  repo: string;
  /** Eigene Datenbank pro Modell – die Fingerabdrücke verschiedener Modelle passen nicht zusammen */
  db: string;
  /** Ändert sich das, muss der Index neu aufgebaut werden */
  version: string;
  visionDtype: "q8" | "fp32";
  textDtype: "q8" | "fp32";
  /** Text immer auf volle Länge auffüllen (MobileCLIP erwartet das) */
  padMax: boolean;
}

export const MODELS: Record<ModelId, ModelSpec> = {
  // OpenAI CLIP ViT-B/32 (2021)
  clip: {
    id: "clip",
    label: "Standard (CLIP)",
    repo: "Xenova/clip-vit-base-patch32",
    db: "drivepool-ai",
    version: "Xenova/clip-vit-base-patch32@q8",
    visionDtype: "q8",
    textDtype: "q8",
    padMax: false,
  },
  // Apple MobileCLIP-S2 (2024) – kleiner, laut Apple deutlich treffsicherer. Bildteil gerundet (q8):
  // ungerundet (fp32) stürzte das iPhone beim Lernen nach einer Weile ab (Arbeitsspeicher)
  mobileclip: {
    id: "mobileclip",
    label: "MobileCLIP-S2 (Test)",
    repo: "Xenova/mobileclip_s2",
    db: "drivepool-ai-mobileclip-s2",
    version: "Xenova/mobileclip_s2@q8",
    visionDtype: "q8",
    textDtype: "q8",
    padMax: true,
  },
};

export type ToWorker =
  | { type: "warm"; id: number; model: ModelId; part: "bild" | "text" }
  | { type: "images"; id: number; model: ModelId; blobs: Blob[] }
  /** Gruppen von Formulierungen; je Gruppe ein gemittelter Vektor (Gruppe 0 = ganze Suche) */
  | { type: "text"; id: number; model: ModelId; groups: string[][] };

export type FromWorker =
  | { type: "progress"; part: "bild" | "text"; file: string; loaded: number; total: number }
  | { type: "ok"; id: number }
  | { type: "vecs"; id: number; vecs: (Float32Array | null)[] }
  | { type: "vec"; id: number; vecs: Float32Array[] }
  | { type: "error"; id: number; message: string };
