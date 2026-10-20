-- 마이인 v13 keeps the voice exactly as Fish returns it (wav) beside the mp3 narration (owner decision 2026-10-19).
-- Applied to DEV through the dashboard on 2026-10-19; this file carries the same change to every project.
update storage.buckets
set allowed_mime_types = array['audio/mpeg', 'audio/wav']::text[]
where id = 'os-youtube-voice';
