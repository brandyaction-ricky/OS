-- Word alignment is private and versioned beside the narration audio.
-- The service role writes these objects; no public storage policy is added.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'os-youtube-voice-timing',
  'os-youtube-voice-timing',
  false,
  1048576,
  array['application/json']::text[]
)
on conflict (id) do nothing;
