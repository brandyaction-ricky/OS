-- Private narration outputs for the development worker. Objects are written by
-- the service role; owner-scoped signed URLs are issued by the application.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'os-youtube-voice',
  'os-youtube-voice',
  false,
  12582912,
  array['audio/mpeg']::text[]
)
on conflict (id) do nothing;
