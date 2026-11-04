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
  /**
   * Lernt nur auf einem Lern-Gerät (PC, per Knopf) und teilt die Fingerabdrücke über Supabase.
   * Andere Geräte (iPhone) laden sie nur herunter – das Bildmodell ist für sie zu gross.
   */
  cloud: boolean;
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
    cloud: false,
  },
  // Apple MobileCLIP-S2 (2024) – laut Apple deutlich treffsicherer. Bildteil ungerundet (fp32) = genau;
  // dafür ist er dem iPhone zu gross → gelernt wird am PC, das iPhone lädt nur die Fingerabdrücke
  mobileclip: {
    id: "mobileclip",
    label: "MobileCLIP-S2 (Test)",
    repo: "Xenova/mobileclip_s2",
    db: "drivepool-ai-mobileclip-s2",
    version: "Xenova/mobileclip_s2@fp32",
    visionDtype: "fp32",
    textDtype: "q8",
    padMax: true,
    cloud: true,
  },
};

export type ToWorker =
  /** gpu: Bildmodell auf der Grafikkarte rechnen (WebGPU, nur Lern-Gerät) */
  | { type: "warm"; id: number; model: ModelId; part: "bild" | "text"; gpu?: boolean }
  | { type: "images"; id: number; model: ModelId; blobs: Blob[]; gpu?: boolean }
  /** Gruppen von Formulierungen; je Gruppe ein gemittelter Vektor (Gruppe 0 = ganze Suche) */
  | { type: "text"; id: number; model: ModelId; groups: string[][] };

export type FromWorker =
  | { type: "progress"; part: "bild" | "text"; file: string; loaded: number; total: number }
  | { type: "ok"; id: number; device?: "webgpu" | "wasm" }
  | { type: "vecs"; id: number; vecs: (Float32Array | null)[] }
  | { type: "vec"; id: number; vecs: Float32Array[] }
  | { type: "error"; id: number; message: string };
