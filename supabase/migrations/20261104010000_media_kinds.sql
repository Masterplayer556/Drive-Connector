-- Statistik: Fotos und Videos getrennt zählen (nur Lese-Funktionen, ändert keine Daten).

-- Anzahl und Grösse je Art: 'foto', 'video', 'andere'
create or replace function public.media_kinds()
returns table (kind text, files bigint, bytes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select case when mime_type like 'image/%' then 'foto'
              when mime_type like 'video/%' then 'video'
              else 'andere' end as kind,
         count(*), coalesce(sum(size), 0)::bigint
    from public.items
   where not is_folder and path is not null
   group by 1
   order by 3 desc;
$$;

-- Wie upload_months, aber mit der Anzahl Videos je Monat
create or replace function public.upload_months_media(p_months int default 12)
returns table (month date, files bigint, videos bigint, bytes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select date_trunc('month', created_time)::date as month,
         count(*),
         count(*) filter (where mime_type like 'video/%'),
         coalesce(sum(size), 0)::bigint
    from public.items
   where not is_folder and path is not null
     and created_time >= date_trunc('month', now()) - make_interval(months => p_months - 1)
   group by 1
   order by 1;
$$;

grant execute on function public.media_kinds() to authenticated;
grant execute on function public.upload_months_media(int) to authenticated;
