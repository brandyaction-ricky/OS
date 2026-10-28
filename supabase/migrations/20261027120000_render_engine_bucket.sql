-- 내 컴퓨터로 시안 (owner decisions 2026-10-27): the render PC's v13 engine bundle for staff PCs, in 45 MB parts under the
-- project's upload limit. Private: written and read only through signed URLs the OS hands to the render PC and to staff keys.
-- Additive: a new bucket, nothing existing changes.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('os-render-engine', 'os-render-engine', false, 47185920, array['application/octet-stream']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
