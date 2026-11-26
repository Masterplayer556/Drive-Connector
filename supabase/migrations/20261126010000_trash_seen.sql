-- Seit wann liegt ein Eintrag im Papierkorb? Google liefert „trashedTime“ laut Doku nur für geteilte
-- Ablagen – für „Meine Ablage“ merkt sich die App darum selbst, wann sie ihn zum ersten Mal dort gesehen hat.
-- Das automatische Leeren nimmt trashedTime, sonst dieses Datum (nie früher löschen als eingestellt).
create table public.trash_seen (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  drive_id text not null,
  seen_at timestamptz not null default now(),
  primary key (account_id, drive_id)
);
create index trash_seen_owner on public.trash_seen (owner_id);

alter table public.trash_seen enable row level security;
create policy trash_seen_all on public.trash_seen
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()));
