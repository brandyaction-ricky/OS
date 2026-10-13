-- Candidate integration test for 20261013020000_fast_document_record_rls.
-- NOT run by npm test. Run only on a DEV database that has the migration:
--   supabase db query --project-ref <dev-ref> --linked -f tests/fast-document-rls-equivalence.sql
-- For every active member (and an anonymous caller) it compares what the new
-- row policies return with the verdict of the original functions, which stay
-- in place. Synthetic fixtures cover parent chains, private parents, cycles,
-- self/dangling parents, attendee-only meetings and their decisions/documents,
-- archived states, MCP sources, partner categories and admin note grants. The final block always
-- raises, so the whole transaction rolls back. Expect "mismatches=0".
begin;
set local statement_timeout = '170s';
set local lock_timeout = '5s';
create temp table eq_info(k text, v text);
create temp table vis(phase text, uid uuid, kind text, id uuid);
grant select, insert on eq_info, vis to authenticated;

do $$
declare
  staff1 uuid; staff2 uuid; partner uuid; adm uuid; granted uuid := gen_random_uuid(); expired uuid := gen_random_uuid();
  cat uuid := gen_random_uuid(); mtg uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  priv uuid := gen_random_uuid(); under_priv uuid := gen_random_uuid();
  cy1 uuid := gen_random_uuid(); cy2 uuid := gen_random_uuid(); selfp uuid := gen_random_uuid();
  dang uuid := gen_random_uuid(); mdoc uuid := gen_random_uuid(); arch uuid := gen_random_uuid();
  arch_d uuid := gen_random_uuid(); mcp uuid := gen_random_uuid(); pcat uuid := gen_random_uuid();
  dec uuid := gen_random_uuid();
  f text := '';
begin
  select id into staff1 from public.os_profiles where is_active and role<>'admin' and member_kind='staff' order by id limit 1;
  select id into staff2 from public.os_profiles where is_active and role<>'admin' and member_kind='staff' and id<>staff1 order by id limit 1;
  select id into partner from public.os_profiles where is_active and role<>'admin' and id not in (staff1,staff2) order by id limit 1;
  select id into adm from public.os_profiles where is_active and role='admin' order by id limit 1;
  update public.os_profiles set member_kind='partner' where id=partner;
  begin execute 'set local session_replication_role = replica'; f:=f||' triggers_off'; exception when others then f:=f||' -triggers_off('||sqlerrm||')'; end;
  begin insert into public.os_doc_categories(id,space,name,partner_ids,created_by) values (cat,'team','eq partner cat',array[partner],staff1); f:=f||' cat'; exception when others then f:=f||' -cat('||sqlerrm||')'; end;
  begin insert into public.os_records(id,record_type,title,status,owner_id,created_by,updated_by,metadata) values (mtg,'meeting','eq meeting','planned',staff1,staff1,staff1,'{"workspace":"knowledge","visibility":"attendees"}');
        insert into public.os_meeting_attendees(meeting_id,user_id,added_by) values (mtg,staff1,staff1); f:=f||' meeting'; exception when others then f:=f||' -meeting('||sqlerrm||')'; end;
  begin insert into public.os_records(id,record_type,title,status,owner_id,created_by,updated_by,parent_id) values (dec,'decision','eq decision','decided',staff1,staff1,staff1,mtg); f:=f||' meeting_decision'; exception when others then f:=f||' -meeting_decision('||sqlerrm||')'; end;
  begin insert into public.os_documents(id,title,content_md,status,owner_id) values (a,'eq a','','team',staff1),(b,'eq b','','team',staff1),(c,'eq c','','canonical',staff1);
        update public.os_documents set parent_document_id=a where id=b; update public.os_documents set parent_document_id=b where id=c; f:=f||' chain'; exception when others then f:=f||' -chain('||sqlerrm||')'; end;
  begin insert into public.os_documents(id,title,content_md,status,owner_id) values (priv,'eq priv','','draft',staff2),(under_priv,'eq under priv','','team',staff2);
        update public.os_documents set parent_document_id=priv where id=under_priv; f:=f||' under_private'; exception when others then f:=f||' -under_private('||sqlerrm||')'; end;
  begin insert into public.os_documents(id,title,content_md,status,owner_id) values (cy1,'eq cy1','','team',staff1),(cy2,'eq cy2','','team',staff1);
        update public.os_documents set parent_document_id=cy2 where id=cy1; update public.os_documents set parent_document_id=cy1 where id=cy2; f:=f||' cycle'; exception when others then f:=f||' -cycle('||sqlerrm||')'; end;
  begin insert into public.os_documents(id,title,content_md,status,owner_id) values (selfp,'eq self','','team',staff1);
        update public.os_documents set parent_document_id=selfp where id=selfp; f:=f||' self_parent'; exception when others then f:=f||' -self_parent('||sqlerrm||')'; end;
  begin insert into public.os_documents(id,title,content_md,status,owner_id,parent_document_id) values (dang,'eq dangling','','team',staff1,gen_random_uuid()); f:=f||' dangling'; exception when others then f:=f||' -dangling('||sqlerrm||')'; end;
  begin insert into public.os_documents(id,title,content_md,status,owner_id,meeting_record_id) values (mdoc,'eq meeting doc','','team',staff1,mtg); f:=f||' meeting_doc'; exception when others then f:=f||' -meeting_doc('||sqlerrm||')'; end;
  begin insert into public.os_documents(id,title,content_md,status,owner_id,archived_from_status,archived_by,archived_at) values (arch,'eq archived team','','archived',staff1,'team',staff2,now()),(arch_d,'eq archived draft','','archived',staff1,'draft',staff1,now()); f:=f||' archived'; exception when others then f:=f||' -archived('||sqlerrm||')'; end;
  begin insert into public.os_documents(id,title,content_md,status,owner_id,source) values (mcp,'eq mcp team','','team',staff1,'mcp'); f:=f||' mcp'; exception when others then f:=f||' -mcp('||sqlerrm||')'; end;
  begin insert into public.os_documents(id,title,content_md,status,owner_id,category_id) values (pcat,'eq partner category doc','','team',staff1,cat); f:=f||' partner_category'; exception when others then f:=f||' -partner_category('||sqlerrm||')'; end;
  begin execute 'set local session_replication_role = origin'; exception when others then null; end;
  begin insert into public.os_documents(id,title,content_md,status,owner_id) values (granted,'eq granted draft','','draft',staff2),(expired,'eq expired grant draft','','draft',staff2);
        insert into public.os_note_access_grants(document_id,admin_id,reason,created_at,expires_at) values (granted,adm,'eq',now(),now()+interval '1 hour'),(expired,adm,'eq',now()-interval '2 hours',now()-interval '1 hour'); f:=f||' note_grants'; exception when others then f:=f||' -note_grants('||sqlerrm||')'; end;
  insert into eq_info values ('fixtures',f);
end $$;

create or replace function pg_temp.eq_capture(p_phase text) returns void language plpgsql as $$
declare u record; t0 timestamptz;
begin
  for u in select id from public.os_profiles where is_active union all select null loop
    perform set_config('request.jwt.claims', case when u.id is null then '{}' else json_build_object('sub',u.id,'role','authenticated')::text end, true);
    execute 'set local role authenticated';
    t0 := clock_timestamp();
    insert into vis select p_phase, u.id, 'doc', id from public.os_documents;
    insert into eq_info values (p_phase||' doc ms', round(extract(epoch from clock_timestamp()-t0)*1000)::text);
    t0 := clock_timestamp();
    insert into vis select p_phase, u.id, 'rec', id from public.os_records;
    insert into eq_info values (p_phase||' rec ms', round(extract(epoch from clock_timestamp()-t0)*1000)::text);
    execute 'reset role';
  end loop;
end $$;
select pg_temp.eq_capture('new');
do $$ declare u record; begin
  for u in select id from public.os_profiles where is_active union all select null loop
    perform set_config('request.jwt.claims', case when u.id is null then '{}' else json_build_object('sub',u.id,'role','authenticated')::text end, true);
    insert into vis select 'old', u.id, 'doc', d.id from public.os_documents d
      where coalesce(public.os_workspace_page_read(d.id),false) and coalesce(public.os_can_read_document(d.owner_id,d.status,d.team),false);
    insert into vis select 'old', u.id, 'rec', r.id from public.os_records r
      where r.record_type<>'notification' and coalesce(public.os_workspace_record_read(r.id),false)
        and coalesce(public.os_is_active_member() and ((r.record_type <> all (array['expense','contract','subscription','company_document'])) or public.os_has_finance_access()),false)
        and ((r.record_type <> 'content_package') or (coalesce(r.metadata->>'packageKind','') <> all (array['copy_decision_evidence','publication_copy_observation','claim_evidence'])) or r.owner_id=auth.uid() or (btrim(r.team)<>'' and btrim(r.team)=btrim(public.os_my_team())))
        and (coalesce(r.metadata->>'space','')<>'personal' or r.owner_id=auth.uid());
  end loop; end $$;

do $$
declare s text;
begin
  select string_agg(line, ' | ') into s from (
    select 'fixtures:'||v line from eq_info where k='fixtures'
    union all select kind||' visible old='||count(*) filter (where phase='old')||' new='||count(*) filter (where phase='new') from vis group by kind
    union all select k.kind||' mismatches='||(select count(*) from (
      (select uid,id from vis where phase='old' and kind=k.kind except select uid,id from vis where phase='new' and kind=k.kind)
      union all (select uid,id from vis where phase='new' and kind=k.kind except select uid,id from vis where phase='old' and kind=k.kind)) m) from (values ('doc'),('rec')) k(kind)
    union all select 'users='||count(distinct coalesce(uid::text,'anon')) from vis
    union all select k||' total='||sum(v::int) from eq_info where k like '% ms' group by k
  ) x;
  raise exception 'EQ_RESULT %', s;
end $$;
