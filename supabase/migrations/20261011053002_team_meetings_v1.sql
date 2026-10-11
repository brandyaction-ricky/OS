-- Additive team command facade. Existing workspace functions, rows and policies stay intact.
-- Review in a local database first; DEV/Production application requires separate approval.
create function public.os_team_title_similarity(a text, b text) returns numeric
language sql immutable set search_path='' as $$
  with first_words as (
    select distinct word from pg_catalog.regexp_split_to_table(pg_catalog.lower(pg_catalog.regexp_replace(coalesce(a,''),'회의|[0-9]+',' ','g')),'[^[:alnum:]가-힣]+') word where word<>''
  ), second_words as (
    select distinct word from pg_catalog.regexp_split_to_table(pg_catalog.lower(pg_catalog.regexp_replace(coalesce(b,''),'회의|[0-9]+',' ','g')),'[^[:alnum:]가-힣]+') word where word<>''
  ), union_words as (select word from first_words union select word from second_words),
  shared_words as (select word from first_words intersect select word from second_words)
  select case when (select count(*) from union_words)=0 then case when pg_catalog.btrim(coalesce(a,''))=pg_catalog.btrim(coalesce(b,'')) then 1 else 0 end
    else (select count(*) from shared_words)::numeric / (select count(*) from union_words)::numeric end
$$;
revoke all on function public.os_team_title_similarity(text,text) from public,anon;
grant execute on function public.os_team_title_similarity(text,text) to authenticated;

create function public.os_team_command(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  a text := p->>'action'; u uuid := auth.uid(); rid uuid := nullif(p->>'id','')::uuid;
  m public.os_records; d public.os_records; previous public.os_records; moving public.os_records;
  result jsonb; item jsonb; cleaned jsonb := '[]'::jsonb; open_items jsonb := '[]'::jsonb;
  new_items jsonb := '[]'::jsonb; brand_value text; project_id uuid;
  expected integer := nullif(p->>'expectedVersion','')::integer; merge_ids uuid[];
  reason text := btrim(coalesce(p->>'reason','')); replacement_id uuid;
begin
  if u is null or not public.os_is_active_member() then raise exception 'OS_ACTIVE_USER_REQUIRED' using errcode='42501'; end if;
  if octet_length(p::text)>2000000 then raise exception 'OS_COMMAND_TOO_LARGE' using errcode='22023'; end if;
  if a not in ('meeting.create','meeting.save','meeting.start','meeting.finish','meeting.review','meeting.correct','meeting.import_legacy','meeting.merge_legacy','decision.supersede','decision.drop','task.merge')
    then raise exception 'OS_UNKNOWN_COMMAND' using errcode='22023'; end if;
  if p ? 'brand' then
    brand_value := p->>'brand';
    if brand_value not in ('마이인','브랜디액션 에듀','브랜디액션') then raise exception 'OS_BRAND_INVALID' using errcode='22023'; end if;
  end if;
  if p ? 'projectId' and nullif(p->>'projectId','') is not null then
    project_id := (p->>'projectId')::uuid;
    if not exists(select 1 from public.os_records where id=project_id and record_type='project' and archived_at is null)
      then raise exception 'OS_PROJECT_INVALID' using errcode='22023'; end if;
  end if;

  if a='task.merge' then
    if rid is null or nullif(p->>'targetId','') is null or rid=(p->>'targetId')::uuid
      then raise exception 'OS_TASK_MERGE_INVALID' using errcode='22023'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      least(rid,(p->>'targetId')::uuid)::text||greatest(rid,(p->>'targetId')::uuid)::text,0));
    select * into d from public.os_records where id=rid and record_type='task' and archived_at is null for update;
    select * into m from public.os_records where id=(p->>'targetId')::uuid and record_type='task' and archived_at is null for update;
    if d.id is null or m.id is null or d.version is distinct from expected or m.version is distinct from nullif(p->>'targetVersion','')::integer
      then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
    if not(d.owner_id=u or d.assignee_id=u or public.os_is_admin()) or not(m.owner_id=u or m.assignee_id=u or public.os_is_admin())
      then raise exception 'OS_TASK_MERGE_DENIED' using errcode='42501'; end if;
    if d.brand is distinct from m.brand or m.status in ('done','cancelled') or public.os_team_title_similarity(d.title,m.title)<0.6
      then raise exception 'OS_TASK_MERGE_INVALID' using errcode='22023'; end if;
    update public.os_records set metadata=jsonb_set(metadata,'{mergedFrom}',coalesce(metadata->'mergedFrom','[]'::jsonb)||jsonb_build_array(d.id)),updated_by=u
      where id=m.id returning * into m;
    update public.os_records set archived_at=now(),metadata=metadata||jsonb_build_object('mergedIntoTask',m.id),updated_by=u where id=d.id;
    insert into public.os_record_events(record_id,actor_id,event_type,note,snapshot)
      values(m.id,u,'task_merge',left('중복 업무 병합: '||d.title,4000),to_jsonb(m));
    return jsonb_build_object('id',m.id,'version',m.version);
  end if;

  if a='meeting.create' then
    if brand_value is null then raise exception 'OS_BRAND_REQUIRED' using errcode='22023'; end if;
    result := public.os_knowledge_workflow_command(p);
    rid := (result->>'id')::uuid;
    select * into m from public.os_records where id=rid for update;
    perform pg_catalog.set_config('os.workspace_meeting_ok','1',true);
    update public.os_records set brand=brand_value,
      metadata=case when project_id is not null then jsonb_set(metadata,'{projectId}',to_jsonb(project_id)) else metadata end,
      updated_by=u where id=rid returning * into m;
    if nullif(p->>'previousMeetingId','') is not null then
      select * into previous from public.os_records where id=(p->>'previousMeetingId')::uuid;
      select coalesce(jsonb_agg((value - 'id') || jsonb_build_object('id',gen_random_uuid(),'state','pending')),'[]'::jsonb)
        into open_items from jsonb_array_elements(coalesce(previous.metadata->'items','[]'::jsonb))
        where value->>'kind'='open' and value->>'state'<>'discarded';
      if jsonb_array_length(open_items)>0 then
        update public.os_records set metadata=jsonb_set(metadata,'{items}',coalesce(metadata->'items','[]'::jsonb)||open_items),updated_by=u
          where id=rid returning * into m;
      end if;
    end if;
    perform pg_catalog.set_config('os.workspace_meeting_ok','',true);
    return jsonb_build_object('id',rid,'version',m.version);
  end if;

  if a in ('meeting.save','meeting.start','meeting.finish','meeting.review','meeting.correct') then
    select * into m from public.os_records where id=rid and record_type='meeting' and metadata->>'workspace'='knowledge' and archived_at is null for update;
    if not found or not public.os_can_read_meeting_record(rid) then raise exception 'OS_MEETING_NOT_FOUND' using errcode='P0002'; end if;
    if m.version is distinct from expected then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
    if (p ? 'brand' or p ? 'projectId') and not(m.owner_id=u or public.os_is_admin())
      then raise exception 'OS_MEETING_OWNER_REQUIRED' using errcode='42501'; end if;
    if a='meeting.save' and p ? 'items' then
      if jsonb_typeof(p->'items')<>'array' or jsonb_array_length(p->'items')>100 then raise exception 'OS_MEETING_ITEMS_INVALID' using errcode='22023'; end if;
      for item in select value from jsonb_array_elements(p->'items') loop
        if item->>'kind' not in ('decision','task','open') or item->>'state' not in ('pending','accepted','discarded')
          or length(btrim(coalesce(item->>'text','')))=0 then raise exception 'OS_MEETING_ITEM_INVALID' using errcode='22023'; end if;
        if item->>'kind'='task' and nullif(item->>'ownerId','') is not null and not exists (
          select 1 from public.os_profiles where id=(item->>'ownerId')::uuid and is_active and member_kind<>'partner' and not coalesce(is_shared_account,false)
        ) then raise exception 'OS_MEETING_ASSIGNEE_INVALID' using errcode='22023'; end if;
        if item->>'kind'<>'open' then cleaned:=cleaned||jsonb_build_array(item); end if;
      end loop;
      result:=public.os_knowledge_workflow_command((p-'items')||jsonb_build_object('items',cleaned));
    elsif a='meeting.review' then
      if p ? 'mergeTasks' then
        if jsonb_typeof(p->'mergeTasks')<>'array' then raise exception 'OS_MEETING_MERGE_INVALID' using errcode='22023'; end if;
        for item in select value from jsonb_array_elements(p->'mergeTasks') loop
          if not exists(select 1 from jsonb_array_elements(coalesce(m.metadata->'items','[]'::jsonb)) candidate
            where candidate->>'id'=item->>'itemId' and candidate->>'kind'='task' and candidate->>'state'='discarded')
            then raise exception 'OS_MEETING_MERGE_INVALID' using errcode='22023'; end if;
          select * into d from public.os_records where id=(item->>'taskId')::uuid and record_type='task' and archived_at is null and status not in ('done','cancelled') for update;
          if not found or not(d.owner_id=u or d.assignee_id=u or public.os_is_admin()) or d.brand is distinct from m.brand or public.os_team_title_similarity(d.title,
            (select candidate->>'text' from jsonb_array_elements(m.metadata->'items') candidate where candidate->>'id'=item->>'itemId' limit 1)) < 0.6
            then raise exception 'OS_MEETING_MERGE_INVALID' using errcode='22023'; end if;
          update public.os_records set metadata=jsonb_set(metadata,'{mergedMeetingCandidates}',coalesce(metadata->'mergedMeetingCandidates','[]'::jsonb)||jsonb_build_array(jsonb_build_object('meetingId',m.id,'itemId',item->>'itemId'))),updated_by=u where id=d.id;
        end loop;
      end if;
      for item in select value from jsonb_array_elements(coalesce(m.metadata->'items','[]'::jsonb)) loop
        if item->>'kind'='open' then open_items:=open_items||jsonb_build_array(item||jsonb_build_object('state','pending'));
        else cleaned:=cleaned||jsonb_build_array(item); end if;
      end loop;
      if jsonb_array_length(open_items)>0 then
        perform pg_catalog.set_config('os.workspace_meeting_ok','1',true);
        update public.os_records set metadata=jsonb_set(metadata,'{items}',cleaned),updated_by=u where id=rid returning * into m;
        perform pg_catalog.set_config('os.workspace_meeting_ok','',true);
      end if;
      result:=public.os_knowledge_workflow_command(p||jsonb_build_object('expectedVersion',m.version));
    else
      result:=public.os_knowledge_workflow_command(p);
    end if;
    select * into m from public.os_records where id=rid;
    if (a='meeting.save' and p ? 'items') or (a='meeting.review' and jsonb_array_length(open_items)>0) or p ? 'brand' or p ? 'projectId' then
      perform pg_catalog.set_config('os.workspace_meeting_ok','1',true);
      update public.os_records set
        brand=coalesce(brand_value,brand),
        metadata=(case when a='meeting.save' and p ? 'items' then jsonb_set(metadata,'{items}',p->'items')
          when a='meeting.review' and jsonb_array_length(open_items)>0 then jsonb_set(metadata,'{items}',coalesce(metadata->'items','[]'::jsonb)||open_items)
          else metadata end),updated_by=u where id=rid returning * into m;
      if p ? 'projectId' then
        update public.os_records set metadata=case when project_id is null then metadata-'projectId' else jsonb_set(metadata,'{projectId}',to_jsonb(project_id)) end,
          updated_by=u where id=rid returning * into m;
      end if;
      perform pg_catalog.set_config('os.workspace_meeting_ok','',true);
    end if;
    if a='meeting.review' then
      perform pg_catalog.set_config('os.workspace_meeting_ok','1',true);
      update public.os_records set brand=m.brand,
        metadata=case when m.metadata ? 'projectId' then jsonb_set(metadata,'{projectId}',m.metadata->'projectId') else metadata end,
        updated_by=u where parent_id=rid and record_type in ('decision','task') and metadata->>'workspace'='knowledge' and brand is distinct from m.brand;
      perform pg_catalog.set_config('os.workspace_meeting_ok','',true);
    end if;
    return jsonb_build_object('id',rid,'version',m.version);
  end if;

  if a='meeting.import_legacy' then
    select * into previous from public.os_records where id=(p->>'legacyId')::uuid and record_type='meeting' and metadata->>'workspace' is distinct from 'knowledge' and archived_at is null for update;
    if not found or previous.metadata ? 'migratedTo' or previous.status<>'active' or not(previous.owner_id=u or public.os_is_admin())
      then raise exception 'OS_LEGACY_IMPORT_DENIED' using errcode='42501'; end if;
    if coalesce(nullif(previous.metadata->>'summary',''),nullif(previous.metadata->>'transcript',''),nullif(previous.description,''),'')=''
      or exists(select 1 from public.os_records where parent_id=previous.id and record_type in ('decision','task') and archived_at is null)
      then raise exception 'OS_LEGACY_IMPORT_INVALID' using errcode='22023'; end if;
    brand_value:=coalesce(brand_value,previous.brand);
    if brand_value not in ('마이인','브랜디액션 에듀','브랜디액션') then raise exception 'OS_BRAND_INVALID' using errcode='22023'; end if;
    result:=public.os_team_command(jsonb_build_object('action','meeting.create','title',previous.title,'startsAt',previous.starts_at,'brand',brand_value));
    rid:=(result->>'id')::uuid;
    perform pg_catalog.set_config('os.workspace_meeting_ok','1',true);
    update public.os_records set status='review',description=coalesce(nullif(previous.metadata->>'transcript',''),previous.description),
      metadata=metadata||jsonb_build_object('summary',coalesce(previous.metadata->>'summary',''),'agenda',previous.description,'legacySourceId',previous.id),updated_by=u
      where id=rid returning * into m;
    update public.os_records set metadata=metadata||jsonb_build_object('migratedTo',rid),updated_by=u where id=previous.id;
    perform pg_catalog.set_config('os.workspace_meeting_ok','',true);
    insert into public.os_meeting_attendees(meeting_id,user_id,added_by) values(rid,previous.created_by,u) on conflict do nothing;
    insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail)
      values(u,'meeting_import_legacy','meeting',rid,jsonb_build_object('legacyId',previous.id));
    return jsonb_build_object('id',rid,'version',m.version);
  end if;

  if a='meeting.merge_legacy' then
    if jsonb_typeof(p->'mergeTaskIds') is distinct from 'array' then raise exception 'OS_MERGE_REVIEW_REQUIRED' using errcode='22023'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      least((p->>'keeperId')::uuid,(p->>'otherId')::uuid)::text||greatest((p->>'keeperId')::uuid,(p->>'otherId')::uuid)::text,0));
    select * into m from public.os_records where id=(p->>'keeperId')::uuid and record_type='meeting' and metadata->>'workspace' is distinct from 'knowledge' and archived_at is null for update;
    select * into previous from public.os_records where id=(p->>'otherId')::uuid and record_type='meeting' and metadata->>'workspace' is distinct from 'knowledge' and archived_at is null for update;
    if m.id is null or previous.id is null or m.id=previous.id or not(m.owner_id=u or public.os_is_admin()) or not(previous.owner_id=u or public.os_is_admin())
      then raise exception 'OS_MERGE_DENIED' using errcode='42501'; end if;
    if m.version is distinct from nullif(p->>'keeperVersion','')::integer or previous.version is distinct from nullif(p->>'otherVersion','')::integer
      then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
    if coalesce(m.metadata->>'migratedTo','')<>'' or coalesce(previous.metadata->>'migratedTo','')<>''
      or (case when replace(coalesce(m.brand,''),' ','') in ('브랜디에듀','브랜디액션에듀') then '브랜디액션에듀' else replace(coalesce(m.brand,''),' ','') end)
        is distinct from (case when replace(coalesce(previous.brand,''),' ','') in ('브랜디에듀','브랜디액션에듀') then '브랜디액션에듀' else replace(coalesce(previous.brand,''),' ','') end)
      or (m.starts_at at time zone 'Asia/Seoul')::date is distinct from (previous.starts_at at time zone 'Asia/Seoul')::date
      then raise exception 'OS_MERGE_INVALID' using errcode='22023'; end if;
    select coalesce(array_agg(value::uuid),'{}'::uuid[]) into merge_ids from jsonb_array_elements_text(p->'mergeTaskIds');
    for moving in select * from public.os_records where record_type in ('decision','task') and archived_at is null
      and (parent_id=previous.id or metadata->>'meetingId'=previous.id::text) for update loop
      if moving.record_type='task' and exists(select 1 from public.os_records existing where existing.record_type='task' and existing.archived_at is null
        and (existing.parent_id=m.id or existing.metadata->>'meetingId'=m.id::text) and public.os_team_title_similarity(existing.title,moving.title)>=0.6) then
        if moving.id<>all(merge_ids) then raise exception 'OS_MERGE_TASK_REVIEW_REQUIRED' using errcode='22023'; end if;
        update public.os_records set archived_at=now(),metadata=metadata||jsonb_build_object('mergedIntoMeeting',m.id),updated_by=u where id=moving.id;
      else
        update public.os_records set parent_id=m.id,metadata=case when metadata ? 'meetingId' then jsonb_set(metadata,'{meetingId}',to_jsonb(m.id::text)) else metadata end,updated_by=u where id=moving.id;
      end if;
    end loop;
    update public.os_records set archived_at=now(),metadata=metadata||jsonb_build_object('mergedInto',m.id),updated_by=u where id=previous.id;
    insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail)
      values(u,'meeting_merge_legacy','meeting',m.id,jsonb_build_object('mergedId',previous.id,'mergedTaskIds',to_jsonb(merge_ids)));
    select * into m from public.os_records where id=m.id;
    return jsonb_build_object('id',m.id,'version',m.version);
  end if;

  select * into d from public.os_records where id=rid and record_type='decision' and status in ('confirmed','decided') and archived_at is null for update;
  if not found or d.version is distinct from expected then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
  select * into m from public.os_records where id=coalesce(d.parent_id,nullif(d.metadata->>'meetingId','')::uuid) and record_type='meeting' and archived_at is null;
  if not found or not(m.owner_id=u or public.os_is_admin()) or not public.os_can_read_meeting_record(m.id)
    then raise exception 'OS_DECISION_DENIED' using errcode='42501'; end if;
  if length(reason)=0 then raise exception 'OS_REASON_REQUIRED' using errcode='22023'; end if;
  perform pg_catalog.set_config('os.workspace_meeting_ok','1',true);
  if a='decision.supersede' then
    if length(btrim(coalesce(p->>'text',''))) not between 1 and 240 then raise exception 'OS_DECISION_INVALID' using errcode='22023'; end if;
    insert into public.os_records(record_type,title,description,status,parent_id,brand,team,owner_id,created_by,updated_by,metadata)
      values('decision',btrim(p->>'text'),btrim(p->>'text'),'confirmed',m.id,d.brand,d.team,u,u,u,
        jsonb_build_object('workspace','knowledge','replaces',d.id,'confirmedAt',now(),'confirmedBy',u)) returning id into replacement_id;
    update public.os_records set status='superseded',metadata=metadata||jsonb_build_object('replacedBy',replacement_id,'supersededReason',reason),updated_by=u where id=d.id;
  else
    update public.os_records set status='cancelled',metadata=metadata||jsonb_build_object('dropReason',reason,'droppedAt',now()),updated_by=u where id=d.id;
  end if;
  update public.os_records set metadata=jsonb_set(metadata,'{corrections}',coalesce(metadata->'corrections','[]'::jsonb)||jsonb_build_array(
    jsonb_build_object('text',case when a='decision.supersede' then p->>'text' else d.title end,'reason',reason,'at',now(),'by',u)))
    where id=m.id and metadata->>'workspace'='knowledge';
  perform pg_catalog.set_config('os.workspace_meeting_ok','',true);
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail)
    values(u,replace(a,'.','_'),'meeting',m.id,jsonb_build_object('decisionId',d.id,'replacementId',replacement_id));
  return jsonb_build_object('id',d.id,'replacementId',replacement_id);
end $$;
revoke all on function public.os_team_command(jsonb) from public,anon;
grant execute on function public.os_team_command(jsonb) to authenticated;
