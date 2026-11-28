-- „Sieht gleich aus“: Abbilder der Fotos auf dem Server statt nur auf einem Gerät.
-- Pro Prüfsumme ein Abbild (winzige Zahlenreihe, kein Foto): 32×32 Graustufen + 4×4 Farbe als Base64,
-- dazu das Seitenverhältnis. Jedes Foto wird so nur einmal geprüft – egal auf welchem Gerät.
-- s = null: Vorschau liess sich nicht laden → nach ein paar Tagen nochmals versuchen.
-- v = Version der Rechnung: ändert sie sich, gelten alte Abbilder als fehlend.

create table if not exists public.look_sigs (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  md5 text not null,
  v smallint not null default 1,
  s text,
  ar real,
  updated_at timestamptz not null default now(),
  primary key (owner_id, md5)
);
create index if not exists look_sigs_sync on public.look_sigs (owner_id, updated_at);

-- Zeitstempel immer vom Server (Geräte-Uhren gehen falsch) – andere Geräte holen ab diesem Zeitpunkt nach
create or replace function public.look_sigs_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists look_sigs_touch on public.look_sigs;
create trigger look_sigs_touch before insert or update on public.look_sigs
  for each row execute function public.look_sigs_touch();
revoke execute on function public.look_sigs_touch() from public, anon, authenticated;

alter table public.look_sigs enable row level security;
drop policy if exists look_sigs_all on public.look_sigs;
create policy look_sigs_all on public.look_sigs
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()));

-- Bilder im Pool ohne (gültiges) Abbild – eines pro Prüfsumme.
-- Unabhängig vom Erstelldatum: auch Fotos mit altem Datum (über die Drive-App hochgeladen, in den Pool
-- verschoben) werden gefunden.
create or replace function public.look_missing(p_v smallint)
returns table (account_id uuid, drive_id text, parent_drive_id text, md5 text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (i.md5) i.account_id, i.drive_id, i.parent_drive_id, i.md5
    from public.items i
   where not i.is_folder and i.path is not null and i.md5 is not null and i.mime_type like 'image/%'
     and not exists (
       select 1 from public.look_sigs s
        where s.md5 = i.md5 and s.owner_id = (select auth.uid()) and s.v = p_v
          and (s.s is not null or s.updated_at > now() - interval '3 days')
     )
   order by i.md5, i.account_id, i.drive_id;
$$;

create or replace function public.look_missing_count(p_v smallint)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select count(distinct i.md5)
    from public.items i
   where not i.is_folder and i.path is not null and i.md5 is not null and i.mime_type like 'image/%'
     and not exists (
       select 1 from public.look_sigs s
        where s.md5 = i.md5 and s.owner_id = (select auth.uid()) and s.v = p_v
          and (s.s is not null or s.updated_at > now() - interval '3 days')
     );
$$;

-- Abbilder von Fotos wegräumen, die es nicht mehr gibt. Erst nach 2 Tagen: beim Upload wird das Abbild
-- gespeichert, bevor der Abgleich das neue Foto in „items“ einträgt.
create or replace function public.prune_look_sigs()
returns bigint
language sql
security invoker
set search_path = ''
as $$
  with d as (
    delete from public.look_sigs s
     where s.owner_id = (select auth.uid())
       and s.updated_at < now() - interval '2 days'
       and not exists (select 1 from public.items i where i.md5 = s.md5)
    returning 1
  )
  select count(*) from d;
$$;

revoke execute on function public.look_missing(smallint) from public, anon;
revoke execute on function public.look_missing_count(smallint) from public, anon;
revoke execute on function public.prune_look_sigs() from public, anon;
grant execute on function public.look_missing(smallint) to authenticated;
grant execute on function public.look_missing_count(smallint) to authenticated;
grant execute on function public.prune_look_sigs() to authenticated;

-- Exakte Duplikate wie im Konzept: gleiche Prüfsumme UND gleiche Grösse. Dazu die Bildmasse für die
-- Wahl, welche Kopie bleibt.
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
               'description', i.description, 'width', i.width, 'height', i.height
             ) order by i.path
           ) as items
      from public.items i
     where i.md5 is not null and not i.is_folder and i.path is not null
     group by i.md5, i.size
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
revoke execute on function public.find_duplicates() from public, anon;
grant execute on function public.find_duplicates() to authenticated;

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
         group by d.md5, d.size having count(*) > 1
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
