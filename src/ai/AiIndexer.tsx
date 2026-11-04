// KI-SUCHE (Test): unsichtbar – läuft nur, solange die KI-Suche an ist und die App entsperrt ist.
import { useEffect } from "react";
import { useAiModel, useLearningDevice, useTestFolders, useTestOnly } from "./flag";
import { startIndexer, stopIndexer } from "./indexer";
import { MODELS } from "./protocol";

export default function AiIndexer() {
  // Anderes Modell oder andere Testordner → Worker beenden und neu starten
  const model = useAiModel();
  const folders = useTestFolders();
  const only = useTestOnly();
  const learner = useLearningDevice();
  const key = MODELS[model].cloud ? `${model}|${only}|${learner}|${folders.join("|")}` : model;
  useEffect(() => {
    startIndexer();
    return stopIndexer;
  }, [key]);
  return null;
}
