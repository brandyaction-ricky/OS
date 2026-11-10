-- Only a media type is added; the existing private bucket and access policies remain unchanged.
update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct mime order by mime)
  from unnest(allowed_mime_types || array['application/zip']) as mime
)
where id = 'os-content-media' and allowed_mime_types is not null;
