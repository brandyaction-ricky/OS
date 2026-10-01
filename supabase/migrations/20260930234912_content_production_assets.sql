begin;

-- Create the private content bucket when an isolated environment has never received
-- the legacy bucket migration; otherwise expand only its accepted media set.
-- Production assets remain private and are served through short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'os-content-media',
  'os-content-media',
  false,
  5368709120,
  array[
      'video/mp4','video/quicktime','video/x-m4v','video/webm','video/x-matroska',
      'audio/mpeg','audio/wav','audio/x-wav','audio/mp4','audio/aac',
      'image/jpeg','image/png','image/webp','image/gif',
      'text/plain','text/markdown','text/vtt','application/x-subrip','application/json','application/pdf'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
