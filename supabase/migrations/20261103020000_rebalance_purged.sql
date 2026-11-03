-- Nach einem Rebalancing: Originale sofort endgültig gelöscht (statt 30 Tage Papierkorb)
alter table public.rebalance_plans add column if not exists purged_at timestamptz;

create or replace function public.mark_plan_purged(p_plan uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.rebalance_plans
     set purged_at = now()
   where id = p_plan
     and owner_id = (select auth.uid())
     and (select public.is_app_owner());
$$;
