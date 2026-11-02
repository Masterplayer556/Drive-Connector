-- Etappe 2: Favoriten, Teilen-Links, Speicherverlauf, Suche, Statistik, nächtlicher Job

-- Favoriten (#11)
create table public.favorites (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  drive_id text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, account_id, drive_id)
);
alter table public.favorites enable row level security;
create policy favorites_all on public.favorites
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()));

create or replace function public.favorite_items()
returns setof public.items
language sql
stable
security invoker
set search_path = ''
as $$
  select i.* from public.items i
  join public.favorites f on f.account_id = i.account_id and f.drive_id = i.drive_id
  order by f.created_at desc;
$$;

-- Teilen-Links (#15) – Ablauf wird nachts entfernt
create table public.shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  drive_id text not null,
  name text not null,
  permission_id text not null,
  url text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.shares enable row level security;
create policy shares_all on public.shares
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()));

-- Speicherverlauf (#14) – ein Eintrag pro Tag, vom nächtlichen Job geschrieben
create table public.usage_snapshots (
  owner_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  usage bigint not null,
  quota bigint not null,
  files bigint not null,
  primary key (owner_id, day)
);
alter table public.usage_snapshots enable row level security;
create policy usage_snapshots_select on public.usage_snapshots
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()));

-- Suche (#8): Name oder Pfad, Ordner zusammengeführt
create or replace function public.search_items(p_query text, p_limit int default 200)
returns setof public.items
language sql
stable
security invoker
set search_path = ''
as $$
  select i.* from public.items i
   where i.path is not null
     and length(trim(p_query)) > 0
     and i.path ilike '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
   order by i.is_folder desc,
            (i.name ilike replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%') desc,
            length(i.path)
   limit least(greatest(p_limit, 1), 500);
$$;

-- Statistik (#14)
create or replace function public.upload_months(p_months int default 18)
returns table (month date, files bigint, bytes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select date_trunc('month', created_time)::date as month, count(*), coalesce(sum(size), 0)::bigint
    from public.items
   where not is_folder and path is not null
     and created_time >= date_trunc('month', now()) - make_interval(months => p_months - 1)
   group by 1
   order by 1;
$$;

create or replace function public.area_usage()
returns table (area text, files bigint, bytes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select split_part(path, '/', 1) as area, count(*), coalesce(sum(size), 0)::bigint
    from public.items
   where not is_folder and path is not null
   group by 1
   order by 3 desc;
$$;

create or replace function public.top_folders(p_limit int default 8)
returns table (parent_key text, path text, files bigint, bytes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select parent_key, min(regexp_replace(path, '/[^/]*$', '')), count(*), coalesce(sum(size), 0)::bigint
    from public.items
   where not is_folder and path is not null and parent_key <> ''
   group by parent_key
   order by 4 desc
   limit p_limit;
$$;

-- Nächtlicher Job (#13): Geheimnis nur in der Datenbank, Prüfung per RPC (nur service_role)
-- Schema „private“ ist nicht über die API erreichbar (nur public ist freigegeben)
create schema if not exists private;

create table private.cron_secret (
  singleton boolean primary key default true check (singleton),
  secret text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
insert into private.cron_secret default values on conflict do nothing;

create or replace function public.check_cron_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- nur für die Edge Function (service_role) – alle anderen bekommen immer false
  select (select auth.role()) = 'service_role'
     and exists (select 1 from private.cron_secret where secret = p_secret);
$$;
