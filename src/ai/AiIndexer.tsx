// KI-SUCHE (Test): unsichtbar – läuft nur, solange die KI-Suche an ist und die App entsperrt ist.
import { useEffect } from "react";
import { startIndexer, stopIndexer } from "./indexer";

export default function AiIndexer() {
  useEffect(() => {
    startIndexer();
    return stopIndexer;
  }, []);
  return null;
}
