# Drive Pool – Konzept

Private Web-App (PWA) für das iPhone, die mehrere Google-Drive-Konten zu **einem einzigen Drive** zusammenfasst.
Die Dateien bleiben in den einzelnen Google-Konten gespeichert – die App ist nur die „Brille“ darüber.

- Nutzer: **nur ich** (private App, keine weiteren Nutzer)
- Gerät: **iPhone 13** (Safari / PWA auf dem Home-Bildschirm)
- Inhalt: **ausschliesslich Fotos** (wird sich nicht ändern)
- Läuft komplett in der Cloud, ohne PC

---

## 1. Grundprinzip

### Ein Drive im Frontend, freier Speicherort im Backend

| Ebene | Verhalten |
|---|---|
| **Frontend (was ich sehe)** | Eine einzige Ordnerstruktur, als wäre alles in einem Drive. Ganz oben: `Privat/` und `Archiv/`. |
| **Backend (wo es liegt)** | Egal. Ein Ordner kann in einem Konto liegen oder auf mehrere Konten verteilt sein. |
| **Fix** | Ein Foto bleibt immer in dem Ordner, dem es zugeteilt wurde. Die App ändert nur das *Konto*, nie den *Ordner*. |

### Zusammenführen über den Pfad

Ordner mit demselben Pfad in verschiedenen Konten gelten als **ein** Ordner.

```
Konto A:  Archiv/Mathe/   1.png … 40.png    ┐
Konto B:  Archiv/Mathe/   41.png … 60.png   ┴─►  Frontend:  Archiv/Mathe/   1.png … 60.png
```

- Wird ein Ordner in einem Konto ohne seinen Elternordner angelegt, erstellt die App den Pfad dort automatisch (leere Hilfsordner, 0 Byte).
- Ordnernamen werden ohne Rücksicht auf Gross-/Kleinschreibung zusammengeführt (`Fotos` = `fotos`).
- Dateien eines Ordners werden über alle Konten hinweg **gemeinsam natürlich sortiert** (`2.png` vor `10.png`).
- Kein Lock-in: In der normalen Google-Drive-App zeigt jedes Konto dieselbe Ordnerstruktur, nur unvollständig.
- Das Verschieben einer Datei in einen anderen Ordner passiert immer **innerhalb desselben Kontos** (Zielpfad wird bei Bedarf angelegt) – kein Kopieren nötig.

### Ausgangslage der Konten

| Konto | Inhalt heute | Rolle |
|---|---|---|
| 1 | Grosser Ordner mit vielen Unterordnern | Archiv |
| 2 | ca. 6 freistehende Ordner | Archiv |
| 3 | 2 Ordner ohne Unterordner | Archiv |
| 4 | 6 Ordner ohne Unterordner | **Privat-Konto** (Fotos landen bevorzugt hier) |

4 × 15 GB = **60 GB**. Google Fotos belegt überall 0 GB.
**Privat ist ein abgeschottetes Gebiet:** Nichts kommt hinein oder heraus. Privat-Ordner liegen nur in Konten, die als Privat markiert sind, und ziehen nur zwischen diesen um. Archiv-Ordner bleiben ebenso in Archiv-Konten. Auch Verschieben (Fotos oder Ordner) zwischen `Privat/` und dem Rest ist gesperrt.

**Einmalige Einrichtung:** Ein Assistent fragt für jeden bestehenden Ordner „Archiv oder Privat?“ und verschiebt ihn innerhalb seines Kontos unter `Archiv/` bzw. `Privat/` (kein Kopieren, kein Umbenennen).

---

## 2. Regelwerk

> Hinweis: Der Bereich „Schule“ wurde in „Archiv“ umbenannt.

### Regel 1 – Ein Drive im Frontend
Ordner verschiedener Konten werden über den Pfad zusammengeführt. Oberste Ebene: `Privat/` und `Archiv/`.

### Regel 2 – Dateien bleiben in ihrem Ordner, kein automatisches Umbenennen
- Die App benennt **nie von sich aus** um. Ausnahmen sind nur Regel 11, 12 und 14.
- Beim Verschieben zwischen Konten bleibt der Name 1:1 erhalten.
- **Namenskonflikt** (z. B. zweites `1.png` im selben Ordner): Die App hängt nichts an, sondern stoppt und fragt nach – „überspringen“ oder „mit `Foto_Datum`-Namen hochladen“.

### Regel 3 – Platzierung neuer Fotos
- Ein neues Foto landet im Konto, in dem sein Ordner bereits liegt.
- Ist das Konto voll, verteilt die App **automatisch** auf ein anderes Konto **desselben Gebiets** (Privat nur auf Privat-Konten, Archiv nur auf Archiv-Konten):
  - Ordner mit Unterordnern: Aufteilung entlang der Unterordner.
  - Ordner ohne Unterordner: zweite „Hälfte“ desselben Ordners in einem anderen Konto.
- Neue Ordner werden dort angelegt, wo ihre Fotos landen werden.

### Regel 4 – Ordner ohne Unterordner ab 15 GB
Erreicht ein Ordner **ohne Unterordner** 15 GB oder mehr, macht die App nichts:
der **Upload wird blockiert** und ich erhalte eine **Push-Nachricht**. Ich löse das Problem selbst.

### Regel 5 – Gruppenregel für den grossen Archivordner
Nur für diesen einen Ordner: Seine Unterordner werden nach Anfangsbuchstaben in Gruppen geteilt (z. B. **A–M** / **N–Z**).
Jede Gruppe ist eine Einheit und liegt möglichst komplett in einem Konto. Neue Unterordner gehen in ihre Buchstabengruppe.

### Regel 6 – Rebalancing (nur Vorschläge)
- Die App erstellt **Pläne**, z. B. „`Archiv/Reisen/` von Konto 2 nach Konto 3 → 4,2 GB frei“. Ich tippe auf **Ausführen** oder **Ablehnen**.
- Einheit = ein Ordner mit seinen direkten Dateien (Unterordner sind eigene Einheiten).
- Nie über die Grenze von Privat: Privat-Ordner nur zwischen Privat-Konten, alles andere nur zwischen Archiv-Konten (auch der Server prüft das beim Ausführen).
- Ziel: möglichst viele Einheiten ganz in einem Konto, möglichst grosse freie Blöcke.
- Ablauf beim Verschieben (ohne dass eine Datei geöffnet wird):
  1. Konto A gibt den Ordner intern für Konto B frei.
  2. Konto B erstellt eine **serverseitige Kopie** bei Google (Daten laufen nicht über Backend oder Handy).
  3. Vergleich von **MD5-Prüfsumme und Grösse**.
  4. Erst bei Übereinstimmung wird das Original in den **Papierkorb** des Quellkontos gelegt; Google löscht es dort nach **30 Tagen endgültig** (so lange zurückholbar – der Platz wird erst dann frei).
- Läuft nachts als Job in Teilschritten (Warteschlange).
- Wird ein neues Konto verbunden, erstellt die App sofort einen Rebalancing-Vorschlag.
- Nebenwirkung: Kopien erhalten neue Google-IDs, alte Teilen-Links verfallen.

### Regel 7 – Ordner sperren
Ordner können gesperrt werden. Gesperrte Ordner werden **nie** verschoben oder aufgeteilt und erscheinen in keinem Rebalancing-Vorschlag.

### Regel 8 – Foto-Upload
- Upload über die **PWA** (Foto-Auswahl von iOS), direkt vom Handy zu Google.
- Automatische Ablage nach Aufnahmedatum in `Privat/Fotos/JJJJ/MM/`, bevorzugt ins Privat-Konto.
  Ist das Privat-Konto voll, gehen neue Monatsordner in ein anderes **Privat**-Konto (im Frontend bleibt alles unter `Privat/Fotos/`). Gibt es keines mit Platz, wird der Upload gestoppt.
- Beim normalen Upload ist der aktuelle Ordner vorgewählt; das Ziel lässt sich antippen und frei wählen (auch ein neuer Ordner).
- Fehlt das Aufnahmedatum, wird das Upload-Datum verwendet.
- Safari darf HEIC in JPEG umwandeln; Live Photos sind nicht wichtig.
- Upload nur im Vordergrund; die App hält den Bildschirm währenddessen wach.
- Nach einem Abbruch: einfach erneut auswählen, bereits hochgeladene Fotos werden per Duplikat-Prüfung übersprungen.
- Upload über die Google-Drive-App bleibt möglich; solche Fotos erscheinen automatisch im Pool.

### Regel 9 – Duplikate
- Erkennung über **MD5-Prüfsumme + Grösse** (von Google geliefert, keine Datei wird geöffnet).
- **Vor jedem Upload** wird geprüft, ob das Foto schon im Pool ist → wird übersprungen.
- Duplikat-Liste mit Vorschaubildern nebeneinander (einzige „Ansehen“-Ausnahme), ich entscheide, welche Kopie bleibt.

### Regel 10 – Speicher und Warnungen
- Jedes Konto wird bis **100 %** gefüllt. Gmail und Google Fotos müssen nicht funktionieren.
- Wiederherstellungs-E-Mail/-Telefon jedes Kontos liegt **ausserhalb** des Pools.
- Papierkorb wird automatisch nach X Tagen geleert (gelöschte Dateien belegen sonst weiter Speicher).
- Push-Nachrichten:
  - Pool zu 80 / 90 / 95 % voll
  - Prognose: „Bei deinem Upload-Tempo ist der Pool in ca. X Wochen voll – Zeit für ein neues Konto.“
  - Ordner ohne Unterordner ≥ 15 GB (Regel 4)
  - Konto nicht mehr erreichbar (Zugriff entzogen, Passwort geändert)
  - Bericht nach ausgeführtem Rebalancing
- Anzeige: Gesamtspeicher, Balken pro Konto, Füllstand pro Hauptordner (`Archiv` / `Privat`).

### Regel 11 – Reihenfolge-Upload (optional)
- Schalter **„Reihenfolge festlegen“** beim Upload.
- Fotos werden in der gewünschten Reihenfolge angetippt (Badges ① ② ③) oder per Drag & Drop sortiert.
- Die App sucht die **höchste reine Zahl** im Zielordner (über alle Konten-Hälften) und zählt weiter, **ohne führende Nullen**: `0080.png` → `81.png`, `82.png` …
- Ohne nummerierte Dateien im Ordner: Start bei `1`.
- Dateiendung bleibt erhalten. Originalname wird in der Google-Beschreibung der Datei gespeichert.
- Nummern werden vor dem Upload reserviert → bei Abbruch keine Lücken, Wiederholung bekommt denselben Namen.
- Vorschau der neuen Namen vor dem Hochladen.

### Regel 12 – Sortieren-Knopf (bestehende Dateien)
1. Dateien im Ordner markieren → **Sortieren**.
2. Mini-Menü mit Vorschaubildern, Reihenfolge per Drag & Drop festlegen.
3. Die App sucht die höchste reine Zahl im Ordner (die gerade markierten Dateien zählen nicht mit) und zählt weiter, ohne führende Nullen.
4. Vorschau („`IMG_4821.jpg` → `81.jpg`“), Umbenennen erst nach Bestätigung.
5. Originalname wird in der Beschreibung gespeichert, Eintrag im Protokoll.

### Regel 13 – Massen-Download
| Weg | Wofür | Grenze |
|---|---|---|
| Teilen-Menü → „X Bilder sichern“ | Fotos direkt in die Fotos-App | Pakete von ca. 30–50 Fotos bzw. ~300 MB, automatisch aufgeteilt |
| Teilen-Menü → „In Dateien sichern“ | Fotos in die Dateien-App | gleiche Paketgrösse |
| ZIP | Ganze Ordner inkl. Unterordner | ca. 1 GB pro ZIP, grössere Ordner in mehreren Teilen |

Dateinamen und Ordnerstruktur bleiben erhalten, auch bei Ordnern, die auf mehrere Konten verteilt sind.
Ein einzelner Riesen-Download (z. B. 10 GB auf einmal) ist auf dem iPhone nicht möglich.

### Regel 14 – Zahlen-Schutz beim Upload
- Upload über die App, Reihenfolge-Schalter **aus**, Name ist eine **reine Zahl** (`0001.png`, `5.png`):
  → automatische Umbenennung in `Foto_JJJJ-MM-TT_HH-MM-SS.ext` (bei Gleichstand mit Zähler) + Protokolleintrag.
  Namen mit Buchstaben am Anfang stehen in der Sortierung immer nach allen Zahlen.
- Reihenfolge-Schalter **an**: Foto bekommt ohnehin die nächste Nummer.
- Normaler Name (`IMG_4821.png`): bleibt unverändert.
- Fotos, die über die **Google-Drive-App** hochgeladen wurden und einen reinen Zahlennamen haben:
  nur **Hinweis mit Umbenennen-Knopf**, keine automatische Umbenennung.

### Regel 15 – Nur Fotos
- Standardansicht ist eine **Galerie** mit Vorschaubildern (von Google geliefert).
- Upload ausschliesslich über die Foto-Auswahl.
- Ein einzelnes Foto ist nie zu gross für ein Konto.
- Grössenordnung: ca. 2–4 MB pro Foto → 60 GB ≈ 15'000–25'000 Fotos.

### Protokoll
Die App führt ein einsehbares Protokoll (filterbar) über Uploads, Umbenennungen, Löschungen, Rebalancing und Fehler, jeweils mit Datum.

---

## 3. Technik

```
 iPhone (PWA)  ──►  Supabase (Cloud)                    ──►  Google Drive API
                     ├─ Auth (nur mein Account, 2FA)           ├─ Konto 1
                     ├─ Postgres (Konten, Index, Protokoll)    ├─ Konto 2
                     ├─ Edge Functions (OAuth, API-Proxy)      ├─ Konto 3
                     └─ pg_cron (Sync, Rebalancing, Warnungen) └─ Konto 4 (Privat)
```

| Teil | Wahl |
|---|---|
| Frontend | PWA (z. B. React oder Svelte), gehostet auf Vercel / Netlify / Cloudflare Pages |
| Backend | **Supabase** (bereits verbunden): Auth, Postgres, Edge Functions, pg_cron |
| App-Login | Supabase Auth, nur ein erlaubter Nutzer, 2FA |
| Google-Zugriff | Eigenes Google-Cloud-Projekt, OAuth mit vollem Drive-Scope, **Status „In Production“** (unverifiziert, da nur für mich) |
| Tokens | Ein Refresh-Token pro Konto, **verschlüsselt** in Postgres |
| Datei-Index | Metadaten aller Dateien in Postgres, aktuell gehalten über die **Drive Changes API** |
| Upload | Backend startet Upload-Session bei Google, Handy lädt direkt zu Google hoch |
| Push | Web Push für PWAs auf dem Home-Bildschirm (iOS 16.4+) |
| Kosten | ~0 CHF (Gratis-Stufen), optional eigene Domain |

### Grobes Datenmodell
- `accounts` – Google-Konto, Rolle (Archiv/Privat; intern `schule` = Archiv), Token (verschlüsselt), Quota, Status
- `files` – Google-ID, Konto, logischer Pfad, Name, Grösse, MD5, Aufnahmedatum, Originalname
- `folders` – logischer Pfad, Konto(en), gesperrt ja/nein, Gruppenregel
- `rebalance_plans` – Vorschläge mit Schritten und Status
- `number_reservations` – reservierte Nummern pro Ordner (Regel 11)
- `log` – Protokoll
- `settings` – Papierkorb-Frist, Warnschwellen usw.

---

## 4. Grenzen und Risiken

| Thema | Einschätzung |
|---|---|
| OAuth „Testing“-Modus | Refresh-Tokens laufen nach 7 Tagen ab → Projekt muss auf **„In Production“** stehen. |
| Unverifizierte App | Beim Verbinden einmalig Warnung „Google hat diese App nicht überprüft“ – wegklicken. |
| Upload im Hintergrund | iOS pausiert PWA-Uploads im Hintergrund → Upload im Vordergrund, Bildschirm wach halten. |
| Geteilte Ordner umbenennen/löschen | Muss in allen Konten passieren → Schritte werden protokolliert, unvollständige Änderungen automatisch repariert. |
| Teilen-Links nach Rebalancing | Kopien haben neue IDs, alte Links verfallen. |
| Supabase Gratis-Stufe | Projekt pausiert nach 7 Tagen ohne Nutzung → regelmässig nutzen oder Ping. |
| Inaktive Google-Konten | Google löscht Konten nach 2 Jahren Inaktivität → ab und zu direkt einloggen (App erinnert daran). |
| Massen-Download | Nur in Paketen bzw. ZIPs bis ca. 1 GB. |
| Sicherheit | Backend hat Vollzugriff auf alle Drives → Tokens verschlüsselt, 2FA, nur ein Nutzer. |
| Nutzungsbedingungen | Mehrere Gratiskonten bündeln ist nicht ausdrücklich verboten, aber nicht so gedacht. Risiko privat gering. |

---

## 5. Phasen

1. **MVP** ✅ umgesetzt (Einrichtung siehe [SETUP.md](SETUP.md))
   - Google-Cloud-Projekt + Supabase einrichten
   - Konten verbinden, Gesamtspeicher anzeigen
   - Einrichtungs-Assistent (`Archiv/` / `Privat/`)
   - Zusammengeführte Ordneransicht (Galerie), Ordner erstellen, löschen
   - Foto-Upload mit Duplikat-Prüfung, Zahlen-Schutz, Reihenfolge-Upload
   - Protokoll
2. **Warnungen & Ablage**
   - Push-Nachrichten, Prognose, Regel 4
   - Automatische Ablage `Privat/Fotos/JJJJ/MM/`
   - Sortieren-Knopf
3. **Rebalancing**
   - Vorschläge mit Ausführen-Knopf, Gruppenregel, Ordner sperren
   - Automatisches Leeren des Papierkorbs
4. **Komfort**
   - Duplikat-Ansicht, Massen-Download, Regal-Ansicht, Konto entfernen mit Umzug

### Testpunkte im MVP
- Bleibt das Aufnahmedatum beim Upload aus Safari erhalten?
- Funktioniert „Bildschirm wach halten“ in der installierten PWA?
- Welche Paketgrösse schafft „X Bilder sichern“ auf dem iPhone 13 zuverlässig?
