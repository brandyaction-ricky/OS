-- Only run in a disposable/local database or authorized QA environment.
begin;

insert into auth.users (id, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values ('d9100000-0000-4000-8000-000000000001', 'authenticated', 'image-approval-test@example.test', '', now(), '{}');

-- Seed the two protected record kinds through the same privileged role as the OS.
set local role service_role;
insert into public.os_records (id, record_type, title, owner_id, created_by, updated_by, metadata)
select id, typ, 'RLS fixture', u, u, u, meta
from (values
  ('d9100000-0000-4000-8000-000000000010'::uuid, 'content_package', '{"space":"personal","kind":"image_creative_v1"}'::jsonb),
  ('d9100000-0000-4000-8000-000000000020'::uuid, 'ai_job', '{"space":"personal","kind":"youtube_staff_ai_v1","task":"image-creative"}'::jsonb)
) as fixtures(id, typ, meta)
cross join (values ('d9100000-0000-4000-8000-000000000001'::uuid)) as owner(u);

set local role authenticated;
select set_config('request.jwt.claim.sub','d9100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"d9100000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $check$
declare
  u uuid := 'd9100000-0000-4000-8000-000000000001';
  ordinary uuid := 'd9100000-0000-4000-8000-000000000030';
  protected record;
begin
  insert into public.os_records(id,record_type,title,owner_id,created_by,updated_by,metadata)
    values (ordinary,'content_package','ordinary',u,u,u,'{"space":"personal","kind":"other-package"}');
  update public.os_records set title='ordinary edit' where id=ordinary;
  if not found then raise exception 'Unrelated personal edits must remain possible'; end if;

  for protected in select * from (values
    ('d9100000-0000-4000-8000-000000000010'::uuid,'content_package','{"space":"personal","kind":"image_creative_v1"}'::jsonb),
    ('d9100000-0000-4000-8000-000000000020'::uuid,'ai_job','{"space":"personal","kind":"youtube_staff_ai_v1","task":"image-creative"}'::jsonb)
  ) as kinds(id,typ,meta) loop
    perform 1 from public.os_records where id=protected.id;
    if not found then raise exception 'Owner must retain reads of %',protected.typ; end if;

    begin
      insert into public.os_records(record_type,title,owner_id,created_by,updated_by,metadata)
        values(protected.typ,'forged',u,u,u,protected.meta);
      raise exception 'Authenticated insert forged %',protected.typ;
    exception when insufficient_privilege then null; end;

    begin
      update public.os_records set metadata=protected.meta where id=ordinary;
      raise exception 'Authenticated update forged % by changing an ordinary kind',protected.typ;
    exception when insufficient_privilege then null; end;

    update public.os_records set metadata=metadata || '{"forged":true}' where id=protected.id;
    if found then raise exception 'Protected % was mutable',protected.typ; end if;
    update public.os_records set metadata='{}' where id=protected.id;
    if found then raise exception 'Protected % could be disguised',protected.typ; end if;
    delete from public.os_records where id=protected.id;
    if found then raise exception 'Authenticated user deleted %',protected.typ; end if;
  end loop;
end $check$;

set local role service_role;
do $check$
begin
  update public.os_records set title='validated server edit' where id='d9100000-0000-4000-8000-000000000010';
  if not found then raise exception 'Validated server writes must remain possible'; end if;
end $check$;
rollback;
