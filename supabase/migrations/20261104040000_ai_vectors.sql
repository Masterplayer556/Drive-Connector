-- KI-Suche: Fingerabdrücke (Zahlen, keine Fotos), am PC gelernt, auf allen Geräten zum Suchen.
-- v = Base64 von [Float32 Skalierung][512 × Int8]; model = Modellversion (z. B. Xenova/mobileclip_s2@fp32).
create table public.ai_vectors (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  model text not null,
  account_id uuid not null references public.accounts (id) on delete cascade,
  drive_id text not null,
  v text not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, model, account_id, drive_id)
);
create index ai_vectors_sync on public.ai_vectors (owner_id, model, updated_at);

alter table public.ai_vectors enable row level security;
create policy ai_vectors_all on public.ai_vectors
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()));
