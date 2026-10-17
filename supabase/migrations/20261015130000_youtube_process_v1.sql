-- 유튜브 공정 v1 (M1). Additive only: no existing row, column, policy or function meaning changes.
-- Draft: apply only after owner approval, development database first.
-- The confirm function (os_youtube_confirm) joins this file in T4, before it is applied anywhere.
begin;

-- 1. Feedback, feedback requests and member opinions are their own record type.
--    Same list as the v0.7 constraint plus content_feedback.
alter table public.os_records drop constraint if exists os_records_record_type_check;
alter table public.os_records add constraint os_records_record_type_check check (record_type in (
  'project','task','goal','kpi','decision','meeting','ai_job',
  'development_log','deployment','development_comment','development_notification','notification',
  'content_topic','content_script','content_package','content_short','content_publish','content_metric','content_comment','content_asset',
  'skill','knowledge_link','revenue','funnel','crm_action','customer','brand','connection','access_rule',
  'company_setting','channel','leave_balance','leave_request','expense','contract','subscription','company_document',
  'content_feedback'
));

-- 2. Confirmation history (주제 · 기획안 · 최종 검수). Append-only; written only by the server.
create table public.os_youtube_confirmations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.os_records(id),
  gate text not null check (gate in ('topic','draft','review')),
  round integer not null check (round > 0),
  action text not null check (action in ('request','cancel','ok','changes','hold','revert','reply')),
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  memo text,
  pick text check (pick in ('A','B','C')),
  -- What was confirmed: plan A · B · C, the final video version, and so on.
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object'),
  actor_id uuid not null references public.os_profiles(id),
  created_at timestamptz not null default now()
);
create index os_youtube_confirmations_project_idx on public.os_youtube_confirmations(project_id, created_at desc);
create trigger os_youtube_confirmations_append_only before update or delete on public.os_youtube_confirmations
for each row execute function public.os_content_append_only();
alter table public.os_youtube_confirmations enable row level security;
revoke all on public.os_youtube_confirmations from public, anon, authenticated;
grant select, insert on public.os_youtube_confirmations to service_role;

-- 3. One open AI job per YouTube target and process, whoever started it (D19).
--    The existing per-owner index os_ai_job_open_unique_idx stays as it is.
create unique index os_ai_job_open_yt_target on public.os_records(
  (metadata->>'proc'),(coalesce(metadata->>'targetId','')),(coalesce(metadata->>'sub',''))
) where record_type='ai_job' and metadata->>'space'='personal'
  and status in ('backlog','active') and archived_at is null and metadata->>'proc' like 'yt-%';

-- 4. Browser meeting recordings (audio/webm, audio/ogg) join the private content bucket.
--    Adds to whatever the bucket already accepts; nothing is removed.
update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct mime order by mime)
  from unnest(coalesce(allowed_mime_types, array[]::text[]) || array['audio/webm','audio/ogg']) as mime
)
where id = 'os-content-media';

-- 5. Notification guard: the v0.7 definition with six 유튜브 공정 reasons.
--    yt_confirm_request (6-hour reminder), yt_due and yt_upload may also be sent to oneself.
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
    or (new.owner_id=new.created_by and coalesce(new.metadata->>'reason','') not in ('scheduled','token_expiring','knowledge_review','knowledge_update','knowledge_access','knowledge_reminder','knowledge_mention','ai_result','computer_silent','publish_due','yt_confirm_request','yt_due','yt_upload'))
    or not exists(select 1 from public.os_profiles where id=new.owner_id and is_active)
    -- Preserve the already-deployed HR notification contract when that optional
    -- schema is present; installing this workspace must not disable other menus.
    or (coalesce(new.metadata->>'sourceType','') not in ('record','document','browser')
      and not (to_regclass('public.os_hr_employees') is not null
        and coalesce(new.metadata->>'sourceType','') in ('hr_employee','hr_leave','hr_promotion')))
    or coalesce(new.metadata->>'sourceId','') !~ '^[0-9a-f-]{36}$'
    or coalesce(new.metadata->>'reason','') not in ('assignment','review','approval','blocked','status_change','scheduled','token_expiring','knowledge_review','knowledge_update','knowledge_access','knowledge_reminder','knowledge_mention','ai_result','computer_silent','publish_due','yt_confirm_request','yt_confirm_result','yt_feedback','yt_feedback_request','yt_due','yt_upload')
    or coalesce(new.metadata->>'dedupeKey','')=''
    or jsonb_typeof(new.metadata)<>'object'
    or exists(select 1 from jsonb_each(new.metadata) item where item.key not in ('sourceType','sourceId','reason','readAt','dedupeKey') or jsonb_typeof(item.value)<>'string')
    or (new.status='read' and coalesce(new.metadata->>'readAt','')='') then
    raise exception using errcode='23514',message='NOTIFICATION_INVALID';
  end if;
  return new;
end $$;

commit;
