-- Private channel character art and its catalog for the narrated scene worker.
-- The service role reads and writes these objects; no public storage policy is added.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'os-youtube-character',
  'os-youtube-character',
  false,
  10485760,
  array['image/png', 'application/json']::text[]
)
on conflict (id) do nothing;
