-- Etappe 3: Rebalancing (Regel 5–7) – gesperrte Ordner, Gruppenregel, Pläne und Warteschlange

-- Regel 7: gesperrte Ordner (logischer Pfad in Kleinbuchstaben, gilt inkl. Unterordner)
create table public.folder_locks (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path_key text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, path_key)
);
alter table public.folder_locks enable row level security;
create policy folder_locks_all on public.folder_locks
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()));

-- Regel 5: der eine grosse Archivordner, dessen Unterordner in Buchstabengruppen geteilt werden
alter table public.settings add column if not exists group_folder text;

-- Regel 6: Vorschläge (Pläne) mit Schritten
create table public.rebalance_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  signature text not null,
  steps jsonb not null,
  bytes bigint not null default 0,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'rejected', 'failed')),
  total int not null default 0,
  done int not null default 0,
  failed int not null default 0,
  message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.rebalance_plans enable row level security;
create index rebalance_plans_owner_idx on public.rebalance_plans (owner_id, created_at desc);
create policy rebalance_plans_select on public.rebalance_plans
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()));
create policy rebalance_plans_insert on public.rebalance_plans
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()) and status in ('queued', 'rejected'));

-- Warteschlange: ein Eintrag pro Datei (nur Backend schreibt)
create table public.rebalance_tasks (
  id bigint generated always as identity primary key,
  plan_id uuid not null references public.rebalance_plans (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  src_account uuid not null references public.accounts (id) on delete cascade,
  dst_account uuid not null references public.accounts (id) on delete cascade,
  src_folder text not null,
  path text not null,
  drive_id text not null,
  name text not null,
  size bigint,
  md5 text,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed', 'skipped')),
  new_id text,
  error text,
  updated_at timestamptz not null default now()
);
alter table public.rebalance_tasks enable row level security;
create index rebalance_tasks_queue_idx on public.rebalance_tasks (plan_id, status, id);
create policy rebalance_tasks_select on public.rebalance_tasks
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()));

-- Einheiten für Planung und Regal-Ansicht: Ordner + direkte Fotos, pro Konto
create or replace function public.rebalance_units()
returns table (account_id uuid, parent_key text, path text, folder_id text, files bigint, bytes bigint, has_subfolders boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (
    select i.account_id, i.parent_key, i.parent_drive_id,
           min(regexp_replace(i.path, '/[^/]*$', '')) as path,
           count(*) as files, coalesce(sum(i.size), 0)::bigint as bytes
      from public.items i
     where not i.is_folder and i.path is not null and i.parent_key <> ''
     group by i.account_id, i.parent_key, i.parent_drive_id
  )
  select f.account_id, f.parent_key, f.path, f.parent_drive_id, f.files, f.bytes,
         exists (select 1 from public.items s
                  where s.is_folder and s.parent_key = f.parent_key and s.path is not null
                    and s.owner_id = (select auth.uid())) as has_subfolders
    from f
   order by f.bytes desc;
$$;
