# KI-Suche (Beta)

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
| Menü im Suchfeld: mit KI oder nach Namen suchen (gemerkt); private Konten nur per Häkchen (nur KI-Suche, gilt bis zum Schliessen) | `SearchModeMenu.tsx`, Filter `privateAccounts` in `search.ts` |
| 👍/👎 bei Treffern (Knöpfe abschaltbar in den KI-Einstellungen, Standard: an – bisherige Bewertungen wirken immer): schiebt die Suche zu den gelobten Fotos, blendet abgelehnte aus – auch für ähnliche Suchen | `rank.ts` (`applyFeedback`), gespeichert in IndexedDB (`feedback`) |
| „Ähnliche Fotos“ (✨ in der Foto-Ansicht; private Fotos nur, wenn das Ausgangsfoto privat ist) | `SimilarSheet.tsx`, `search.ts` (`similarTo`) |
| „Fast gleiche Fotos“ in den Duplikaten (Serienbilder, bearbeitete Kopien) | `AiSimilarDuplicates.tsx`, `rank.ts` (`groupSimilar`) |
| Filter im Suchtext: „O: Ferien Strand“ (nur Ordner mit „Ferien“ im Namen, inkl. Unterordner; mit Leerzeichen: `O: "Ferien 2024"`), „Video Strand“ (nur Videos); nur Filter ohne Beschreibung → neueste zuerst | `query.ts`, `search.ts` |
| Suche ans Modell: mehrere Formulierungen gemittelt („a photo of …“, „a picture of …“ …) statt einer | `prompts.ts`, `worker.ts` |
| Stichwort-Suche („Hund Schnee Berg“): zusätzlich ein Vektor pro Stichwort – Fotos, auf denen alle zu sehen sind, kommen nach oben | `dict.ts` (`keywordsOf`), `rank.ts` (`keywords`) |
| Namen lernen („Luca“, „Pikachu“, eigene Figuren): aus 👍 bei Suchen mit dem Namen oder ✨ → „Wer ist das?“ in der Foto-Ansicht. Suche nach dem Namen = Fotos, die wie die gelobten aussehen; „Name + Beschreibung“ sortiert diese nach der Beschreibung. Am besten bei Figuren mit festem Aussehen – keine echte Gesichtserkennung. Liste/Vergessen in den KI-Einstellungen | `names.ts`, `NameTags.tsx`, `search.ts` (`giveName`, `removeName`, `allNames`), `dict.ts` (`nameRuns`) |
| Ordner: gedrückt halten → „KI: Name & passende Fotos“ – Ordner mit einem Namen verknüpfen (alle Fotos darin, auch spätere, zählen für die Suche nach dem Namen) und Fotos finden, die aussehen wie die im Ordner, aber woanders liegen (auswählen → hineinverschieben) | `FolderAiSheet.tsx`, `search.ts` (`linkFolderName`, `similarToFolder`), `names.ts` (`expandNameKeys`) |
| Synonyme: jede Suche zusätzlich mit Synonymen ans Modell (car → automobile, vehicle) | `prompts.ts` (`synonymVariants`) |
| „KI trainieren“ (KI-Einstellungen oder „Schneller trainieren“ bei den Treffern): Begriff, der oft auf deinen Fotos vorkommt (Stichprobe von 1500 Fotos, je Foto die 3 passendsten von ~600 Begriffen gezählt; Begriff-Vektoren und Zählung im Gerät zwischengespeichert) oder gelernter Name + Foto; rechts wischen = 👍, links = 👎. Abwechselnd sichere und unsichere Treffer | `TrainSheet.tsx`, `train.ts`, `search.ts` (`trainingTerms`, `trainingBatch`) |
| Eigene Tags helfen der KI: kommt ein Tag in der Suche vor (ohne #), zählen seine Fotos (auch in getaggten Ordnern) wie 👍 für diese Suche; Tags mit Namen wirken wie gelernte Namen | `search.ts` (`tagExamples`) |
| Englische Suchen werden erkannt (auch einzelne Wörter wie „dog“) und nicht übersetzt | `dict.ts` (`looksEnglish`) |
| Videos: gelernt wird das Vorschaubild (ein Standbild) – gesucht wird also, was darauf zu sehen ist | `catalog.ts` |
| Neue Fotos nach einem Sync/Upload gleich lernen | Ereignis `drivepool-synced` aus `syncAccounts` → `indexer.ts` |

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
     `src/components/Viewer.tsx`, `src/views/MehrView.tsx`, `src/views/DuplikateView.tsx`, `src/lib/db.ts`,
     `vite.config.ts` (`worker: { format: "es" }`)
   - `npm uninstall @huggingface/transformers`
