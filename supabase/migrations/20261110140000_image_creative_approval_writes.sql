begin;

-- Image approval history, output leases and the subscription jobs that carry the
-- approved brief are written by the authenticated OS domain services. A browser
-- JWT retains the existing read policies but cannot insert or modify this state
-- directly via PostgREST, even for its own personal project.
create policy os_image_creative_insert_via_service on public.os_records
as restrictive for insert to authenticated
with check (not (metadata @> '{"kind":"image_creative_v1"}'::jsonb
              or metadata @> '{"kind":"youtube_staff_ai_v1","task":"image-creative"}'::jsonb));

create policy os_image_creative_update_via_service on public.os_records
as restrictive for update to authenticated
using (not (metadata @> '{"kind":"image_creative_v1"}'::jsonb
         or metadata @> '{"kind":"youtube_staff_ai_v1","task":"image-creative"}'::jsonb))
with check (not (metadata @> '{"kind":"image_creative_v1"}'::jsonb
              or metadata @> '{"kind":"youtube_staff_ai_v1","task":"image-creative"}'::jsonb));

create policy os_image_creative_delete_via_service on public.os_records
as restrictive for delete to authenticated
using (not (metadata @> '{"kind":"image_creative_v1"}'::jsonb
         or metadata @> '{"kind":"youtube_staff_ai_v1","task":"image-creative"}'::jsonb));

commit;
