-- Rebalancing: Vorschlag erst, wenn er mehr als so viele GB frei macht (null = Standard 1 GB).
alter table public.settings
  add column if not exists min_plan_gb numeric check (min_plan_gb is null or (min_plan_gb >= 0 and min_plan_gb <= 100));
