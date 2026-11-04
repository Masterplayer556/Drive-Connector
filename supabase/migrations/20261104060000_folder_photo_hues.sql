-- Ordnerfarbe aus den Fotos: vorherrschender Farbton pro Ordner (null = Fotos fast ohne Farbe → Farbe aus dem Namen).
create table public.folder_photo_hues (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path_key text not null,
  hue int check (hue is null or hue between 0 and 359),
  photos int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (owner_id, path_key)
);
alter table public.folder_photo_hues enable row level security;
create policy folder_photo_hues_all on public.folder_photo_hues
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()));

-- Pro Ordner mit Fotos: Anzahl Fotos und bis zu 12 zufällige (aber feste) Fotos als Stichprobe.
create or replace function public.folder_photo_samples()
returns table (parent_key text, photos int, samples jsonb)
language sql stable security invoker set search_path = public as $$
  with r as (
    select i.parent_key, i.account_id, i.drive_id, i.parent_drive_id,
           row_number() over (partition by i.parent_key order by md5(i.drive_id)) as rn,
           count(*) over (partition by i.parent_key) as n
    from public.items i
    where i.is_folder = false and i.path is not null and i.parent_key is not null and i.mime_type like 'image/%'
  )
  select r.parent_key, max(r.n)::int,
         jsonb_agg(jsonb_build_object('account_id', r.account_id, 'drive_id', r.drive_id, 'parent_drive_id', r.parent_drive_id))
  from r where r.rn <= 12
  group by r.parent_key;
$$;
