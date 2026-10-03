begin;

-- Additive vocabulary only. No existing records or policies are rewritten.
do $$
declare constraint_name text;
begin
  select conname into constraint_name from pg_constraint
  where conrelid='public.os_records'::regclass and contype='c'
    and pg_get_constraintdef(oid) ilike '%record_type%' limit 1;
  if constraint_name is not null then
    execute format('alter table public.os_records drop constraint %I',constraint_name);
  end if;
end $$;
alter table public.os_records add constraint os_records_record_type_check check(record_type in (
  'project','task','goal','kpi','decision','meeting','ai_job',
  'development_log','deployment','development_comment','development_notification','notification',
  'content_topic','content_script','content_package','content_short','content_publish','content_metric','content_comment',
  'skill','knowledge_link','revenue','funnel','crm_action','customer','brand','connection','access_rule',
  'company_setting','channel','leave_balance','leave_request','expense','contract','subscription','company_document'
));
create unique index os_content_comment_external_unique on public.os_records
  ((metadata->>'platform'),(metadata->>'connectionOwnerId'),(metadata->>'externalId'))
  where record_type='content_comment' and metadata ? 'externalId';

-- Extend the immutable notification vocabulary for self-addressed reminders.
-- Authenticated clients still have no notification INSERT/UPDATE access.
create or replace function public.os_notification_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    if old.record_type='notification' then raise exception using errcode='23514',message='NOTIFICATION_IMMUTABLE'; end if;
    return old;
  end if;
  if tg_op='UPDATE' and (old.record_type='notification' or new.record_type='notification') then
    if old.record_type<>new.record_type
      or (to_jsonb(new)-array['status','metadata','updated_by','updated_at','version']) is distinct from
         (to_jsonb(old)-array['status','metadata','updated_by','updated_at','version'])
      or (new.metadata-'readAt') is distinct from (old.metadata-'readAt') then
      raise exception using errcode='23514',message='NOTIFICATION_IMMUTABLE';
    end if;
  end if;
  if new.record_type<>'notification' then return new; end if;
  if new.title<>'업무 알림' or new.description<>'' or new.status not in ('read','unread')
    or new.owner_id is null
    or (new.owner_id=new.created_by and coalesce(new.metadata->>'reason','') not in ('scheduled','token_expiring'))
    or not exists(select 1 from public.os_profiles where id=new.owner_id and is_active)
    or coalesce(new.metadata->>'sourceType','') not in ('record','document')
    or coalesce(new.metadata->>'sourceId','') !~ '^[0-9a-f-]{36}$'
    or coalesce(new.metadata->>'reason','') not in ('assignment','review','approval','blocked','status_change','scheduled','token_expiring')
    or coalesce(new.metadata->>'dedupeKey','')=''
    or jsonb_typeof(new.metadata)<>'object'
    or exists(select 1 from jsonb_each(new.metadata) item where item.key not in ('sourceType','sourceId','reason','readAt','dedupeKey') or jsonb_typeof(item.value)<>'string')
    or (new.status='read' and coalesce(new.metadata->>'readAt','')='') then
    raise exception using errcode='23514',message='NOTIFICATION_INVALID';
  end if;
  return new;
end $$;

-- Invoker rights and a service-only grant, not a record-write privilege bypass.
-- created_by identifies the owner of the reminder; reason identifies the system
-- event, not a claim that another staff member sent a message.
create function public.os_enqueue_channel_reminder(recipient uuid, source_id uuid, reminder_key text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare inserted integer; source public.os_records; reason text;
begin
  if recipient is null or coalesce(reminder_key,'')='' or length(reminder_key)>300 then return false; end if;
  if not exists(select 1 from public.os_profiles where id=recipient and is_active) then return false; end if;
  select * into source from public.os_records where id=source_id and archived_at is null;
  if not found then return false; end if;
  if source.record_type='content_publish' and source.status='scheduled' and source.starts_at<=now()
    and (source.metadata->'account'->>'ownerId'=recipient::text or source.metadata->>'scheduledBy'=recipient::text) then
    reason:='scheduled';
  elsif source.record_type='connection' and source.metadata->>'kind'='channel_expiry'
    and source.owner_id=recipient then reason:='token_expiring';
  else return false; end if;
  insert into public.os_records(record_type,title,description,status,owner_id,created_by,updated_by,metadata)
  values('notification','업무 알림','','unread',recipient,recipient,recipient,
    jsonb_build_object('sourceType','record','sourceId',source_id::text,'reason',reason,'readAt','',
      'dedupeKey','channel:'||source_id::text||':'||recipient::text||':'||reminder_key)) on conflict do nothing;
  get diagnostics inserted=row_count;
  return inserted>0;
end $$;
revoke all on function public.os_enqueue_channel_reminder(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.os_enqueue_channel_reminder(uuid,uuid,text) to service_role;
commit;
