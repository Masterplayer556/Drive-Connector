-- KI-SUCHE: gelernte Namen und 👍/👎 auch in der Datenbank sichern – bisher lagen sie nur auf dem Gerät und
-- gingen verloren, wenn die App vom Home-Bildschirm entfernt wurde. Abgleich zwischen iPhone und PC.
-- Gelöschte Einträge bleiben als „deleted“ stehen, damit ein anderes Gerät sie nicht wieder hochlädt.
create table if not exists public.ai_feedback (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  key text,
  english text,
  vote smallint,
  q text,
  at bigint not null,
  deleted boolean not null default false,
  primary key (owner_id, id)
);
alter table public.ai_feedback enable row level security;
create policy ai_feedback_all on public.ai_feedback
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
  with check (owner_id = (select auth.uid()) and (select public.is_app_owner()));
