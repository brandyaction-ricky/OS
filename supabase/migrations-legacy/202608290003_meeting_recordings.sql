begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'os-meeting-recordings',
  'os-meeting-recordings',
  false,
  4000000,
  array['audio/webm', 'audio/ogg', 'audio/mpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
