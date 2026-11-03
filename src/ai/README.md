# KI-Suche (Test)

Fotos per Beschreibung finden („Hund im Schnee“, „Arbeitsblatt mit Tabelle“) – **komplett auf dem Gerät**.

## So funktioniert's

| Schritt | Wo |
|---|---|
| Einschalten: *Mehr → Suche → KI-Suche* | `AiSettings.tsx`, Schalter in `flag.ts` (localStorage) |
| Modelle einmalig laden (~250–350 MB, danach im Gerätespeicher) | `worker.ts` – CLIP ViT-B/32 + Übersetzer DE→EN (`protocol.ts`) |
| Bildmodell auf dem Grafikchip (WebGPU, fp16) – klappt das nicht, auf dem Prozessor (q8) | `engine.ts` (`prepareVision`, merkt sich einen Fehlschlag in `drivepool.ai.gpu`) |
| Nebenbei jedes Foto in einen Vektor umrechnen, solange die App offen ist – normal sparsam mit Pausen, „Schnell lernen“ mit allem (Grafikchip in Stapeln oder bis zu 3 Prozessor-Worker, Bildschirm bleibt an) | `indexer.ts`, Vorschaubilder über `catalog.ts` |
| Index speichern – nur in IndexedDB auf dem Gerät | `store.ts` |
| Suchtext → Vektor → ähnlichste Fotos | `search.ts`, `rank.ts`, Anzeige `AiSearchResults.tsx` |

Übers Netz gehen nur: die Modelldateien von Hugging Face (einmalig, nur Download) und die Vorschaubilder
wie bisher über die eigene `thumb`-Function. Keine Fotos und keine Suchanfragen an einen KI-Dienst.
Die ONNX-Laufzeit (`ort-wasm…wasm`) wird mit der App ausgeliefert, nicht vom CDN geladen.
Im Hintergrund (App verlassen, Bildschirm aus) friert iOS Web-Apps ein – gelernt wird nur bei offener App.

## Entfernen

1. **Auf dem iPhone zuerst ausschalten:** *Mehr → KI-Suche* aus → „Ausschalten & löschen“.
   Löscht Modelle, Index und Schalter vom Gerät.
2. **Code entfernen** – am einfachsten den Merge-Commit der KI-Suche zurücknehmen (`git revert`).
   Von Hand:
   - Ordner `src/ai/` löschen
   - alle Stellen mit `KI-SUCHE` entfernen: `src/App.tsx`, `src/components/SearchSheet.tsx`,
     `src/views/MehrView.tsx`, `vite.config.ts` (`worker: { format: "es" }`)
   - `npm uninstall @huggingface/transformers`
