-- Start a personal topic and all selected channel drafts in one transaction.
-- This is additive. It does not update any existing topic or document on apply.
begin;

create function public.os_start_personal_content_topic(
  p_owner uuid,p_topic uuid,p_expected_version integer,p_brief jsonb,p_channels jsonb
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  topic public.os_records;
  saved public.os_records;
  child public.os_records;
  choice jsonb;
  channel text;
  due_text text;
  selected_channels text[]:='{}';
  dues jsonb:='{}'::jsonb;
  created jsonb:='[]'::jsonb;
begin
  select * into topic from public.os_records
  where id=p_topic and owner_id=p_owner and record_type='content_topic'
    and metadata->>'space'='personal' and archived_at is null for update;
  if not found then raise exception using errcode='PT404',message='TOPIC_NOT_FOUND'; end if;
  if topic.version<>p_expected_version then
    raise exception using errcode='PT409',message='TOPIC_VERSION_CHANGED'; end if;
  if topic.status<>'draft' or topic.stage not in ('candidate','brief')
    or exists(select 1 from public.os_records r where r.parent_id=p_topic
      and r.owner_id=p_owner and r.record_type='content_publish'
      and r.metadata->>'space'='personal' and r.archived_at is null) then
    raise exception using errcode='PT409',message='TOPIC_ALREADY_STARTED'; end if;
  if jsonb_typeof(p_brief)<>'object' or jsonb_typeof(p_channels)<>'array' then
    raise exception using errcode='PT422',message='TOPIC_START_INVALID'; end if;
  if jsonb_array_length(p_channels) not between 1 and 3 then
    raise exception using errcode='PT422',message='TOPIC_CHANNELS_INVALID'; end if;

  for choice in select value from jsonb_array_elements(p_channels) loop
    channel:=choice->>'channel';
    due_text:=nullif(choice->>'due','');
    if jsonb_typeof(choice)<>'object' or channel is null
      or channel not in ('card','shorts','threads')
      or channel=any(selected_channels) then
      raise exception using errcode='PT422',message='TOPIC_CHANNELS_INVALID'; end if;
    if choice ? 'templateId' and (
      channel<>'card' or coalesce(choice->>'templateId','') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not exists(select 1 from public.os_records template
        where template.id=case when coalesce(choice->>'templateId','') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (choice->>'templateId')::uuid else null end
          and template.owner_id=p_owner and template.record_type='content_package'
          and template.metadata->>'space'='personal'
          and template.metadata->>'packageKind'='cardnews_template_v2'
          and template.archived_at is null)) then
      raise exception using errcode='PT422',message='TOPIC_TEMPLATE_INVALID'; end if;
    if due_text is not null then
      if due_text !~ '^\d{4}-\d{2}-\d{2}$'
        or to_char(to_date(due_text,'YYYY-MM-DD'),'YYYY-MM-DD')<>due_text then
        raise exception using errcode='PT422',message='TOPIC_DUE_INVALID'; end if;
      dues:=dues||jsonb_build_object(channel,due_text);
    end if;
    selected_channels:=array_append(selected_channels,channel);
  end loop;

  update public.os_records set stage='confirmed',updated_by=p_owner,
    metadata=(topic.metadata-'brief'-'channels'-'dues')||jsonb_build_object(
      'brief',p_brief,'channels',to_jsonb(selected_channels),'dues',dues,'space','personal')
  where id=p_topic and owner_id=p_owner and version=p_expected_version
  returning * into saved;
  if not found then raise exception using errcode='PT409',message='TOPIC_VERSION_CHANGED'; end if;

  for choice in select value from jsonb_array_elements(p_channels) loop
    channel:=choice->>'channel';
    due_text:=nullif(choice->>'due','');
    insert into public.os_records(
      record_type,title,description,status,stage,brand,parent_id,due_date,
      owner_id,created_by,updated_by,metadata
    ) values(
      'content_publish',topic.title,'','draft','making',topic.brand,p_topic,
      due_text::date,p_owner,p_owner,p_owner,
      jsonb_build_object('space','personal','channel',channel,'step',0,
        'pages','[]'::jsonb,'cuts','[]'::jsonb,'posts','[]'::jsonb)
        ||case when channel='card' and choice ? 'templateId'
          then jsonb_build_object('templateId',choice->>'templateId') else '{}'::jsonb end
    ) returning * into child;
    created:=created||jsonb_build_array(to_jsonb(child));
  end loop;
  return jsonb_build_object('topic',to_jsonb(saved),'items',created);
end $$;
revoke all on function public.os_start_personal_content_topic(uuid,uuid,integer,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.os_start_personal_content_topic(uuid,uuid,integer,jsonb,jsonb)
  to service_role;

commit;
