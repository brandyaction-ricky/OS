-- 링크관리: utm_content keeps the case staff typed (a YouTube video ID such as sQ2Abm4S8rI is case-sensitive).
-- utm_source/medium/campaign stay lowercase-only. Widening a check only: every existing row (all lowercase) still passes,
-- no row is rewritten, and the old app code (which only ever writes lowercase) keeps working.
begin;

alter table public.os_utm_options drop constraint os_utm_options_code_check;
alter table public.os_utm_options add constraint os_utm_options_code_check
  check (code ~ '^[a-z0-9_-]{1,80}$' or (kind = 'content' and code ~ '^[A-Za-z0-9_-]{1,80}$'));

commit;
