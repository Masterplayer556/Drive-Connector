-- Rebalancing sicher bei mehreren gleichzeitigen Läufen (App + Nachtjob, mehrere Aufrufe):
-- Jede Aufgabe wird exklusiv reserviert („working“), damit kein Foto doppelt kopiert wird.
-- Bleibt eine Reservierung hängen (Funktion abgebrochen), wird sie nach 10 Minuten wieder frei.

alter table public.rebalance_tasks drop constraint if exists rebalance_tasks_status_check;
alter table public.rebalance_tasks
  add constraint rebalance_tasks_status_check check (status in ('pending', 'working', 'done', 'failed', 'skipped'));
alter table public.rebalance_tasks add column if not exists claimed_at timestamptz;
alter table public.rebalance_tasks add column if not exists attempts int not null default 0;

-- Plan erst abarbeiten, wenn alle Aufgaben eingereiht sind (bestehende Pläne gelten als eingereiht)
alter table public.rebalance_plans add column if not exists expanded boolean not null default true;

create or replace function public.claim_rebalance_tasks(p_plan uuid, p_limit int)
returns setof public.rebalance_tasks
language sql
security definer
set search_path = ''
as $$
  update public.rebalance_tasks t
     set status = 'working', claimed_at = now(), attempts = t.attempts + 1, updated_at = now()
   where t.id in (
     select q.id
       from public.rebalance_tasks q
      where q.plan_id = p_plan
        and (q.status = 'pending' or (q.status = 'working' and q.claimed_at < now() - interval '10 minutes'))
      order by q.id
      limit p_limit
        for update skip locked
   )
  returning t.*;
$$;

-- Nur der Server (Service-Role) darf reservieren
revoke all on function public.claim_rebalance_tasks(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_rebalance_tasks(uuid, int) to service_role;
