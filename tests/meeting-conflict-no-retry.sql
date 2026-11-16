-- DEV-only integration body. Runner MUST wrap this file in BEGIN ... ROLLBACK.
-- Synthetic meetings are created through the real RPC; no existing meeting is edited.
create temp table meeting_conflict_checks(name text, ok boolean not null);
grant select,insert on meeting_conflict_checks to authenticated;
do $qa$
declare
  actor uuid; meeting_id uuid; archive_id uuid; result jsonb;
  first_version integer; current_version integer; saved_title text;
  decision_id uuid := gen_random_uuid(); task_id uuid := gen_random_uuid();
  previous_count integer; caught text;
begin
  select id into actor from public.os_profiles
    where is_active and member_kind='staff' and role='admin' order by id limit 1;
  if actor is null then raise exception 'DEV_QA_ACTIVE_STAFF_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  result:=public.os_team_command(jsonb_build_object('action','meeting.create','title','Synthetic conflict QA','brand','브랜디액션','visibility','attendees'));
  meeting_id:=(result->>'id')::uuid; first_version:=(result->>'version')::integer;
  insert into meeting_conflict_checks values('create returns version',first_version>0);
  result:=public.os_team_command(jsonb_build_object('action','meeting.save','id',meeting_id,'expectedVersion',first_version,'title','Synthetic saved QA','content','Synthetic notes only'));
  current_version:=(result->>'version')::integer;
  insert into meeting_conflict_checks values('latest version saves',current_version>first_version);
  begin
    perform public.os_team_command(jsonb_build_object('action','meeting.save','id',meeting_id,'expectedVersion',first_version,'title','Must not overwrite'));
    insert into meeting_conflict_checks values('stale save returns PT409',false);
  exception when others then
    get stacked diagnostics caught=returned_sqlstate;
    insert into meeting_conflict_checks values('stale save returns PT409',caught='PT409' and sqlerrm='OS_VERSION_CONFLICT');
  end;
  insert into meeting_conflict_checks select 'conflict preserves title and version',title='Synthetic saved QA' and version=current_version from public.os_records where id=meeting_id;
  result:=public.os_team_command(jsonb_build_object('action','meeting.start','id',meeting_id,'expectedVersion',current_version));
  current_version:=(result->>'version')::integer;
  result:=public.os_team_command(jsonb_build_object('action','meeting.finish','id',meeting_id,'expectedVersion',current_version));
  current_version:=(result->>'version')::integer;
  insert into meeting_conflict_checks select 'finish reaches review',status='review' from public.os_records where id=meeting_id;
  result:=public.os_team_command(jsonb_build_object('action','meeting.save','id',meeting_id,'expectedVersion',current_version,'items',jsonb_build_array(
    jsonb_build_object('id',decision_id,'kind','decision','text','Synthetic decision','state','accepted','source','manual'),
    jsonb_build_object('id',task_id,'kind','task','text','Synthetic task','state','accepted','source','manual','ownerId',actor)
  )));
  first_version:=current_version;current_version:=(result->>'version')::integer;
  begin
    perform public.os_team_command(jsonb_build_object('action','meeting.review','id',meeting_id,'expectedVersion',first_version));
    insert into meeting_conflict_checks values('stale confirmation returns PT409',false);
  exception when others then
    get stacked diagnostics caught=returned_sqlstate;
    insert into meeting_conflict_checks values('stale confirmation returns PT409',caught='PT409');
  end;
  insert into meeting_conflict_checks select 'stale confirmation creates no work',count(*)=0 from public.os_records where parent_id=meeting_id and record_type in ('decision','task');
  result:=public.os_team_command(jsonb_build_object('action','meeting.review','id',meeting_id,'expectedVersion',current_version));
  insert into meeting_conflict_checks select 'current confirmation finishes',status='done' from public.os_records where id=meeting_id;
  insert into meeting_conflict_checks select 'confirmation creates work once',count(*)=2 from public.os_records where parent_id=meeting_id and record_type in ('decision','task');
  begin
    perform public.os_team_command(jsonb_build_object('action','meeting.review','id',meeting_id,'expectedVersion',current_version));
    insert into meeting_conflict_checks values('duplicate stale confirmation returns PT409',false);
  exception when others then
    get stacked diagnostics caught=returned_sqlstate;
    insert into meeting_conflict_checks values('duplicate stale confirmation returns PT409',caught='PT409');
  end;
  insert into meeting_conflict_checks select 'duplicate creates no extra work',count(*)=2 from public.os_records where parent_id=meeting_id and record_type in ('decision','task');
  result:=public.os_team_command(jsonb_build_object('action','meeting.create','title','Synthetic archive QA','brand','브랜디액션','visibility','attendees'));
  archive_id:=(result->>'id')::uuid; current_version:=(result->>'version')::integer;
  begin
    perform public.os_team_archive_meeting(archive_id,current_version+99,'Synthetic QA');
    insert into meeting_conflict_checks values('stale archive returns PT409',false);
  exception when others then
    get stacked diagnostics caught=returned_sqlstate;
    insert into meeting_conflict_checks values('stale archive returns PT409',caught='PT409');
  end;
  insert into meeting_conflict_checks select 'stale archive leaves record active',archived_at is null from public.os_records where id=archive_id;
  result:=public.os_team_archive_meeting(archive_id,current_version,'Synthetic QA');
  insert into meeting_conflict_checks values('current archive works',(result->>'archived')::boolean);
  execute 'reset role';
  insert into meeting_conflict_checks values('anonymous cannot execute',
    not has_function_privilege('anon','public.os_team_command(jsonb)','execute')
    and not has_function_privilege('anon','public.os_team_archive_meeting(uuid,integer,text)','execute'));
  if exists(select 1 from meeting_conflict_checks where not ok) then
    raise exception 'DEV_MEETING_QA_FAILED: %',(select string_agg(name,', ') from meeting_conflict_checks where not ok);
  end if;
end
$qa$;
select jsonb_build_object('checks',count(*),'failures',count(*) filter(where not ok),'results',jsonb_agg(to_jsonb(c))) as result from meeting_conflict_checks c;
