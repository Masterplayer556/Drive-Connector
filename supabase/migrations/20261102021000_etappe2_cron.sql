-- Etappe 2: nächtlicher Job per pg_cron (03:17 Schweizer Winterzeit = 02:17 UTC)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'drivepool-nightly',
  '17 2 * * *',
  $job$
  select net.http_post(
    url := 'https://ijexpqxsbmuxwqibgpdr.supabase.co/functions/v1/nightly',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select secret from private.cron_secret)),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

-- Bereichs-Statistik: Fotos direkt auf oberster Ebene nicht als eigenen Bereich zählen
create or replace function public.area_usage()
returns table (area text, files bigint, bytes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select case when position('/' in path) = 0 then '' else split_part(path, '/', 1) end as area,
         count(*), coalesce(sum(size), 0)::bigint
    from public.items
   where not is_folder and path is not null
   group by 1
   order by 3 desc;
$$;
