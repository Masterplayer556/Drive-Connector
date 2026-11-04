-- Eigene Tags und Merkzeichen (Farben) an Fotos/Videos. Nur der Besitzer sieht und ändert sie.
create table public.item_tags (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  drive_id text not null,
  tag text not null check (length(trim(tag)) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key (owner_id, account_id, drive_id, tag)
);
create index item_tags_tag on public.item_tags (owner_id, lower(tag));

alter table public.item_tags enable row level security;
create policy item_tags_all on public.item_tags
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()));

-- Fotos mit einem Tag (Gross/klein egal), neueste Markierung zuerst
create or replace function public.tagged_items(p_tag text)
returns setof public.items
language sql
stable
security invoker
set search_path = ''
as $$
  select i.* from public.items i
  join (
    select account_id, drive_id, max(created_at) as at
      from public.item_tags
     where lower(tag) = lower(trim(p_tag))
     group by 1, 2
  ) t on t.account_id = i.account_id and t.drive_id = i.drive_id
  where i.path is not null
  order by t.at desc;
$$;
