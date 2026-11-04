-- Pfade neu berechnen, aber nur geänderte Zeilen schreiben.
-- Vorher wurden bei jedem Abgleich alle Zeilen eines Kontos zweimal geschrieben (erst leeren, dann setzen).
-- Bei ~20 000 Einträgen lief das in die 8-s-Grenze (statement timeout) → Abgleich nach dem Verschieben
-- schlug fehl, die App zeigte den alten Stand („verschoben“, aber Foto noch am alten Ort).
create or replace function public.recompute_paths(p_account uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_root text;
begin
  select root_folder_id into v_root from public.accounts where id = p_account;

  if v_root is null then
    update public.items set path = null, parent_key = null
     where account_id = p_account and (path is not null or parent_key is not null);
    return;
  end if;

  with recursive t (drive_id, path, parent_path, depth) as (
    select i.drive_id, i.name, ''::text, 1
    from public.items i
    where i.account_id = p_account and i.parent_drive_id = v_root
    union all
    select i.drive_id, t.path || '/' || i.name, t.path, t.depth + 1
    from public.items i
    join t on i.parent_drive_id = t.drive_id
    where i.account_id = p_account and t.depth < 64
  ),
  tree as (
    select distinct on (drive_id) drive_id, path, lower(parent_path) as parent_key
    from t
    order by drive_id, depth
  ),
  calc as (
    select i.drive_id, tree.path, tree.parent_key
    from public.items i
    left join tree on tree.drive_id = i.drive_id
    where i.account_id = p_account
  )
  update public.items i
     set path = c.path,
         parent_key = c.parent_key
    from calc c
   where i.account_id = p_account
     and i.drive_id = c.drive_id
     and (i.path is distinct from c.path or i.parent_key is distinct from c.parent_key);
end;
$$;
revoke all on function public.recompute_paths(uuid) from public, anon, authenticated;
grant execute on function public.recompute_paths(uuid) to service_role;
