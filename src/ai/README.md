# KI-Suche (Test)

Fotos per Beschreibung finden („Hund im Schnee“, „Arbeitsblatt mit Tabelle“) – **komplett auf dem Gerät**.

## So funktioniert's

| Schritt | Wo |
|---|---|
| Einschalten: *Mehr → Suche → KI-Suche* | `AiSettings.tsx`, Schalter in `flag.ts` (localStorage) |
| Modell einmalig laden (~160 MB, danach im Gerätespeicher) | `worker.ts` – CLIP ViT-B/32 (`protocol.ts`); Suchbegriffe DE→EN per Wörterbuch (`dict.ts`) |
| Bildmodell auf dem Prozessor (q8); ein Bild-Worker und ein Such-Worker, nie gleichzeitig (Speicher) | `engine.ts`, Absturz-Merker `guard.ts` |
| Nebenbei jedes Foto in einen Vektor umrechnen, solange die App offen ist – normal sparsam mit Pausen, „Schnell lernen“ ohne Pausen (Bildschirm bleibt an); immer nur ein Bild-Worker, während der Suche entladen – auf dem iPhone teilen sich App und Worker den Speicher | `indexer.ts`, Vorschaubilder über `catalog.ts` |
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
