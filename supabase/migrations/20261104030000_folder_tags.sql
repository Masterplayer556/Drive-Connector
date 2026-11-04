-- Tags an Ordnern gelten für alles darin (auch Unterordner und später hinzugefügte Fotos).

-- Ordner mit Tags: Tag + Pfad (für die KI-Suche auf dem Gerät)
create or replace function public.folder_tags()
returns table (tag text, path text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct t.tag, i.path
    from public.item_tags t
    join public.items i on i.account_id = t.account_id and i.drive_id = t.drive_id
   where i.is_folder and i.path is not null;
$$;

-- Fotos mit einem Tag: direkt markiert oder in einem markierten Ordner; markierte Ordner selbst auch
create or replace function public.tagged_items(p_tag text)
returns setof public.items
language sql
stable
security invoker
set search_path = ''
as $$
  with direct as (
    select t.account_id, t.drive_id, max(t.created_at) as at
      from public.item_tags t
     where lower(t.tag) = lower(trim(p_tag))
     group by 1, 2
  ),
  folders as (
    select distinct lower(i.path) as p, d.at
      from direct d
      join public.items i on i.account_id = d.account_id and i.drive_id = d.drive_id
     where i.is_folder and i.path is not null
  ),
  hits as (
    select i.account_id, i.drive_id, d.at
      from public.items i join direct d on d.account_id = i.account_id and d.drive_id = i.drive_id
     where i.path is not null
    union all
    select i.account_id, i.drive_id, f.at
      from public.items i join folders f on starts_with(lower(i.path), f.p || '/')
     where i.path is not null and not i.is_folder
  )
  select i.* from public.items i
  join (select account_id, drive_id, max(at) as at from hits group by 1, 2) h
    on h.account_id = i.account_id and h.drive_id = i.drive_id
  order by i.is_folder desc, h.at desc, i.taken_at desc nulls last;
$$;
