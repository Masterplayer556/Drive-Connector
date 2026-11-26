-- Funktionen nicht für alle freigeben (Postgres gibt EXECUTE standardmässig an PUBLIC):
-- - mark_plan_purged: ruft nur die App als angemeldeter Besitzer auf → anon und PUBLIC weg, authenticated bleibt
-- - check_cron_secret: ruft nur die Edge Function „nightly“ als service_role auf (pg_cron ruft die Funktion per
--   HTTP auf, nicht diese SQL-Funktion) → nur noch service_role
revoke execute on function public.mark_plan_purged(uuid) from public, anon;
grant execute on function public.mark_plan_purged(uuid) to authenticated;

revoke execute on function public.check_cron_secret(text) from public, anon, authenticated;
grant execute on function public.check_cron_secret(text) to service_role;
