-- Prüfbericht Abschottung, Konto-Gesundheit, Platz sparen, Teilen-Menü (Kurzbefehl)

-- Protokoll: neue Art „check“ (Prüfberichte)
alter table public.activity_log drop constraint if exists activity_log_kind_check;
alter table public.activity_log add constraint activity_log_kind_check
  check (kind in ('upload', 'rename', 'delete', 'move', 'folder', 'account', 'sync', 'error', 'setup', 'check'));

-- Einträge im falschen Bereich: in Privat-/Claude-Konten alles ausserhalb des eigenen Bereichs,
-- und Privat-/Claude-Pfade in Konten mit anderer Rolle. Gemeldet wird nur der oberste betroffene Eintrag
-- (liegt ein ganzer Ordner falsch, erscheint nur der Ordner). `total` = alle betroffenen Einträge.
create or replace function public.seal_violations(p_limit int default 200)
returns table (account_id uuid, email text, role text, path text, is_folder boolean, size bigint, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with v as (
    select i.account_id, a.email, a.role, i.path, i.is_folder, i.size, i.parent_key,
           case lower(split_part(i.path, '/', 1))
             when 'privat' then 'privat' when 'claude' then 'claude'
             when 'archiv' then 'schule' when 'schule' then 'schule' end as zone
      from public.items i
      join public.accounts a on a.id = i.account_id
     where i.path is not null
  ), bad as (
    select * from v
     where (v.role in ('privat', 'claude') and v.zone is distinct from v.role)
        or (v.zone in ('privat', 'claude') and v.role <> v.zone)
  ), top as (
    select b.* from bad b
     where not exists (
       select 1 from bad p
        where p.account_id = b.account_id and p.is_folder and lower(p.path) = b.parent_key
     )
  )
  select t.account_id, t.email, t.role, t.path, t.is_folder, t.size, (select count(*) from bad)
    from top t
   order by t.is_folder desc, t.path
   limit p_limit;
$$;

-- Wachstum pro Konto: in den letzten p_days Tagen neu hinzugekommene Bytes
create or replace function public.account_growth(p_days int default 30)
returns table (account_id uuid, bytes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.account_id, coalesce(sum(i.size), 0)::bigint
    from public.items i
   where not i.is_folder and i.created_time > now() - make_interval(days => p_days)
   group by i.account_id;
$$;

-- Speicher nach Dateityp (Endung), grösste zuerst
create or replace function public.size_by_type()
returns table (ext text, files bigint, bytes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(lower(substring(i.name from '\.([A-Za-z0-9]{1,8})$')), '') as ext,
         count(*), coalesce(sum(i.size), 0)::bigint
    from public.items i
   where not i.is_folder and i.path is not null and coalesce(i.size, 0) > 0
   group by 1
   order by 3 desc;
$$;

grant execute on function public.seal_violations(int) to authenticated;
grant execute on function public.account_growth(int) to authenticated;
grant execute on function public.size_by_type() to authenticated;

-- Persönliche Schlüssel für das Teilen-Menü (Kurzbefehl). Gespeichert wird nur der SHA-256-Hash.
create table if not exists public.share_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'Kurzbefehl',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.share_tokens enable row level security;
create policy share_tokens_select on public.share_tokens
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()));
create policy share_tokens_insert on public.share_tokens
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()));
create policy share_tokens_delete on public.share_tokens
  for delete to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()));
