begin;

-- Keep the existing private content bucket and expand only its accepted media set.
-- Production assets remain private and are served through short-lived signed URLs.
update storage.buckets
set public = false,
    file_size_limit = 5368709120,
    allowed_mime_types = array[
      'video/mp4','video/quicktime','video/x-m4v','video/webm','video/x-matroska',
      'audio/mpeg','audio/wav','audio/x-wav','audio/mp4','audio/aac',
      'image/jpeg','image/png','image/webp','image/gif',
      'text/plain','text/markdown','text/vtt','application/x-subrip','application/json','application/pdf'
    ]
where id = 'os-content-media';

commit;
