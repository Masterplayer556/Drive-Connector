# KI-Suche (Test)

Fotos per Beschreibung finden („Hund im Schnee“, „Arbeitsblatt mit Tabelle“) – **komplett auf dem Gerät**.

## So funktioniert's

| Schritt | Wo |
|---|---|
| Einschalten: *Mehr → Suche → KI-Suche* | `AiSettings.tsx`, Schalter in `flag.ts` (localStorage) |
| Modelle einmalig laden (~250 MB, danach im Gerätespeicher) | `worker.ts` – CLIP ViT-B/32 + Übersetzer DE→EN (`protocol.ts`) |
| Nebenbei jedes Foto in einen Vektor umrechnen, solange die App offen ist (Pause bei Bedienung/Hintergrund) | `indexer.ts`, Vorschaubilder über `catalog.ts` |
| Index speichern – nur in IndexedDB auf dem Gerät | `store.ts` |
| Suchtext → Vektor → ähnlichste Fotos | `search.ts`, `rank.ts`, Anzeige `AiSearchResults.tsx` |

Übers Netz gehen nur: die Modelldateien von Hugging Face (einmalig, nur Download) und die Vorschaubilder
wie bisher über die eigene `thumb`-Function. Keine Fotos und keine Suchanfragen an einen KI-Dienst.
Die ONNX-Laufzeit (`ort-wasm…wasm`) wird mit der App ausgeliefert, nicht vom CDN geladen.

## Entfernen

1. **Auf dem iPhone zuerst ausschalten:** *Mehr → KI-Suche* aus → „Ausschalten & löschen“.
   Löscht Modelle, Index und Schalter vom Gerät.
2. **Code entfernen** – am einfachsten den Merge-Commit der KI-Suche zurücknehmen (`git revert`).
   Von Hand:
   - Ordner `src/ai/` löschen
   - alle Stellen mit `KI-SUCHE` entfernen: `src/App.tsx`, `src/components/SearchSheet.tsx`,
     `src/views/MehrView.tsx`, `vite.config.ts` (`worker: { format: "es" }`)
   - `npm uninstall @huggingface/transformers`
