-- Drive Pool – Grundschema (Phase 1)
--
-- Tabellen:
--   app_owner            der einzige erlaubte Nutzer (wird beim ersten Aufruf gesetzt)
--   accounts             verbundene Google-Konten
--   account_secrets      verschlüsselte Google-Tokens (nur für Edge Functions lesbar)
--   items                Index aller Ordner und Fotos aus allen Konten
--   number_reservations  reservierte Nummern für den Reihenfolge-Upload (Regel 11)
--   activity_log         Protokoll

-- ---------------------------------------------------------------------------
-- Einzel-Nutzer-Sperre
-- ---------------------------------------------------------------------------
create table public.app_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_owner enable row level security;

-- MFA-Prüfung: Hat der Nutzer einen bestätigten TOTP-Faktor, muss die Sitzung aal2 sein.
create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;

-- Ist der aktuelle Nutzer der Besitzer der App (und MFA erfüllt)?
create or replace function public.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_owner o where o.user_id = auth.uid())
     and public.mfa_ok();
$$;

revoke all on function public.mfa_ok() from public, anon;
revoke all on function public.is_app_owner() from public, anon;
grant execute on function public.mfa_ok() to authenticated;
grant execute on function public.is_app_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- Konten
-- ---------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  google_sub text not null,
  email text not null,
  role text not null default 'schule' check (role in ('schule', 'privat')),
  root_folder_id text,
  quota_limit bigint,
  quota_usage bigint,
  quota_updated_at timestamptz,
  status text not null default 'active' check (status in ('active', 'error')),
  status_message text,
  changes_page_token text,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, google_sub)
);
alter table public.accounts enable row level security;

create policy accounts_select on public.accounts
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()));

-- Der Client darf nur die Rolle (Schule/Privat) ändern.
create policy accounts_update on public.accounts
  for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
  with check (owner_id = (select auth.uid()));
revoke update on public.accounts from authenticated;
grant update (role) on public.accounts to authenticated;

create table public.account_secrets (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  refresh_token_enc text not null,
  access_token_enc text,
  access_token_expires_at timestamptz
);
alter table public.account_secrets enable row level security;
revoke all on public.account_secrets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Index aller Ordner und Fotos
-- ---------------------------------------------------------------------------
create table public.items (
  account_id uuid not null references public.accounts (id) on delete cascade,
  drive_id text not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  is_folder boolean not null,
  mime_type text,
  parent_drive_id text,
  size bigint,
  md5 text,
  taken_at timestamptz,
  created_time timestamptz,
  modified_time timestamptz,
  description text,
  -- logischer Pfad dieses Eintrags, z. B. 'Schule/Mathe/1.png' (null = ausserhalb von "Meine Ablage")
  path text,
  -- Kleinbuchstaben-Pfad des Elternordners, '' = oberste Ebene
  parent_key text,
  primary key (account_id, drive_id)
);
alter table public.items enable row level security;

create index items_parent_key_idx on public.items (owner_id, parent_key);
create index items_md5_idx on public.items (owner_id, md5) where md5 is not null;
create index items_parent_drive_idx on public.items (account_id, parent_drive_id);
create index items_lower_path_idx on public.items (account_id, lower(path));

create policy items_select on public.items
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()));

-- Logische Pfade eines Kontos neu berechnen (nach jedem Sync).
create or replace function public.recompute_paths(p_account uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_root text;
begin
  select root_folder_id into v_root from public.accounts where id = p_account;

  update public.items set path = null, parent_key = null where account_id = p_account;

  if v_root is null then
    return;
  end if;

  with recursive t (drive_id, path, parent_path, depth) as (
    select i.drive_id, i.name, ''::text, 1
    from public.items i
    where i.account_id = p_account and i.parent_drive_id = v_root
    union all
    select i.drive_id, t.path || '/' || i.name, t.path, t.depth + 1
    from public.items i
    join t on i.parent_drive_id = t.drive_id
    where i.account_id = p_account and t.depth < 64
  )
  update public.items i
     set path = t.path,
         parent_key = lower(t.parent_path)
    from t
   where i.account_id = p_account and i.drive_id = t.drive_id;
end;
$$;
revoke all on function public.recompute_paths(uuid) from public, anon, authenticated;
grant execute on function public.recompute_paths(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Nummern-Reservierung (Regel 11)
-- ---------------------------------------------------------------------------
-- Gibt die Zahl zurück, wenn der Name (ohne Endung) eine reine Zahl ist, sonst null.
create or replace function public.pure_number(p_name text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when regexp_replace(p_name, '\.[^.]*$', '') ~ '^[0-9]{1,15}$'
      then regexp_replace(p_name, '\.[^.]*$', '')::numeric
  end;
$$;

create table public.number_reservations (
  owner_id uuid not null references auth.users (id) on delete cascade,
  folder_key text not null,
  number bigint not null,
  expires_at timestamptz not null default now() + interval '1 day',
  primary key (owner_id, folder_key, number)
);
alter table public.number_reservations enable row level security;
revoke all on public.number_reservations from anon, authenticated;

-- Reserviert p_count fortlaufende Nummern ab (höchste reine Zahl im Ordner + 1).
create or replace function public.reserve_numbers(p_folder_key text, p_count int)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_max numeric;
  v_res bigint;
  v_start bigint;
begin
  if v_uid is null or not public.is_app_owner() then
    raise exception 'nicht erlaubt';
  end if;
  if p_count < 1 or p_count > 5000 then
    raise exception 'ungültige Anzahl';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || p_folder_key));

  delete from public.number_reservations where expires_at < now();

  select max(public.pure_number(name)) into v_max
    from public.items
   where owner_id = v_uid and parent_key = p_folder_key and not is_folder;

  select max(number) into v_res
    from public.number_reservations
   where owner_id = v_uid and folder_key = p_folder_key;

  v_start := greatest(coalesce(v_max, 0)::bigint, coalesce(v_res, 0)) + 1;

  insert into public.number_reservations (owner_id, folder_key, number)
  select v_uid, p_folder_key, g
    from generate_series(v_start, v_start + p_count - 1) g;

  return v_start;
end;
$$;

-- Gibt Reservierungen frei (nach Abschluss eines Uploads).
create or replace function public.release_numbers(p_folder_key text, p_numbers bigint[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.number_reservations
   where owner_id = auth.uid()
     and folder_key = p_folder_key
     and number = any (p_numbers);
$$;

revoke all on function public.reserve_numbers(text, int) from public, anon;
revoke all on function public.release_numbers(text, bigint[]) from public, anon;
grant execute on function public.reserve_numbers(text, int) to authenticated;
grant execute on function public.release_numbers(text, bigint[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Protokoll
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('upload', 'rename', 'delete', 'move', 'folder', 'account', 'sync', 'error', 'setup')),
  message text not null,
  details jsonb
);
alter table public.activity_log enable row level security;

create index activity_log_owner_idx on public.activity_log (owner_id, created_at desc);

create policy activity_log_select on public.activity_log
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()));

create policy activity_log_insert on public.activity_log
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()));
