begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'os-content-media',
  'os-content-media',
  false,
  5368709120,
  array['video/mp4','video/quicktime','video/x-m4v','video/webm','video/x-matroska']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
