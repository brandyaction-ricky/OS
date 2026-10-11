-- Run only in approved DEV. Fixtures live in temporary tables; every change rolls back.
begin;
set local search_path=public,pg_temp;
create temporary table notification_contract (like public.os_records including defaults) on commit drop;
create trigger notification_contract_guard before insert or update or delete on notification_contract
for each row execute function public.os_notification_guard();

create function pg_temp.expect_notification_rejected(command text, expected_message text) returns void
language plpgsql as $$
begin
  begin
    execute command;
  exception when check_violation then
    if sqlerrm<>expected_message then raise; end if;
    return;
  end;
  raise exception 'INVALID_NOTIFICATION_ACCEPTED';
end $$;

do $$
declare recipient uuid; actor uuid:=gen_random_uuid(); reason text; source_type text; sample uuid; test_metadata jsonb;
begin
  select id into recipient from public.os_profiles where is_active order by id limit 1;
  if recipient is null then raise exception 'ACTIVE_DEV_PROFILE_REQUIRED'; end if;
  foreach reason in array array['knowledge_review','knowledge_update','knowledge_access','knowledge_reminder','knowledge_mention'] loop
    insert into notification_contract(record_type,title,description,status,owner_id,created_by,updated_by,metadata)
    values('notification','업무 알림','','unread',recipient,recipient,recipient,
      jsonb_build_object('sourceType','document','sourceId',gen_random_uuid()::text,'reason',reason,'dedupeKey',reason));
  end loop;
  foreach source_type in array array['record','document'] loop
    foreach reason in array array['assignment','review','approval','blocked','status_change','scheduled','token_expiring'] loop
      insert into notification_contract(record_type,title,description,status,owner_id,created_by,updated_by,metadata)
      values('notification','업무 알림','','unread',recipient,actor,actor,
        jsonb_build_object('sourceType',source_type,'sourceId',gen_random_uuid()::text,'reason',reason,'dedupeKey',reason));
    end loop;
    foreach reason in array array['scheduled','token_expiring'] loop
      insert into notification_contract(record_type,title,description,status,owner_id,created_by,updated_by,metadata)
      values('notification','업무 알림','','unread',recipient,recipient,recipient,
        jsonb_build_object('sourceType',source_type,'sourceId',gen_random_uuid()::text,'reason',reason,'dedupeKey',reason));
    end loop;
  end loop;
  if to_regclass('public.os_hr_employees') is not null then
    foreach source_type in array array['hr_employee','hr_leave','hr_promotion'] loop
      insert into notification_contract(record_type,title,description,status,owner_id,created_by,updated_by,metadata)
      values('notification','업무 알림','','unread',recipient,actor,actor,
        jsonb_build_object('sourceType',source_type,'sourceId',gen_random_uuid()::text,'reason','assignment','dedupeKey',source_type));
    end loop;
  end if;
  if (select count(*) from notification_contract)<>(23+case when to_regclass('public.os_hr_employees') is null then 0 else 3 end) then
    raise exception 'VALID_NOTIFICATION_COUNT_MISMATCH';
  end if;
  select id into sample from notification_contract where metadata->>'reason'='knowledge_review';
  update notification_contract set status='read',metadata=metadata||jsonb_build_object('readAt',now()::text) where id=sample;
  update notification_contract set status='unread',metadata=metadata-'readAt' where id=sample;

  perform pg_temp.expect_notification_rejected(format('update notification_contract set title=%L where id=%L','changed',sample),'NOTIFICATION_IMMUTABLE');
  perform pg_temp.expect_notification_rejected(format('update notification_contract set metadata=metadata||%L::jsonb where id=%L','{"sourceType":"record"}',sample),'NOTIFICATION_IMMUTABLE');
  perform pg_temp.expect_notification_rejected(format('update notification_contract set record_type=%L where id=%L','task',sample),'NOTIFICATION_IMMUTABLE');
  perform pg_temp.expect_notification_rejected(format('delete from notification_contract where id=%L',sample),'NOTIFICATION_IMMUTABLE');
  perform pg_temp.expect_notification_rejected(format('update notification_contract set status=%L where id=%L','read',sample),'NOTIFICATION_INVALID');

  foreach test_metadata in array array[
    jsonb_build_object('sourceType','document','sourceId',gen_random_uuid()::text,'reason','assignment','dedupeKey','self-assignment'),
    jsonb_build_object('sourceType','document','sourceId',gen_random_uuid()::text,'reason','unknown','dedupeKey','unknown'),
    jsonb_build_object('sourceType','unknown','sourceId',gen_random_uuid()::text,'reason','knowledge_review','dedupeKey','unknown-source'),
    jsonb_build_object('sourceType','document','sourceId','invalid','reason','knowledge_review','dedupeKey','invalid-id'),
    jsonb_build_object('sourceType','document','sourceId',gen_random_uuid()::text,'reason','knowledge_review','dedupeKey','extra','secret','forbidden'),
    jsonb_build_object('sourceType','document','sourceId',gen_random_uuid()::text,'reason','knowledge_review','dedupeKey',42)
  ] loop
    perform pg_temp.expect_notification_rejected(format(
      'insert into notification_contract(record_type,title,description,status,owner_id,created_by,updated_by,metadata) values(%L,%L,%L,%L,%L,%L,%L,%L::jsonb)',
      'notification','업무 알림','','unread',recipient,recipient,recipient,test_metadata),'NOTIFICATION_INVALID');
  end loop;
  insert into notification_contract(record_type,title,owner_id,created_by,updated_by) values('task','Unrelated task',recipient,actor,actor) returning id into sample;
  update notification_contract set title='Unrelated task updated' where id=sample;
  delete from notification_contract where id=sample;
end $$;
rollback;
select 'notification workspace compatibility passed' as result;
