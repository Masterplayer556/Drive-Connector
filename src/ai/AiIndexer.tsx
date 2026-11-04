// KI-SUCHE: unsichtbar – läuft nur, solange die KI-Suche an ist und die App entsperrt ist.
import { useEffect } from "react";
import { useAiModel, useLearningDevice } from "./flag";
import { startIndexer, stopIndexer } from "./indexer";
import { MODELS } from "./protocol";

export default function AiIndexer() {
  // Anderes Modell oder anderes Lern-Gerät → Worker beenden und neu starten
  const model = useAiModel();
  const learner = useLearningDevice();
  const key = MODELS[model].cloud ? `${model}|${learner}` : model;
  useEffect(() => {
    startIndexer();
    return stopIndexer;
  }, [key]);
  return null;
}
