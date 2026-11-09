# Hinweise für Claude Code

## Supabase: nichts selbst ändern

Änderungen am Supabase-Projekt (`ijexpqxsbmuxwqibgpdr`) macht der Besitzer selbst. Claude führt sie
**nicht** über die Supabase-Tools aus, sondern gibt ihm alles, was er dafür braucht:

- **SQL / Migrationen** (Tabellen anlegen, ändern, löschen, Daten ändern):
  Link zum SQL-Editor `https://supabase.com/dashboard/project/ijexpqxsbmuxwqibgpdr/sql/new`
  und das fertige SQL zum Einfügen. Die Migration trotzdem unter `supabase/migrations/` ins Repo legen.
- **Edge Functions** (bereitstellen, löschen): Link `https://supabase.com/dashboard/project/ijexpqxsbmuxwqibgpdr/functions`
  und die genauen Schritte bzw. den Befehl (`supabase functions deploy <name>`).
- **Secrets / Einstellungen**: Link zur passenden Dashboard-Seite und was genau einzutragen ist.

Nur lesen (Tabellen ansehen, Logs, Liste der Functions) ist in Ordnung.
