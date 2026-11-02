-- Etappe 1: Einstellungen, Duplikate, Kennzahlen, grosse Ordner

-- Einstellungen pro Nutzer (z. B. Papierkorb automatisch leeren)
create table public.settings (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  trash_auto_days int check (trash_auto_days is null or trash_auto_days between 1 and 365),
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;

create policy settings_all on public.settings
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()));

-- Duplikate: gleiche Prüfsumme mehrfach im Pool (Regel 9)
create or replace function public.find_duplicates()
returns table (md5 text, total bigint, items jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.md5,
         count(*) as total,
         jsonb_agg(
           jsonb_build_object(
             'account_id', i.account_id, 'drive_id', i.drive_id, 'name', i.name, 'path', i.path,
             'size', i.size, 'parent_drive_id', i.parent_drive_id, 'parent_key', i.parent_key,
             'taken_at', i.taken_at, 'is_folder', false, 'md5', i.md5, 'mime_type', i.mime_type,
             'description', i.description
           ) order by i.path
         ) as items
    from public.items i
   where i.md5 is not null and not i.is_folder and i.path is not null
   group by i.md5
  having count(*) > 1
   order by max(i.size) desc nulls last;
$$;

-- Kennzahlen für Hinweise und Prognose
create or replace function public.pool_stats()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'files', count(*) filter (where not is_folder),
    'bytes', coalesce(sum(size) filter (where not is_folder), 0),
    'added_30d', coalesce(sum(size) filter (where not is_folder and created_time > now() - interval '30 days'), 0),
    'added_90d', coalesce(sum(size) filter (where not is_folder and created_time > now() - interval '90 days'), 0),
    'duplicates', (
      select count(*) from (
        select d.md5 from public.items d
         where d.md5 is not null and not d.is_folder and d.path is not null
         group by d.md5 having count(*) > 1
      ) x
    )
  )
  from public.items
  where path is not null;
$$;

-- Ordner ohne Unterordner ab einer Grösse (Regel 4: 15 GB)
create or replace function public.big_folders(p_min bigint)
returns table (parent_key text, path text, bytes bigint, files bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.parent_key,
         min(regexp_replace(f.path, '/[^/]*$', '')) as path,
         sum(f.size)::bigint as bytes,
         count(*) as files
    from public.items f
   where not f.is_folder and f.path is not null and f.parent_key <> ''
   group by f.parent_key
  having sum(f.size) >= p_min
     and not exists (
       select 1 from public.items s where s.is_folder and s.parent_key = f.parent_key
     );
$$;
