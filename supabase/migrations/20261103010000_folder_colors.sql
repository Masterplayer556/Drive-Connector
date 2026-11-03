-- Eigene Ordnerfarben (Farbton 0–359), pro logischem Pfad
create table public.folder_colors (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path_key text not null,
  hue int not null check (hue between 0 and 359),
  updated_at timestamptz not null default now(),
  primary key (owner_id, path_key)
);
alter table public.folder_colors enable row level security;
create policy folder_colors_all on public.folder_colors
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()));
