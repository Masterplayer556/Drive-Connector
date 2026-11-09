-- Neuer Bereich „Claude“: abgeschottet wie Privat (Konten mit dieser Rolle nehmen nur Claude-Ordner auf).
alter table public.accounts drop constraint if exists accounts_role_check;
alter table public.accounts add constraint accounts_role_check check (role in ('schule', 'privat', 'claude'));
