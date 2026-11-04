// KI-SUCHE (Test): unsichtbar – läuft nur, solange die KI-Suche an ist und die App entsperrt ist.
import { useEffect } from "react";
import { useAiModel, useTestFolders } from "./flag";
import { startIndexer, stopIndexer } from "./indexer";

export default function AiIndexer() {
  // Anderes Modell oder andere Testordner → Worker beenden und neu starten
  const model = useAiModel();
  const folders = useTestFolders();
  const key = model === "mobileclip" ? `${model}|${folders.join("|")}` : model;
  useEffect(() => {
    startIndexer();
    return stopIndexer;
  }, [key]);
  return null;
}
