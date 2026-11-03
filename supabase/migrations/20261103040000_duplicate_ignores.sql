-- Duplikate bewusst behalten: ein Foto gehört thematisch in mehrere Ordner (z. B. Apple + Präsentation).
-- Gespeichert wird die Prüfsumme samt den Ordnern, in denen die Kopien liegen. Kommt eine weitere Kopie
-- in einem anderen Ordner dazu (oder fällt eine weg), erscheint die Gruppe wieder als Duplikat.

create table if not exists public.duplicate_ignores (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  md5 text not null,
  parent_keys text[] not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, md5)
);
alter table public.duplicate_ignores enable row level security;
drop policy if exists duplicate_ignores_all on public.duplicate_ignores;
create policy duplicate_ignores_all on public.duplicate_ignores
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()));

-- Gruppen samt Markierung „bewusst behalten“
drop function if exists public.find_duplicates();
create function public.find_duplicates()
returns table (md5 text, total bigint, items jsonb, ignored boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with g as (
    select i.md5,
           count(*) as total,
           max(i.size) as size,
           array_agg(i.parent_key order by i.parent_key) as keys,
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
  )
  select g.md5, g.total, g.items,
         exists (
           select 1 from public.duplicate_ignores x
            where x.md5 = g.md5 and x.owner_id = (select auth.uid()) and x.parent_keys = g.keys
         ) as ignored
    from g
   order by g.size desc nulls last;
$$;

-- Bewusst behalten / wieder als Duplikat zeigen (Ordner werden aus dem aktuellen Stand übernommen)
create or replace function public.ignore_duplicate(p_md5 text)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.duplicate_ignores (md5, parent_keys)
  select p_md5, array_agg(i.parent_key order by i.parent_key)
    from public.items i
   where i.md5 = p_md5 and not i.is_folder and i.path is not null
  on conflict (owner_id, md5) do update set parent_keys = excluded.parent_keys, created_at = now();
$$;

create or replace function public.unignore_duplicate(p_md5 text)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.duplicate_ignores where md5 = p_md5 and owner_id = (select auth.uid());
$$;

-- Hinweis-Zahl ohne bewusst behaltene Gruppen
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
        select d.md5, array_agg(d.parent_key order by d.parent_key) as keys
          from public.items d
         where d.md5 is not null and not d.is_folder and d.path is not null
         group by d.md5 having count(*) > 1
      ) x
      where not exists (
        select 1 from public.duplicate_ignores y
         where y.md5 = x.md5 and y.owner_id = (select auth.uid()) and y.parent_keys = x.keys
      )
    )
  )
  from public.items
  where path is not null;
$$;
