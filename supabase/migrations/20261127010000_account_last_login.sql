-- Google löscht Konten nach 2 Jahren Inaktivität. Ob Zugriffe der App über die Drive-Schnittstelle als
-- Aktivität zählen, ist unklar – darum merkt sich die App, wann der Nutzer zuletzt selbst direkt bei Google
-- eingeloggt war („Heute eingeloggt“ in der Konto-Ansicht), und erinnert rechtzeitig daran.
-- Leer = seit dem Verbinden (created_at, das Verbinden war ein Login) nicht bestätigt.
alter table public.accounts add column if not exists last_login_at timestamptz;
grant update (last_login_at) on public.accounts to authenticated;
