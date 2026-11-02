# Drive Pool

Private PWA, die mehrere Google-Drive-Konten zu einem einzigen Drive zusammenfasst.

- **Konzept & Regelwerk:** [KONZEPT.md](KONZEPT.md)
- **Einrichtung (Google, Supabase, iPhone):** [SETUP.md](SETUP.md)
- **App:** https://masterplayer556.github.io/Drive-Connector/ (nach dem ersten Deploy von `main`)

## Aufbau

| Teil | Ort |
|---|---|
| Frontend (React + Vite, PWA) | `src/` |
| Logik mit Tests (Namen, Upload-Plan, Kontowahl) | `src/lib/*.ts`, `src/lib/*.test.ts` |
| Datenbank-Schema | `supabase/migrations/` |
| Edge Functions (OAuth, Tokens, Sync, Vorschau) | `supabase/functions/` |
| Automatisches Deployment auf GitHub Pages | `.github/workflows/deploy.yml` |

## Entwickeln

```bash
npm install
npm run dev     # lokal starten
npm test        # Tests
npm run build   # Produktions-Build nach dist/
```
