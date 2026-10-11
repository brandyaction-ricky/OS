-- Reassert the shared notification contract after independently released HR
-- and knowledge migrations. An HR-only definition applied later can otherwise
-- reject knowledge reasons. Keep both menus compatible without changing rows,
-- table structure, policies, function privileges or the notification API.
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
    or (new.owner_id=new.created_by and coalesce(new.metadata->>'reason','') not in ('scheduled','token_expiring','knowledge_review','knowledge_update','knowledge_access','knowledge_reminder','knowledge_mention'))
    or not exists(select 1 from public.os_profiles where id=new.owner_id and is_active)
    -- Preserve the already-deployed HR notification contract when that optional
    -- schema is present; installing this workspace must not disable other menus.
    or (coalesce(new.metadata->>'sourceType','') not in ('record','document')
      and not (to_regclass('public.os_hr_employees') is not null
        and coalesce(new.metadata->>'sourceType','') in ('hr_employee','hr_leave','hr_promotion')))
    or coalesce(new.metadata->>'sourceId','') !~ '^[0-9a-f-]{36}$'
    or coalesce(new.metadata->>'reason','') not in ('assignment','review','approval','blocked','status_change','scheduled','token_expiring','knowledge_review','knowledge_update','knowledge_access','knowledge_reminder','knowledge_mention')
    or coalesce(new.metadata->>'dedupeKey','')=''
    or jsonb_typeof(new.metadata)<>'object'
    or exists(select 1 from jsonb_each(new.metadata) item where item.key not in ('sourceType','sourceId','reason','readAt','dedupeKey') or jsonb_typeof(item.value)<>'string')
    or (new.status='read' and coalesce(new.metadata->>'readAt','')='') then
    raise exception using errcode='23514',message='NOTIFICATION_INVALID';
  end if;
  return new;
end $$;
