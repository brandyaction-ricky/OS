-- Private rendered narrated videos and their assembled narration audio.
-- The service role issues upload and read URLs; no public storage policy is added.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'os-youtube-video',
  'os-youtube-video',
  false,
  2147483648,
  array['video/mp4', 'audio/mpeg']::text[]
)
on conflict (id) do nothing;
