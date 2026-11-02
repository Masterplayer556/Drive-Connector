# Einrichtung – Drive Pool

Diese Schritte machst du einmal. Alles, was mit ✅ markiert ist, ist schon erledigt.

| Schritt | Wo | Status |
|---|---|---|
| Supabase-Projekt „Drive Pool“ (Zürich) | Supabase | ✅ |
| Datenbank-Schema | Supabase | ✅ |
| Edge Functions (5 Stück) | Supabase | ✅ |
| 1. Login-Nutzer anlegen | Supabase | ⬜ |
| 2. Google-Cloud-Projekt + OAuth-Client | Google Cloud | ⬜ |
| 3. Google-Schlüssel in Supabase eintragen | Supabase | ⬜ |
| 4. GitHub: Standard-Branch + Pages | GitHub | ⬜ |
| 5. App aufs iPhone + Konten verbinden | iPhone | ⬜ |

---

## 1. Login-Nutzer anlegen (Supabase)

1. Öffne https://supabase.com/dashboard/project/ijexpqxsbmuxwqibgpdr/auth/users
2. **Add user → Create new user**
3. E-Mail und ein starkes Passwort eingeben, **Auto Confirm User** anhaken → **Create user**
4. Danach Registrierungen sperren, damit niemand sonst ein Konto anlegen kann:
   https://supabase.com/dashboard/project/ijexpqxsbmuxwqibgpdr/auth/providers → **Allow new users to sign up** ausschalten → **Save**

> Der erste Nutzer, der sich in der App anmeldet, wird automatisch zum einzigen Besitzer.

---

## 2. Google-Cloud-Projekt und OAuth-Client

1. Öffne https://console.cloud.google.com/ und melde dich mit einem deiner Google-Konten an.
2. Oben links auf die Projektauswahl → **Neues Projekt** → Name `Drive Pool` → **Erstellen**. Danach das Projekt auswählen.
3. **Google Drive API aktivieren:** https://console.cloud.google.com/apis/library/drive.googleapis.com → **Aktivieren**
4. **Google Auth Platform** öffnen (https://console.cloud.google.com/auth/overview) → **Jetzt starten**
   - App-Name: `Drive Pool`
   - Nutzer-Support-E-Mail: deine Adresse
   - Zielgruppe: **Extern**
   - Kontakt-E-Mail: deine Adresse → zustimmen → **Erstellen**
5. **Zielgruppe** (Audience) → **App veröffentlichen** → bestätigen.
   Der Status muss **„In Produktion“** sein.
   ⚠️ Wichtig: Im Status „Test“ laufen die Zugriffe nach 7 Tagen ab und du müsstest jede Woche alle Konten neu verbinden.
   Eine Überprüfung durch Google ist **nicht** nötig – die App bleibt „nicht überprüft“, das ist für eine private App okay.
6. **Clients** → **Client erstellen**
   - Anwendungstyp: **Webanwendung**
   - Name: `Drive Pool`
   - **Autorisierte Weiterleitungs-URIs** → URI hinzufügen:
     ```
     https://ijexpqxsbmuxwqibgpdr.supabase.co/functions/v1/google-callback
     ```
   - **Erstellen**
7. Es erscheinen **Client-ID** und **Clientschlüssel** (Client Secret). Beide kopieren – du brauchst sie im nächsten Schritt.
   (Den Clientschlüssel zeigt Google nur einmal an. Falls verpasst: beim Client einen neuen Schlüssel hinzufügen.)

---

## 3. Google-Schlüssel in Supabase eintragen

1. Öffne https://supabase.com/dashboard/project/ijexpqxsbmuxwqibgpdr/functions/secrets
2. Zwei Secrets hinzufügen:

| Name | Wert |
|---|---|
| `GOOGLE_CLIENT_ID` | die Client-ID aus Schritt 2.7 |
| `GOOGLE_CLIENT_SECRET` | der Clientschlüssel aus Schritt 2.7 |

3. **Save**

---

## 4. GitHub: Standard-Branch und Pages

1. https://github.com/Masterplayer556/Drive-Connector/settings → **Default branch** → auf `main` umstellen (⇄-Symbol) → bestätigen.
2. https://github.com/Masterplayer556/Drive-Connector/settings/pages → **Source: GitHub Actions** (falls noch nicht gesetzt).
3. Den Pull Request mit Phase 1 mergen. GitHub baut die App danach automatisch und stellt sie online unter:
   **https://masterplayer556.github.io/Drive-Connector/**
   (Fortschritt: Reiter **Actions** im Repo, dauert ca. 1–2 Minuten.)

---

## 5. App aufs iPhone und Konten verbinden

1. Öffne **https://masterplayer556.github.io/Drive-Connector/** in **Safari**.
2. **Teilen** → **Zum Home-Bildschirm** → **Hinzufügen**. Ab jetzt die App über das Symbol öffnen.
3. Mit E-Mail und Passwort aus Schritt 1 anmelden.
4. **Konten → ＋ Konto verbinden** → Google-Konto wählen.
   - Google zeigt **„Google hat diese App nicht überprüft“** → **Erweitert** → **Weiter zu Drive Pool (unsicher)**.
   - Beim Zugriff auf Google Drive das **Häkchen setzen** → **Weiter**.
   - Du landest wieder in der App, das Konto wird eingelesen.
5. Für jedes weitere Konto wiederholen. Beim Privat-Konto oben rechts **Privat** wählen.
6. **Mehr → Einrichtung:** bestehende Ordner „Schule“ oder „Privat“ zuordnen → **Übernehmen**.
7. Empfohlen: **Mehr → 2FA einrichten** (z. B. mit der Passwörter-App des iPhones).

---

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| „Google-Zugangsdaten fehlen“ | Schritt 3 prüfen (Namen exakt so schreiben). |
| „redirect_uri_mismatch“ bei Google | Die Weiterleitungs-URI in Schritt 2.6 muss exakt stimmen. |
| „Zugriff blockiert“ statt „nicht überprüft“ | In der Google Auth Platform unter **Zielgruppe** prüfen, dass die App veröffentlicht ist. Notlösung: Status „Test“ und deine 4 Konten als Testnutzer eintragen (dann alle 7 Tage neu verbinden). |
| „Google hat keinen dauerhaften Zugriff geliefert“ | Unter https://myaccount.google.com/connections „Drive Pool“ entfernen und erneut verbinden. |
| Konto zeigt „bitte neu verbinden“ | In der App unter **Konten → Neu verbinden**. |
| Vorschaubilder fehlen | **⋯ → Synchronisieren**; Google erstellt Vorschauen manchmal erst nach einigen Minuten. |
| Supabase pausiert | Kostenlose Projekte pausieren nach 7 Tagen ohne Nutzung. Im Dashboard auf **Restore** tippen. |
