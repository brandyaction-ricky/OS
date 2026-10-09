-- Company-document workspace. Additive candidate only; requires separate DB approval.
-- No seed, backfill, cron activation, policy removal or business-data rewrite.
alter table public.os_profiles add column if not exists member_kind text not null default 'staff' check (member_kind in ('staff','partner'));

create table public.os_doc_categories (
  id uuid primary key default gen_random_uuid(), space text not null check(space in ('mine','team')),
  owner_id uuid references public.os_profiles(id), name text not null check(length(btrim(name)) between 1 and 20),
  color text not null default 'blue' check(color in ('gray','brown','orange','yellow','green','blue','purple','pink','red')),
  sort_order integer not null default 0, partner_ids uuid[] not null default '{}',
  created_by uuid not null references public.os_profiles(id), updated_by uuid references public.os_profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  check ((space='mine' and owner_id is not null and cardinality(partner_ids)=0) or (space='team' and owner_id is null))
);
create unique index os_doc_categories_active_name on public.os_doc_categories(space,coalesce(owner_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(btrim(name))) where archived_at is null;
create index os_doc_categories_owner on public.os_doc_categories(owner_id,sort_order) where archived_at is null;
create index os_doc_categories_partners on public.os_doc_categories using gin(partner_ids) where archived_at is null;

alter table public.os_documents
  add column if not exists category_id uuid references public.os_doc_categories(id),
  add column if not exists work_state text not null default 'todo' check(work_state in ('todo','doing','done')),
  add column if not exists due_on date,
  add column if not exists daily_on date,
  add column if not exists review_due_on date,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.os_profiles(id),
  add column if not exists archived_from_status public.os_doc_status,
  add column if not exists retention_hold boolean not null default false,
  add column if not exists meeting_record_id uuid references public.os_records(id);
create unique index os_documents_daily_owner on public.os_documents(owner_id,daily_on) where daily_on is not null and status <> 'archived';
create index os_documents_category on public.os_documents(category_id,updated_at desc);
create index os_documents_meeting on public.os_documents(meeting_record_id) where meeting_record_id is not null;
create index os_documents_review_due on public.os_documents(review_due_on) where status='canonical';
create index os_documents_trash_date on public.os_documents(archived_at) where status='archived';

create table public.os_document_pins (
  user_id uuid not null references public.os_profiles(id), document_id uuid not null references public.os_documents(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(user_id,document_id)
);
create table public.os_document_drafts (
  document_id uuid not null references public.os_documents(id) on delete cascade, user_id uuid not null references public.os_profiles(id),
  title text not null default '', content_md text not null default '', base_version integer not null check(base_version>0),
  updated_at timestamptz not null default now(), primary key(document_id,user_id),
  check(length(title)<=300 and length(content_md)<=1500000)
);
create index os_document_drafts_user on public.os_document_drafts(user_id,updated_at desc);
create table public.os_note_inbox (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.os_profiles(id),
  body text not null check(length(btrim(body)) between 1 and 500), created_at timestamptz not null default now(),
  processed_at timestamptz, processed_document_id uuid references public.os_documents(id) on delete set null
);
create index os_note_inbox_owner on public.os_note_inbox(owner_id,created_at desc) where processed_at is null;
create table public.os_doc_templates (
  id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 40), description text not null default '',
  body_md text not null default '', default_space text not null check(default_space in ('mine','team','meeting')),
  kind text not null default 'doc' check(kind in ('doc','meeting','candidate')), scope text not null check(scope in ('company','personal')),
  owner_id uuid references public.os_profiles(id), sort_order integer not null default 0,
  created_by uuid not null references public.os_profiles(id), updated_by uuid references public.os_profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  check((scope='personal' and owner_id is not null) or (scope='company' and owner_id is null))
);
create index os_doc_templates_owner on public.os_doc_templates(owner_id,sort_order);
create table public.os_knowledge_events (
  id bigint generated always as identity primary key, actor_id uuid references public.os_profiles(id), agent_key_id uuid references public.os_agent_keys(id),
  action text not null, target_type text not null check(target_type in ('document','category','template','meeting','proposal','candidate','link')),
  target_id uuid, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create index os_knowledge_events_actor on public.os_knowledge_events(actor_id,created_at desc,id desc);
create index os_knowledge_events_target on public.os_knowledge_events(target_type,target_id,created_at desc);
create table public.os_document_candidates (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references public.os_documents(id),
  requested_approver_id uuid not null references public.os_profiles(id), target_folder text not null default '',
  steward_id uuid references public.os_profiles(id), review_due_on date not null,
  submitted_by uuid not null references public.os_profiles(id), submitted_at timestamptz not null default now(),
  status text not null default 'open' check(status in ('open','approved','returned','withdrawn')),
  decided_by uuid references public.os_profiles(id), decided_at timestamptz, decision_note text not null default '', proxy boolean not null default false,
  check(requested_approver_id<>submitted_by)
);
create unique index os_document_candidates_open on public.os_document_candidates(document_id) where status='open';
create index os_document_candidates_reviewer on public.os_document_candidates(requested_approver_id,status,submitted_at desc);
create table public.os_meeting_attendees (
  meeting_id uuid not null references public.os_records(id) on delete cascade, user_id uuid not null references public.os_profiles(id),
  added_by uuid not null references public.os_profiles(id), added_at timestamptz not null default now(), primary key(meeting_id,user_id)
);
create index os_meeting_attendees_user on public.os_meeting_attendees(user_id,meeting_id);
alter table public.os_doc_templates add column default_key text unique check(default_key ~ '^default-([1-9]|10)$');
create table public.os_note_access_grants (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references public.os_documents(id) on delete cascade,
  admin_id uuid not null references public.os_profiles(id), reason text not null check(length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  check(expires_at>created_at and expires_at<=created_at+interval '24 hours')
);
create index os_note_access_grants_lookup on public.os_note_access_grants(admin_id,document_id,expires_at);

alter table public.os_document_proposals
  add column if not exists requested_approver_id uuid references public.os_profiles(id),
  add column if not exists return_kind text check(return_kind in ('revise','reject')),
  add column if not exists author_note text not null default '',
  add column if not exists proxy_reason text not null default '',
  add column if not exists rebased_from_version integer,
  add column if not exists ai_assist text not null default '',
  add column if not exists review_due_on date;

create function public.os_is_partner() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.os_profiles where id=auth.uid() and is_active and member_kind='partner')
$$;
create function public.os_is_staff() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.os_profiles where id=auth.uid() and is_active and member_kind='staff')
$$;
create function public.os_has_note_access(p_document uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.os_is_admin() and exists(select 1 from public.os_note_access_grants where document_id=p_document and admin_id=auth.uid() and expires_at>now())
$$;
create function public.os_can_read_meeting_record(p_meeting uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.os_is_active_member() and exists (
    select 1 from public.os_records m where m.id=p_meeting and m.record_type='meeting' and m.archived_at is null
      and (exists(select 1 from public.os_meeting_attendees a where a.meeting_id=m.id and a.user_id=auth.uid())
        or (public.os_is_staff() and coalesce(m.metadata->>'visibility','attendees')='team'))
  )
$$;
create function public.os_workspace_document_read(p_document uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.os_is_active_member() and exists (
    select 1 from public.os_documents d where d.id=p_document and case
      when public.os_is_partner() and d.source='mcp' and (case when d.status='archived' then coalesce(d.archived_from_status,'draft') else d.status end)<>'canonical' then false
      when d.meeting_record_id is not null and not public.os_can_read_meeting_record(d.meeting_record_id) then false
      when d.status='draft' or (d.status='archived' and coalesce(d.archived_from_status,'draft')='draft') then d.owner_id=auth.uid() or public.os_has_note_access(d.id)
      when d.status='archived' then d.owner_id=auth.uid() or d.archived_by=auth.uid() or public.os_is_admin()
      when d.meeting_record_id is not null then public.os_can_read_meeting_record(d.meeting_record_id)
      when d.status='canonical' then true
      when public.os_is_partner() then d.source<>'mcp' and (d.owner_id=auth.uid() or exists(
        select 1 from public.os_doc_categories c where c.id=d.category_id and c.archived_at is null and auth.uid()=any(c.partner_ids)))
      else d.status in ('team','review','reviewed') end
  )
$$;
create function public.os_workspace_page_read(p_document uuid) returns boolean language sql stable security definer set search_path='' as $$
  with recursive chain as (
    select d.id,d.parent_document_id,array[d.id] as visited,false as cycle from public.os_documents d where d.id=p_document
    union all
    select d.id,d.parent_document_id,c.visited||d.id,d.id=any(c.visited) from public.os_documents d join chain c on d.id=c.parent_document_id
    where not c.cycle and cardinality(c.visited)<64
  ) select coalesce(bool_and(public.os_workspace_document_read(id) and not cycle) and bool_or(parent_document_id is null),false) from chain
$$;
revoke all on function public.os_is_partner(),public.os_is_staff(),public.os_has_note_access(uuid),public.os_can_read_meeting_record(uuid),public.os_workspace_document_read(uuid),public.os_workspace_page_read(uuid) from public,anon;
grant execute on function public.os_is_partner(),public.os_is_staff(),public.os_has_note_access(uuid),public.os_can_read_meeting_record(uuid),public.os_workspace_document_read(uuid),public.os_workspace_page_read(uuid) to authenticated,service_role;

alter table public.os_doc_categories enable row level security;
alter table public.os_document_pins enable row level security;
alter table public.os_document_drafts enable row level security;
alter table public.os_note_inbox enable row level security;
alter table public.os_doc_templates enable row level security;
alter table public.os_knowledge_events enable row level security;
alter table public.os_document_candidates enable row level security;
alter table public.os_meeting_attendees enable row level security;
alter table public.os_note_access_grants enable row level security;
revoke all on public.os_doc_categories,public.os_document_pins,public.os_document_drafts,public.os_note_inbox,public.os_doc_templates,public.os_knowledge_events,public.os_document_candidates,public.os_meeting_attendees,public.os_note_access_grants from public,anon,authenticated;
grant select,insert,update,delete on public.os_doc_categories,public.os_document_pins,public.os_document_drafts,public.os_note_inbox,public.os_doc_templates to authenticated;
grant select on public.os_knowledge_events,public.os_document_candidates,public.os_meeting_attendees,public.os_note_access_grants to authenticated;
grant all on public.os_doc_categories,public.os_document_pins,public.os_document_drafts,public.os_note_inbox,public.os_doc_templates,public.os_knowledge_events,public.os_document_candidates,public.os_meeting_attendees,public.os_note_access_grants to service_role;
grant usage,select on sequence public.os_knowledge_events_id_seq to service_role;

create policy workspace_category_read on public.os_doc_categories for select to authenticated using ((select public.os_is_active_member()) and ((space='mine' and owner_id=(select auth.uid())) or (space='team' and ((select public.os_is_staff()) or (select auth.uid())=any(partner_ids)))));
create policy workspace_category_insert on public.os_doc_categories for insert to authenticated with check (created_by=(select auth.uid()) and ((space='mine' and owner_id=(select auth.uid())) or (space='team' and (select public.os_is_staff()))));
create policy workspace_category_update on public.os_doc_categories for update to authenticated using ((space='mine' and owner_id=(select auth.uid())) or (space='team' and (select public.os_is_staff()))) with check ((space='mine' and owner_id=(select auth.uid())) or (space='team' and (select public.os_is_staff())));
-- Categories are soft deleted only through a guarded RPC.
create policy workspace_pin_own on public.os_document_pins for all to authenticated using (user_id=(select auth.uid()) and public.os_workspace_page_read(document_id)) with check (user_id=(select auth.uid()) and public.os_workspace_page_read(document_id));
create policy workspace_draft_own on public.os_document_drafts for all to authenticated using (user_id=(select auth.uid()) and public.os_workspace_page_read(document_id)) with check (user_id=(select auth.uid()) and public.os_workspace_page_read(document_id));
create policy workspace_inbox_own on public.os_note_inbox for all to authenticated using (owner_id=(select auth.uid()) and (select public.os_is_active_member())) with check (owner_id=(select auth.uid()) and (select public.os_is_active_member()));
create policy workspace_template_read on public.os_doc_templates for select to authenticated using ((select public.os_is_active_member()) and (scope='company' or owner_id=(select auth.uid())));
create policy workspace_template_insert on public.os_doc_templates for insert to authenticated with check (created_by=(select auth.uid()) and ((scope='personal' and owner_id=(select auth.uid())) or (scope='company' and (select public.os_is_admin()))));
create policy workspace_template_update on public.os_doc_templates for update to authenticated using ((scope='personal' and owner_id=(select auth.uid())) or (scope='company' and (select public.os_is_admin()))) with check ((scope='personal' and owner_id=(select auth.uid())) or (scope='company' and (select public.os_is_admin())));
create policy workspace_event_read on public.os_knowledge_events for select to authenticated using ((select public.os_is_active_member()) and ((select public.os_is_admin()) or actor_id=(select auth.uid())));
create policy workspace_candidate_read on public.os_document_candidates for select to authenticated using (public.os_workspace_page_read(document_id));
create policy workspace_attendees_read on public.os_meeting_attendees for select to authenticated using (public.os_can_read_meeting_record(meeting_id));
create policy workspace_note_grants_read on public.os_note_access_grants for select to authenticated using (admin_id=(select auth.uid()) or exists(select 1 from public.os_documents d where d.id=document_id and d.owner_id=(select auth.uid())));

-- Restrictive policies intersect with the historical permissive rules.
create policy workspace_documents_read on public.os_documents as restrictive for select to authenticated using (public.os_workspace_page_read(id));
create policy workspace_documents_update on public.os_documents as restrictive for update to authenticated using (public.os_workspace_page_read(id)) with check (public.os_workspace_page_read(id));
create policy workspace_versions_read on public.os_document_versions as restrictive for select to authenticated using (public.os_workspace_page_read(document_id));
create policy workspace_chunks_read on public.os_document_chunks as restrictive for select to authenticated using (public.os_workspace_page_read(document_id));
create policy workspace_links_read on public.os_document_links as restrictive for select to authenticated using (public.os_workspace_page_read(from_id) and public.os_workspace_page_read(to_id));
create function public.os_workspace_record_read(p_record uuid) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select case
    when r.record_type='meeting' and r.metadata->>'workspace'='knowledge' then public.os_can_read_meeting_record(r.id)
    when r.record_type in ('decision','task') and exists(select 1 from public.os_records p where p.id=r.parent_id and p.record_type='meeting' and p.metadata->>'workspace'='knowledge') then public.os_can_read_meeting_record(r.parent_id)
    else true end from public.os_records r where r.id=p_record),false)
$$;
revoke all on function public.os_workspace_record_read(uuid) from public,anon;
grant execute on function public.os_workspace_record_read(uuid) to authenticated,service_role;
create policy workspace_meetings_read on public.os_records as restrictive for select to authenticated using (public.os_workspace_record_read(id));
create policy workspace_meeting_history_read on public.os_record_events as restrictive for select to authenticated using (public.os_workspace_record_read(record_id));
-- Historical read RPCs keep their signatures, but must not bypass the new RLS.
alter function public.os_get_document_versions(uuid) security invoker;
alter function public.os_list_documents_v3(integer,integer,public.os_doc_status[],uuid,text,text,boolean) security invoker;
alter function public.os_search_documents(text,extensions.vector,integer,public.os_doc_status[],text,text) security invoker;
alter function public.os_search_knowledge(text,extensions.vector,integer,public.os_doc_status[],text,text,double precision) security invoker;

create function public.os_workspace_guard_category() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op='UPDATE' and (new.space is distinct from old.space or new.owner_id is distinct from old.owner_id) then raise exception 'OS_CATEGORY_SPACE_IMMUTABLE' using errcode='42501'; end if;
  if new.space='team' and not public.os_is_admin() and (
    (tg_op='INSERT' and cardinality(new.partner_ids)>0) or
    (tg_op='UPDATE' and (new.partner_ids is distinct from old.partner_ids or new.archived_at is distinct from old.archived_at))) then
    raise exception 'OS_CATEGORY_ADMIN_REQUIRED' using errcode='42501';
  end if;
  new.updated_at:=now(); new.updated_by:=auth.uid(); return new;
end $$;
create trigger os_workspace_category_guard before insert or update on public.os_doc_categories for each row execute function public.os_workspace_guard_category();
revoke all on function public.os_workspace_guard_category() from public,anon,authenticated;

create function public.os_workspace_guard_document() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.os_doc_categories;
begin
  if ((tg_op='INSERT' and new.meeting_record_id is not null) or (tg_op='UPDATE' and (old.meeting_record_id is not null or new.meeting_record_id is distinct from old.meeting_record_id)))
    and current_setting('os.workspace_meeting_ok',true) is distinct from '1' then
    raise exception 'OS_MEETING_COMMAND_REQUIRED' using errcode='42501';
  end if;
  if tg_op='UPDATE' then
    if coalesce(current_setting('os.agent_key_id',true),'')<>'' and (old.source not in ('mcp','obsidian_vault') or old.status<>'draft' or new.status<>'draft') then
      raise exception 'OS_AGENT_DOCUMENT_DENIED' using errcode='42501';
    end if;
    if auth.uid() is not null and old.status='draft' and old.owner_id<>auth.uid() then raise exception 'OS_NOTE_AUDIT_READ_ONLY' using errcode='42501'; end if;
    if old.status='canonical' and (new.title,new.content_md,new.folder,new.tags,new.brand,new.team,new.review_due_on) is distinct from (old.title,old.content_md,old.folder,old.tags,old.brand,old.team,old.review_due_on)
      and current_setting('os.proposal_apply_ok',true) is distinct from '1' and current_setting('os.review_keep_ok',true) is distinct from '1' then
      raise exception 'OS_CANONICAL_PROPOSAL_REQUIRED' using errcode='42501';
    end if;
    if auth.uid() is not null and new.owner_id is distinct from old.owner_id and not public.os_is_admin() then raise exception 'OS_OWNER_ADMIN_REQUIRED' using errcode='42501'; end if;
    if auth.uid() is not null and not public.os_workspace_page_read(old.id) then raise exception 'OS_DOCUMENT_ACCESS_DENIED' using errcode='42501'; end if;
    if public.os_is_partner() and old.status<>'draft' and (new.category_id,new.owner_id,new.folder,new.tags,new.status) is distinct from (old.category_id,old.owner_id,old.folder,old.tags,old.status) then raise exception 'OS_PARTNER_PROPERTY_DENIED' using errcode='42501'; end if;
    if new.retention_hold is distinct from old.retention_hold and auth.uid() is not null and not public.os_is_admin()
      and current_setting('os.status_change_ok',true) is distinct from '1'
      and not (coalesce(current_setting('os.workspace_meeting_ok',true),'')='1' and new.retention_hold and new.meeting_record_id is not null)
      then raise exception 'OS_RETENTION_ADMIN_REQUIRED' using errcode='42501'; end if;
  elsif auth.uid() is not null then
    if new.owner_id<>auth.uid() or (new.status<>'draft' and (new.status<>'team' or (public.os_is_partner() and current_setting('os.workspace_meeting_ok',true) is distinct from '1'))) then raise exception 'OS_DOCUMENT_CREATE_DENIED' using errcode='42501'; end if;
  end if;
  if new.category_id is not null then
    select * into c from public.os_doc_categories where id=new.category_id and archived_at is null;
    if not found or (new.status='draft' and (c.space<>'mine' or c.owner_id<>new.owner_id)) or (new.status<>'draft' and new.status<>'archived' and c.space<>'team') then raise exception 'OS_CATEGORY_SPACE_MISMATCH' using errcode='23514'; end if;
  end if;
  return new;
end $$;
create trigger os_workspace_document_guard before insert or update on public.os_documents for each row execute function public.os_workspace_guard_document();
revoke all on function public.os_workspace_guard_document() from public,anon,authenticated;

create or replace function public.os_set_document_status(p_document_id uuid,p_to public.os_doc_status,p_note text default '')
returns public.os_documents language plpgsql security definer set search_path='' as $$
declare d public.os_documents; f public.os_doc_status; u uuid:=auth.uid(); ok boolean:=false; c public.os_document_candidates;
begin
  select * into d from public.os_documents where id=p_document_id for update;
  if not found or not public.os_workspace_page_read(d.id) then raise exception 'OS_DOC_NOT_FOUND' using errcode='P0002'; end if;
  f:=d.status;
  if d.meeting_record_id is not null then raise exception 'OS_MEETING_COMMAND_REQUIRED' using errcode='42501'; end if;
  if p_to='archived' and exists(select 1 from public.os_document_candidates where document_id=d.id and status='open') then raise exception 'OS_OPEN_CANDIDATE' using errcode='42501'; end if;
  if f=p_to then return d; end if;
  if p_to='canonical' then
    select * into c from public.os_document_candidates where document_id=d.id and status='open' for update;
    ok:=found and current_setting('os.candidate_decide_ok',true)='1' and f in ('review','reviewed') and public.os_is_staff() and public.os_can_approve(u,d.owner_id)
      and public.os_can_approve(u,c.submitted_by) and (c.requested_approver_id=u or (public.os_is_admin() and length(btrim(p_note))>0));
  elsif p_to='archived' then
    ok:=case when f='canonical' or d.retention_hold then public.os_is_admin() and length(btrim(p_note))>0 else d.owner_id=u or public.os_is_admin() end;
  elsif f='canonical' and p_to='team' then
    ok:=public.os_is_staff() and (d.steward_id=u or public.os_is_admin()) and length(btrim(p_note))>0;
  elsif f='archived' then
    ok:=(d.owner_id=u or d.archived_by=u or public.os_is_admin()) and (
      (coalesce(d.archived_from_status,'draft')='draft' and p_to='draft') or
      (d.archived_from_status in ('team','review','reviewed') and p_to='team') or
      (d.archived_from_status='canonical' and p_to='review' and public.os_is_admin() and length(btrim(p_note))>0));
  elsif f='draft' and p_to='team' then ok:=d.owner_id=u and public.os_is_staff();
  elsif f in ('team','review','reviewed') and p_to='draft' then
    ok:=d.owner_id=u and public.os_is_staff() and not exists(select 1 from public.os_document_candidates where document_id=d.id and status='open');
  elsif f='team' and p_to='review' then ok:=public.os_is_staff() and (d.owner_id=u or public.os_is_admin());
  elsif f='review' and p_to='team' then ok:=public.os_is_staff() and (d.owner_id=u or public.os_is_admin() or exists(select 1 from public.os_document_candidates where document_id=d.id and requested_approver_id=u and status='open'));
  elsif f='review' and p_to='reviewed' then ok:=public.os_is_staff() and public.os_can_approve(u,d.owner_id);
  end if;
  if not coalesce(ok,false) then raise exception 'OS_STATUS_TRANSITION_DENIED' using errcode='42501'; end if;
  perform pg_catalog.set_config('os.status_change_ok','1',true);
  update public.os_documents set status=p_to,
    archived_at=case when p_to='archived' then now() when f='archived' then null else archived_at end,
    archived_by=case when p_to='archived' then u when f='archived' then null else archived_by end,
    archived_from_status=case when p_to='archived' then f else archived_from_status end,
    retention_hold=retention_hold or (p_to='archived' and f='canonical') or p_to='canonical',
    category_id=case when (f='draft' and p_to<>'archived') or p_to in ('draft','canonical') or exists(select 1 from public.os_doc_categories cat where cat.id=category_id and cat.archived_at is not null) then null else category_id end,
    daily_on=case when p_to='team' or (f='archived' and exists(select 1 from public.os_documents other where other.id<>d.id and other.owner_id=d.owner_id and other.daily_on=d.daily_on and other.status<>'archived')) then null else daily_on end
  where id=d.id returning * into d;
  perform pg_catalog.set_config('os.status_change_ok','',true);
  insert into public.os_document_events(document_id,from_status,to_status,actor_id,note) values(d.id,f,p_to,u,p_note);
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail) values(u,case when p_to='archived' then 'document_trash' when f='archived' then 'document_restore' else 'document_status' end,'document',d.id,jsonb_build_object('from',f,'to',p_to,'reason',p_note));
  return d;
end $$;
revoke all on function public.os_set_document_status(uuid,public.os_doc_status,text) from public,anon;
grant execute on function public.os_set_document_status(uuid,public.os_doc_status,text) to authenticated,service_role;

create function public.os_submit_candidate(p_document_id uuid,p_expected_version integer,p_approver uuid,p_folder text,p_steward uuid,p_due date)
returns public.os_document_candidates language plpgsql security definer set search_path='' as $$
declare d public.os_documents; c public.os_document_candidates;
begin
  select * into d from public.os_documents where id=p_document_id for update;
  if not found or not public.os_workspace_page_read(d.id) or not public.os_is_staff() or (d.owner_id<>auth.uid() and not public.os_is_admin()) then raise exception 'OS_CANDIDATE_DENIED' using errcode='42501'; end if;
  if d.status<>'team' or d.current_version<>p_expected_version then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
  if not public.os_can_approve(p_approver,d.owner_id) or not public.os_can_approve(p_approver,auth.uid()) or not exists(select 1 from public.os_profiles where id=p_approver and member_kind='staff' and is_active) then raise exception 'OS_APPROVER_INVALID' using errcode='22023'; end if;
  if p_due is null or (p_steward is not null and not exists(select 1 from public.os_profiles where id=p_steward and is_active)) then raise exception 'OS_CANDIDATE_INVALID' using errcode='22023'; end if;
  insert into public.os_document_candidates(document_id,requested_approver_id,target_folder,steward_id,review_due_on,submitted_by)
    values(d.id,p_approver,p_folder,p_steward,p_due,auth.uid()) returning * into c;
  perform public.os_set_document_status(d.id,'review','정본 후보');
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id) values(auth.uid(),'candidate_submit','candidate',c.id);
  return c;
end $$;
create function public.os_decide_candidate(p_id uuid,p_expected_version integer,p_decision text,p_note text default '')
returns public.os_documents language plpgsql security definer set search_path='' as $$
declare c public.os_document_candidates; d public.os_documents;
begin
  select * into c from public.os_document_candidates where id=p_id;
  if not found or c.status<>'open' then raise exception 'OS_CANDIDATE_NOT_OPEN' using errcode='P0002'; end if;
  select * into d from public.os_documents where id=c.document_id for update;
  select * into c from public.os_document_candidates where id=p_id for update;
  if c.status<>'open' then raise exception 'OS_CANDIDATE_NOT_OPEN' using errcode='P0002'; end if;
  if d.current_version<>p_expected_version then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
  if not public.os_is_staff() or not public.os_workspace_page_read(d.id) or not public.os_can_approve(auth.uid(),d.owner_id) or not public.os_can_approve(auth.uid(),c.submitted_by)
    or (c.requested_approver_id<>auth.uid() and not(public.os_is_admin() and length(btrim(p_note))>0)) then raise exception 'OS_CANDIDATE_DENIED' using errcode='42501'; end if;
  if p_decision not in ('approved','returned') or (p_decision='returned' and length(btrim(p_note))=0) then raise exception 'OS_DECISION_INVALID' using errcode='22023'; end if;
  if p_decision='approved' then
    perform pg_catalog.set_config('os.candidate_decide_ok','1',true);
    perform pg_catalog.set_config('os.proposal_apply_ok','1',true);
    update public.os_documents set folder=c.target_folder,steward_id=c.steward_id,review_due_on=c.review_due_on where id=d.id;
    d:=public.os_set_document_status(d.id,'canonical',p_note);
    perform pg_catalog.set_config('os.proposal_apply_ok','',true);
    perform pg_catalog.set_config('os.candidate_decide_ok','',true);
  else d:=public.os_set_document_status(d.id,'team',p_note); end if;
  update public.os_document_candidates set status=p_decision,decided_by=auth.uid(),decided_at=now(),decision_note=p_note,proxy=(requested_approver_id<>auth.uid()) where id=c.id;
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail) values(auth.uid(),'candidate_'||p_decision,'candidate',c.id,jsonb_build_object('reason',p_note));
  return d;
end $$;
create function public.os_withdraw_candidate(p_id uuid) returns public.os_documents language plpgsql security definer set search_path='' as $$
declare c public.os_document_candidates; d public.os_documents;
begin
  select * into c from public.os_document_candidates where id=p_id;
  if not found then raise exception 'OS_CANDIDATE_DENIED' using errcode='42501'; end if;
  select * into d from public.os_documents where id=c.document_id for update;
  select * into c from public.os_document_candidates where id=p_id for update;
  if not found or c.status<>'open' or c.submitted_by<>auth.uid() then raise exception 'OS_CANDIDATE_DENIED' using errcode='42501'; end if;
  d:=public.os_set_document_status(c.document_id,'team','후보 철회');
  update public.os_document_candidates set status='withdrawn',decided_by=auth.uid(),decided_at=now() where id=c.id;
  return d;
end $$;
create function public.os_keep_canon_review(p_document uuid,p_expected_version integer) returns public.os_documents language plpgsql security definer set search_path='' as $$
declare d public.os_documents;
begin
  select * into d from public.os_documents where id=p_document for update;
  if not found or d.status<>'canonical' or not exists(select 1 from public.os_profiles where id=auth.uid() and is_active) or not coalesce(d.steward_id=auth.uid() or public.os_is_admin(),false) then raise exception 'OS_REVIEW_KEEP_DENIED' using errcode='42501'; end if;
  if d.current_version<>p_expected_version then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
  perform pg_catalog.set_config('os.review_keep_ok','1',true);
  update public.os_documents set review_due_on=(now() at time zone 'Asia/Seoul')::date+90 where id=d.id returning * into d;
  perform pg_catalog.set_config('os.review_keep_ok','',true);
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id) values(auth.uid(),'canon_review_keep','document',d.id);
  return d;
end $$;
revoke all on function public.os_submit_candidate(uuid,integer,uuid,text,uuid,date),public.os_decide_candidate(uuid,integer,text,text),public.os_withdraw_candidate(uuid),public.os_keep_canon_review(uuid,integer) from public,anon;
grant execute on function public.os_submit_candidate(uuid,integer,uuid,text,uuid,date),public.os_decide_candidate(uuid,integer,text,text),public.os_withdraw_candidate(uuid),public.os_keep_canon_review(uuid,integer) to authenticated;

-- Every mutation below is one transaction, derived from the JWT user, never a supplied actor.
create function public.os_knowledge_command(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  a text:=p->>'action'; u uuid:=auth.uid(); rid uuid:=nullif(p->>'id','')::uuid;
  d public.os_documents; cat public.os_doc_categories; n public.os_note_inbox;
  t public.os_doc_templates; m public.os_records; prop public.os_document_proposals;
  item jsonb; rowdata jsonb; target uuid; approver uuid; oldstatus public.os_doc_status;
  ids uuid[]; v_space text; v_name text; v_body text; v_title text; v_category uuid;
  v_day date; v_count integer; doc_id uuid; expected integer:=(p->>'expectedVersion')::integer;
begin
  if u is null or not public.os_is_active_member() then raise exception 'OS_ACTIVE_USER_REQUIRED' using errcode='42501'; end if;
  if octet_length(p::text)>2000000 then raise exception 'OS_COMMAND_TOO_LARGE' using errcode='22023'; end if;
  -- Lock documents before dependent proposal/candidate rows to keep a consistent order.
  if a like 'document.%' and a<>'document.create' or a in ('link.ignore','pin.toggle','canon.keep','canon.demote','canon.steward','trash.restore','trash.purge','candidate.submit','proposal.create') then
    select * into d from public.os_documents where id=rid for update;
    if not found or not public.os_workspace_page_read(d.id) then raise exception 'OS_DOCUMENT_NOT_FOUND' using errcode='P0002'; end if;
    if a in ('document.commit','document.properties','document.share','canon.keep','canon.demote','canon.steward','candidate.submit') and d.current_version is distinct from expected then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
  end if;
  case a
  when 'document.export' then
    if coalesce(p->>'format','') not in ('md','pdf') or coalesce(p->>'range','') not in ('doc','doc_versions') then raise exception 'OS_EXPORT_INVALID' using errcode='22023'; end if;
    insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail) values(u,'export','document',d.id,jsonb_build_object('format',p->>'format','range',p->>'range','version',d.current_version));
  when 'note.access' then
    if not public.os_is_admin() or length(btrim(coalesce(p->>'reason',''))) not between 1 and 500 then raise exception 'OS_NOTE_AUDIT_DENIED' using errcode='42501'; end if;
    select * into d from public.os_documents where id=rid and (status='draft' or (status='archived' and archived_from_status='draft')) for update;
    if not found then raise exception 'OS_DOCUMENT_NOT_FOUND' using errcode='P0002'; end if;
    insert into public.os_note_access_grants(document_id,admin_id,reason,expires_at) values(d.id,u,btrim(p->>'reason'),now()+interval '24 hours');
    insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail) values(u,'private_note_open','document',d.id,jsonb_build_object('reason',btrim(p->>'reason'),'expiresAt',now()+interval '24 hours'));
    perform public.os_enqueue_knowledge_notice(d.owner_id,u,'document',d.id,'knowledge_access','audit:'||now()::text);
  when 'document.create' then
    v_space:=coalesce(p->>'space','mine'); v_day:=nullif(p->>'dailyOn','')::date;
    if v_space not in ('mine','team') or (v_space='team' and not public.os_is_staff()) or (v_day is not null and v_space<>'mine') then raise exception 'OS_SPACE_DENIED' using errcode='42501'; end if;
    if v_day is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||v_day::text,0));
      select id into rid from public.os_documents where owner_id=u and daily_on=v_day and status<>'archived';
      if found then return jsonb_build_object('id',rid); end if;
    end if;
    if nullif(p->>'parentId','') is not null and not public.os_workspace_page_read((p->>'parentId')::uuid) then raise exception 'OS_PARENT_DENIED' using errcode='42501'; end if;
    insert into public.os_documents(title,content_md,status,folder,source,owner_id,created_by,category_id,daily_on,work_state,parent_document_id)
      values(coalesce(nullif(btrim(p->>'title'),''),'제목 없음'),coalesce(p->>'content',''),case when v_space='team' then 'team'::public.os_doc_status else 'draft'::public.os_doc_status end,'','wiki',u,u,nullif(p->>'categoryId','')::uuid,v_day,case when v_day is null then 'todo' else 'doing' end,nullif(p->>'parentId','')::uuid)
      returning id into rid;
  when 'document.commit' then
    if d.status in ('canonical','archived') then raise exception 'OS_DOCUMENT_LOCKED' using errcode='42501'; end if;
    v_title:=coalesce(nullif(btrim(p->>'title'),''),'제목 없음'); v_body:=coalesce(p->>'content',d.content_md);
    if (v_title,v_body) is distinct from (d.title,d.content_md) then
      perform pg_catalog.set_config('os.version_reason','문서 저장',true);
      update public.os_documents set title=v_title,content_md=v_body where id=d.id;
    end if;
    delete from public.os_document_drafts where document_id=d.id and user_id=u and updated_at<=coalesce(nullif(p->>'draftUpdatedAt','')::timestamptz,now());
  when 'document.draft' then
    if (d.status='draft' and d.owner_id<>u) or d.meeting_record_id is not null then raise exception 'OS_DRAFT_DENIED' using errcode='42501'; end if;
    if d.status='archived' or expected is null or expected<1 then raise exception 'OS_DRAFT_INVALID' using errcode='22023'; end if;
    insert into public.os_document_drafts(document_id,user_id,title,content_md,base_version)
      values(d.id,u,coalesce(p->>'title',''),coalesce(p->>'content',''),expected)
      on conflict(document_id,user_id) do update set title=excluded.title,content_md=excluded.content_md,base_version=excluded.base_version,updated_at=now();
  when 'document.discard' then delete from public.os_document_drafts where document_id=d.id and user_id=u;
  when 'document.properties' then
    if d.status in ('canonical','archived') then raise exception 'OS_DOCUMENT_LOCKED' using errcode='42501'; end if;
    update public.os_documents set
      category_id=case when p?'categoryId' then nullif(p->>'categoryId','')::uuid else category_id end,
      work_state=coalesce(p->>'workState',work_state),
      due_on=case when p?'dueOn' then nullif(p->>'dueOn','')::date else due_on end,
      tags=case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else tags end
      where id=d.id;
  when 'document.duplicate' then
    insert into public.os_documents(title,content_md,folder,status,source,owner_id,created_by)
      values(d.title||' 사본',d.content_md,'','draft','wiki',u,u) returning id into rid;
  when 'document.share' then
    if d.owner_id<>u or not public.os_is_staff() or d.status not in ('draft','team') or exists(select 1 from public.os_document_candidates where document_id=d.id and status='open') then raise exception 'OS_SHARE_DENIED' using errcode='42501'; end if;
    v_category:=nullif(p->>'categoryId','')::uuid;
    if coalesce((p->>'copy')::boolean,false) then
      insert into public.os_documents(title,content_md,folder,status,source,owner_id,created_by,category_id)
        values(d.title,d.content_md,'','team','wiki',u,u,v_category) returning id into rid;
    else
      d:=public.os_set_document_status(d.id,case when p->>'space'='mine' then 'draft'::public.os_doc_status else 'team'::public.os_doc_status end,'문서 공유 변경');
      update public.os_documents set category_id=v_category,work_state='todo',daily_on=null where id=d.id;
    end if;
  when 'document.archive' then perform public.os_set_document_status(d.id,'archived',coalesce(p->>'reason',''));
  when 'link.ignore' then
    if d.status='archived' or d.meeting_record_id is not null or length(btrim(coalesce(p->>'target',''))) not between 1 and 300 then raise exception 'OS_LINK_INVALID' using errcode='22023'; end if;
    insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail) values(u,'link_ignore','link',d.id,jsonb_build_object('sourceId',d.id,'target',p->>'target','sourceVersion',d.current_version));
  when 'pin.toggle' then
    if exists(select 1 from public.os_document_pins where document_id=d.id and user_id=u) then delete from public.os_document_pins where document_id=d.id and user_id=u;
    else insert into public.os_document_pins(document_id,user_id) values(d.id,u); end if;
  when 'category.save' then
    if rid is not null then select * into cat from public.os_doc_categories where id=rid and archived_at is null for update; if not found then raise exception 'OS_CATEGORY_NOT_FOUND' using errcode='P0002'; end if; end if;
    v_space:=coalesce(cat.space,p->>'space','mine');
    if (v_space='mine' and cat.id is not null and cat.owner_id<>u) or (v_space='team' and not public.os_is_staff()) or v_space not in ('mine','team') then raise exception 'OS_CATEGORY_DENIED' using errcode='42501'; end if;
    if cat.id is null then
      insert into public.os_doc_categories(space,owner_id,name,color,created_by,sort_order)
        values(v_space,case when v_space='mine' then u else null end,btrim(p->>'name'),coalesce(p->>'color','blue'),u,coalesce((p->>'sortOrder')::integer,0)) returning id into rid;
    else update public.os_doc_categories set name=btrim(coalesce(p->>'name',name)),color=coalesce(p->>'color',color),sort_order=coalesce((p->>'sortOrder')::integer,sort_order),
      partner_ids=case when p?'partnerIds' then array(select jsonb_array_elements_text(p->'partnerIds'))::uuid[] else partner_ids end where id=cat.id; end if;
  when 'category.archive' then
    perform public.os_knowledge_command(jsonb_build_object('action','category.batch','space',p->>'space','categories','[]'::jsonb,'deleted',jsonb_build_array(rid)));
  when 'category.batch' then
    -- Lock and validate all rows first; cancel/failure leaves the entire set unchanged.
    ids:=array(select (value->>'id')::uuid from jsonb_array_elements(coalesce(p->'categories','[]'::jsonb))) || array(select jsonb_array_elements_text(coalesce(p->'deleted','[]'::jsonb)))::uuid[];
    if cardinality(ids)<>cardinality(array(select distinct unnest(ids))) then raise exception 'OS_CATEGORY_DUPLICATE' using errcode='22023'; end if;
    perform 1 from public.os_doc_categories where id=any(ids) order by id for update;
    foreach target in array ids loop
      select * into cat from public.os_doc_categories where id=target and archived_at is null;
      if not found or cat.space is distinct from p->>'space' or (cat.space='mine' and cat.owner_id<>u) or (cat.space='team' and not public.os_is_staff()) then raise exception 'OS_CATEGORY_DENIED' using errcode='42501'; end if;
    end loop;
    for item in select value from jsonb_array_elements(coalesce(p->'deleted','[]'::jsonb)) loop
      target:=(item#>>'{}')::uuid;
      select * into cat from public.os_doc_categories where id=target;
      if cat.space='team' and not public.os_is_admin() then raise exception 'OS_CATEGORY_ADMIN_REQUIRED' using errcode='42501'; end if;
      update public.os_documents set category_id=null where category_id=target;
      update public.os_doc_categories set archived_at=now() where id=target;
    end loop;
    -- A temporary unique name permits atomic swaps without deferring the partial index.
    update public.os_doc_categories set name=substr(md5(id::text),1,20) where id=any(ids) and archived_at is null;
    v_count:=0;
    for item in select value from jsonb_array_elements(coalesce(p->'categories','[]'::jsonb)) loop
      update public.os_doc_categories set name=btrim(item->>'name'),color=item->>'color',sort_order=v_count,
        partner_ids=array(select jsonb_array_elements_text(coalesce(item->'partner_ids','[]'::jsonb)))::uuid[] where id=(item->>'id')::uuid;
      v_count:=v_count+1;
    end loop;
  when 'note.capture' then
    v_body:=btrim(p->>'body');
    if coalesce(length(v_body),0) not between 1 and 500 then raise exception 'OS_MEMO_INVALID' using errcode='22023'; end if;
    if p->>'target' like 'meeting:%' then
      select * into m from public.os_records where id=(p->>'meetingId')::uuid and metadata->>'workspace'='knowledge' for update;
      if not found or m.status<>'active' or not exists(select 1 from public.os_meeting_attendees where meeting_id=m.id and user_id=u) then raise exception 'OS_MEETING_DENIED' using errcode='42501'; end if;
      return public.os_knowledge_workflow_command(jsonb_build_object('action','meeting.save','id',m.id,'expectedVersion',m.version,'content',m.description||E'\n\n'||v_body));
    end if;
    rowdata:=public.os_knowledge_command(jsonb_build_object('action','inbox.create','body',v_body));
    if p->>'target'='today' then return public.os_knowledge_command(jsonb_build_object('action','inbox.process','id',rowdata->>'id','today',true)); end if;
    return rowdata;
  when 'inbox.create' then insert into public.os_note_inbox(owner_id,body) values(u,btrim(p->>'body')) returning id into rid;
  when 'inbox.delete' then delete from public.os_note_inbox where id=rid and owner_id=u;
  when 'inbox.process' then
    select * into n from public.os_note_inbox where id=rid and owner_id=u for update;
    if not found then raise exception 'OS_NOTE_NOT_FOUND' using errcode='P0002'; end if;
    if n.processed_at is not null then return jsonb_build_object('id',n.processed_document_id); end if;
    if coalesce((p->>'today')::boolean,false) then
      v_day:=(now() at time zone 'Asia/Seoul')::date;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||v_day::text,0));
      select * into d from public.os_documents where owner_id=u and daily_on=v_day and status='draft' for update;
    end if;
    if d.id is not null then
      if exists(select 1 from public.os_document_drafts where document_id=d.id and user_id=u) then raise exception 'OS_VERSION_CONFLICT_DRAFT' using errcode='40001'; end if;
      update public.os_documents set content_md=content_md||E'\n\n'||n.body where id=d.id returning id into rid;
    else
      insert into public.os_documents(title,content_md,folder,status,source,owner_id,created_by,daily_on,category_id)
        values(coalesce(v_day::text,left(n.body,30)),n.body,'','draft','wiki',u,u,v_day,nullif(p->>'categoryId','')::uuid) returning id into rid;
    end if;
    update public.os_note_inbox set processed_at=now(),processed_document_id=rid where id=n.id;
  when 'template.save' then
    if nullif(p->>'defaultKey','') is not null then
      if not public.os_is_admin() or p->>'defaultKey' !~ '^default-([1-9]|10)$' or coalesce(p->>'scope','company')<>'company' then raise exception 'OS_TEMPLATE_DENIED' using errcode='42501'; end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('template:'||(p->>'defaultKey'),0));
      select id into rid from public.os_doc_templates where default_key=p->>'defaultKey';
    end if;
    if rid is not null then select * into t from public.os_doc_templates where id=rid for update; if not found then raise exception 'OS_TEMPLATE_NOT_FOUND' using errcode='P0002'; end if; end if;
    v_space:=coalesce(t.scope,p->>'scope','personal');
    if (v_space='company' and not public.os_is_admin()) or (t.scope='personal' and t.owner_id<>u) then raise exception 'OS_TEMPLATE_DENIED' using errcode='42501'; end if;
    if t.id is null then
      insert into public.os_doc_templates(name,description,body_md,default_space,kind,scope,owner_id,created_by,default_key,archived_at)
        values(btrim(p->>'name'),coalesce(p->>'description',''),coalesce(p->>'content',''),coalesce(p->>'defaultSpace','mine'),coalesce(p->>'kind','doc'),v_space,case when v_space='personal' then u else null end,u,nullif(p->>'defaultKey',''),case when coalesce((p->>'archived')::boolean,false) then now() else null end) returning id into rid;
    else update public.os_doc_templates set name=btrim(p->>'name'),description=coalesce(p->>'description',description),body_md=coalesce(p->>'content',body_md),default_space=coalesce(p->>'defaultSpace',default_space),kind=coalesce(p->>'kind',kind),archived_at=case when coalesce((p->>'archived')::boolean,false) then now() else archived_at end,updated_by=u,updated_at=now() where id=t.id; end if;
  when 'template.archive' then
    select * into t from public.os_doc_templates where id=rid for update;
    if not found or (t.scope='personal' and t.owner_id<>u) or (t.scope='company' and not public.os_is_admin()) then raise exception 'OS_TEMPLATE_DENIED' using errcode='42501'; end if;
    update public.os_doc_templates set archived_at=now(),updated_by=u where id=t.id;
  when 'candidate.submit' then
    rowdata:=to_jsonb(public.os_submit_candidate(d.id,expected,(p->>'approverId')::uuid,coalesce(p->>'folder',''),nullif(p->>'stewardId','')::uuid,(p->>'reviewDueOn')::date)); rid:=(rowdata->>'id')::uuid;
  when 'candidate.decide' then perform public.os_decide_candidate(rid,expected,p->>'decision',coalesce(p->>'reason',''));
  when 'candidate.withdraw' then perform public.os_withdraw_candidate(rid);
  when 'canon.steward' then
    if not public.os_is_admin() or d.status<>'canonical' or not exists(select 1 from public.os_profiles where id=(p->>'stewardId')::uuid and is_active) then raise exception 'OS_STEWARD_INVALID' using errcode='42501'; end if;
    update public.os_documents set steward_id=(p->>'stewardId')::uuid where id=d.id;
    insert into public.os_knowledge_events(actor_id,action,target_type,target_id) values(u,'canon_steward','document',d.id);
  when 'canon.keep' then perform public.os_keep_canon_review(d.id,expected);
  when 'canon.demote' then perform public.os_set_document_status(d.id,'team',coalesce(p->>'reason',''));
  when 'trash.restore' then
    if d.status<>'archived' then raise exception 'OS_TRASH_REQUIRED' using errcode='22023'; end if;
    if d.archived_from_status='canonical' then
      if not public.os_is_admin() or length(btrim(coalesce(p->>'reason','')))=0 then raise exception 'OS_RESTORE_DENIED' using errcode='42501'; end if;
      if d.current_version is distinct from expected then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
      if not public.os_can_approve((p->>'approverId')::uuid,d.owner_id) or not public.os_can_approve((p->>'approverId')::uuid,u)
        or not exists(select 1 from public.os_profiles where id=(p->>'approverId')::uuid and member_kind='staff' and is_active)
        or nullif(p->>'reviewDueOn','') is null then raise exception 'OS_APPROVER_INVALID' using errcode='22023'; end if;
      if nullif(p->>'stewardId','') is not null and not exists(select 1 from public.os_profiles where id=(p->>'stewardId')::uuid and is_active) then raise exception 'OS_STEWARD_INVALID' using errcode='22023'; end if;
      insert into public.os_document_candidates(document_id,requested_approver_id,target_folder,steward_id,review_due_on,submitted_by)
        values(d.id,(p->>'approverId')::uuid,coalesce(p->>'folder',d.folder),nullif(p->>'stewardId','')::uuid,(p->>'reviewDueOn')::date,u) returning id into rid;
      perform public.os_set_document_status(d.id,'review',p->>'reason');
      return jsonb_build_object('id',rid);
    end if;
    perform public.os_set_document_status(d.id,case when coalesce(d.archived_from_status,'draft')='draft' then 'draft'::public.os_doc_status else 'team'::public.os_doc_status end,'휴지통 복원');
  when 'trash.purge' then
    if not public.os_is_admin() or d.status<>'archived' or d.retention_hold or d.archived_from_status='canonical' or not coalesce((p->>'confirm')::boolean,false) or length(btrim(coalesce(p->>'reason','')))=0 then raise exception 'OS_PURGE_DENIED' using errcode='42501'; end if;
    insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail) values(u,'document_purge','document',d.id,jsonb_build_object('reason',p->>'reason'));
    perform pg_catalog.set_config('os.workspace_purge_ok','1',true);
    delete from public.os_document_proposal_comments where proposal_id in(select id from public.os_document_proposals where document_id=d.id);
    delete from public.os_document_proposals where document_id=d.id;
    delete from public.os_document_candidates where document_id=d.id;
    delete from public.os_documents where id=d.id;
    perform pg_catalog.set_config('os.workspace_purge_ok','',true);
  else
    return public.os_knowledge_workflow_command(p);
  end case;
  return jsonb_build_object('id',rid);
end $$;
revoke all on function public.os_knowledge_command(jsonb) from public,anon;
grant execute on function public.os_knowledge_command(jsonb) to authenticated;

create function public.os_knowledge_workflow_command(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  a text:=p->>'action'; u uuid:=auth.uid(); rid uuid:=nullif(p->>'id','')::uuid;
  d public.os_documents; prop public.os_document_proposals; m public.os_records;
  item jsonb; meta jsonb; approver uuid; agent_owner uuid; next_status text; changed boolean;
  result_id uuid; attendee uuid; expected integer:=(p->>'expectedVersion')::integer;
begin
  if u is null or not public.os_is_active_member() then raise exception 'OS_ACTIVE_USER_REQUIRED' using errcode='42501'; end if;
  if octet_length(p::text)>2000000 then raise exception 'OS_COMMAND_TOO_LARGE' using errcode='22023'; end if;
  if a='proposal.create' then
    select * into d from public.os_documents where id=rid for update;
    if not found or d.status<>'canonical' or not public.os_workspace_page_read(d.id) then raise exception 'OS_DOCUMENT_NOT_FOUND' using errcode='P0002'; end if;
    approver:=(p->>'approverId')::uuid;
    if length(btrim(coalesce(p->>'reason',''))) not between 1 and 200 or expected is null or expected<1
      or not public.os_can_approve(approver,u) or not public.os_can_approve(approver,d.owner_id)
      or not exists(select 1 from public.os_profiles where id=approver and is_active and member_kind='staff') then raise exception 'OS_PROPOSAL_INVALID' using errcode='22023'; end if;
    if nullif(p->>'proposalId','') is not null then
      select * into prop from public.os_document_proposals where id=(p->>'proposalId')::uuid for update;
      if not found or prop.document_id<>d.id or prop.author_id<>u or prop.status<>'returned' or prop.return_kind<>'revise' then raise exception 'OS_PROPOSAL_REVISE_DENIED' using errcode='42501'; end if;
      update public.os_document_proposals set base_version=expected,title=coalesce(p->>'title',d.title),content_md=coalesce(p->>'content',d.content_md),
        folder=coalesce(p->>'folder',d.folder),tags=case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else d.tags end,
        review_due_on=coalesce(nullif(p->>'reviewDueOn','')::date,d.review_due_on),requested_approver_id=approver,author_note=btrim(p->>'reason'),ai_assist=coalesce(p->>'aiAssist',''),
        status='open',return_kind=null,reviewer_id=null,decided_at=null,note='',updated_at=now() where id=prop.id returning id into rid;
    else
      insert into public.os_document_proposals(document_id,base_version,title,content_md,folder,brand,team,tags,author_id,requested_approver_id,author_note,ai_assist,review_due_on)
        values(d.id,expected,coalesce(p->>'title',d.title),coalesce(p->>'content',d.content_md),coalesce(p->>'folder',d.folder),coalesce(d.brand,''),d.team,
          case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else d.tags end,u,approver,btrim(p->>'reason'),coalesce(p->>'aiAssist',''),coalesce(nullif(p->>'reviewDueOn','')::date,d.review_due_on)) returning id into rid;
    end if;
    delete from public.os_document_drafts where document_id=d.id and user_id=u and updated_at<=now();
  elsif a in ('proposal.decide','proposal.rebase') then
    select * into prop from public.os_document_proposals where id=rid;
    if not found then raise exception 'OS_PROPOSAL_NOT_FOUND' using errcode='P0002'; end if;
    select * into d from public.os_documents where id=prop.document_id for update;
    select * into prop from public.os_document_proposals where id=rid for update;
    if prop.status<>'open' or d.status<>'canonical' or not public.os_workspace_page_read(d.id) then raise exception 'OS_PROPOSAL_NOT_OPEN' using errcode='P0002'; end if;
    if a='proposal.decide' and p->>'decision'='withdrawn' then
      if prop.author_id<>u then raise exception 'OS_PROPOSAL_DENIED' using errcode='42501'; end if;
      update public.os_document_proposals set status='withdrawn',updated_at=now(),decided_at=now(),reviewer_id=u where id=rid;
      return jsonb_build_object('id',rid);
    end if;
    if prop.agent_key_id is not null then select owner_user_id into agent_owner from public.os_agent_keys where id=prop.agent_key_id; end if;
    if not (a='proposal.rebase' and prop.author_id=u) and (
      not public.os_is_staff() or not public.os_can_approve(u,prop.author_id) or not public.os_can_approve(u,d.owner_id)
      or u=agent_owner or (prop.requested_approver_id is not null and prop.requested_approver_id<>u and not(public.os_is_admin() and length(btrim(coalesce(p->>'reason','')))>0))
    ) then raise exception 'OS_PROPOSAL_DENIED' using errcode='42501'; end if;
    if a='proposal.rebase' then
      if d.current_version is distinct from expected then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
      update public.os_document_proposals set rebased_from_version=base_version,base_version=d.current_version,title=coalesce(p->>'title',title),content_md=coalesce(p->>'content',content_md),
        folder=coalesce(p->>'folder',folder),brand=coalesce(p->>'brand',brand),team=coalesce(p->>'team',team),tags=case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else tags end,
        review_due_on=case when p?'reviewDueOn' then nullif(p->>'reviewDueOn','')::date else review_due_on end,updated_at=now() where id=rid;
    elsif p->>'decision'='approved' then
      if d.current_version<>prop.base_version then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
      changed:=(d.title,d.content_md) is distinct from (prop.title,prop.content_md);
      perform pg_catalog.set_config('os.proposal_apply_ok','1',true);
      perform pg_catalog.set_config('os.version_reason','승인된 변경 제안',true);
      update public.os_documents set title=prop.title,content_md=prop.content_md,folder=prop.folder,brand=prop.brand,team=prop.team,tags=prop.tags,review_due_on=prop.review_due_on,
        current_version=case when changed then d.current_version else d.current_version+1 end where id=d.id returning * into d;
      if not changed then insert into public.os_document_versions(document_id,version_no,title,content_md,author_id,reason) values(d.id,d.current_version,d.title,d.content_md,u,'승인된 문서 속성 제안'); end if;
      perform pg_catalog.set_config('os.proposal_apply_ok','',true);
      update public.os_document_proposals set status='approved',reviewer_id=u,decided_at=now(),note=coalesce(p->>'reason',''),proxy_reason=case when requested_approver_id is not null and requested_approver_id<>u then p->>'reason' else '' end,updated_at=now() where id=rid;
    elsif p->>'decision' in ('returned','rejected') and length(btrim(coalesce(p->>'reason','')))>0 then
      update public.os_document_proposals set status='returned',return_kind=case when p->>'decision'='rejected' then 'reject' else 'revise' end,reviewer_id=u,decided_at=now(),note=p->>'reason',updated_at=now() where id=rid;
    else raise exception 'OS_DECISION_INVALID' using errcode='22023'; end if;
  elsif a='meeting.create' then
    if not public.os_is_active_member() then raise exception 'OS_MEETING_CREATE_DENIED' using errcode='42501'; end if;
    perform pg_catalog.set_config('os.workspace_meeting_ok','1',true);
    meta:=jsonb_build_object('workspace','knowledge','visibility',case when public.os_is_partner() or p->>'visibility'='attendees' or p->>'templateName'='1:1' then 'attendees' else 'team' end,'agenda',coalesce(p->>'content',''),'items','[]'::jsonb);
    if nullif(p->>'previousMeetingId','') is not null then
      select * into m from public.os_records where id=(p->>'previousMeetingId')::uuid and status='done' and metadata->>'workspace'='knowledge';
      if not found or not public.os_can_read_meeting_record(m.id) then raise exception 'OS_MEETING_NOT_FOUND' using errcode='P0002'; end if;
      meta:=meta||jsonb_build_object('previousMeetingId',m.id,'visibility',case when public.os_is_partner() then 'attendees' else m.metadata->>'visibility' end,'agenda',m.metadata->>'agenda',
        'items',coalesce((select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'kind','task','text',t.title,'state','pending','ownerId',t.assignee_id,'dueOn',t.due_date)) from public.os_records t where t.parent_id=m.id and t.record_type='task' and t.archived_at is null and t.status not in ('done','cancelled')), '[]'::jsonb));
    end if;
    insert into public.os_records(record_type,title,description,status,owner_id,created_by,updated_by,starts_at,metadata)
      values('meeting',coalesce(nullif(btrim(p->>'title'),''),'회의 — '||(now() at time zone 'Asia/Seoul')::date::text),'','planned',u,u,u,nullif(p->>'startsAt','')::timestamptz,meta) returning id into rid;
    insert into public.os_meeting_attendees(meeting_id,user_id,added_by) values(rid,u,u);
    if m.id is not null then
      insert into public.os_meeting_attendees(meeting_id,user_id,added_by) select rid,a.user_id,u from public.os_meeting_attendees a join public.os_profiles profile on profile.id=a.user_id and profile.is_active where a.meeting_id=m.id on conflict do nothing;
    end if;
    insert into public.os_documents(title,content_md,folder,status,source,owner_id,created_by,meeting_record_id)
      select title,'','','team','wiki',u,u,rid from public.os_records where id=rid;
    perform pg_catalog.set_config('os.workspace_meeting_ok','',true);
  elsif a in ('meeting.save','meeting.start','meeting.finish','meeting.review','meeting.correct') then
    select * into m from public.os_records where id=rid and record_type='meeting' and metadata->>'workspace'='knowledge' and archived_at is null for update;
    if not found or not public.os_can_read_meeting_record(m.id) then raise exception 'OS_MEETING_NOT_FOUND' using errcode='P0002'; end if;
    if m.version is distinct from expected then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
    if not exists(select 1 from public.os_meeting_attendees where meeting_id=m.id and user_id=u) and not public.os_is_admin() then raise exception 'OS_MEETING_DENIED' using errcode='42501'; end if;
    perform pg_catalog.set_config('os.workspace_meeting_ok','1',true);
    meta:=m.metadata;
    if a='meeting.correct' then
      if m.status<>'done' or not(m.owner_id=u or public.os_is_admin()) or length(btrim(coalesce(p->>'reason','')))=0 or length(btrim(coalesce(p->>'content','')))=0 then raise exception 'OS_CORRECTION_DENIED' using errcode='42501'; end if;
      meta:=jsonb_set(meta,'{corrections}',coalesce(meta->'corrections','[]'::jsonb)||jsonb_build_array(jsonb_build_object('text',p->>'content','reason',p->>'reason','at',now(),'by',u)));
      update public.os_records set metadata=meta where id=m.id;
    else
      if m.status='done' then raise exception 'OS_MEETING_LOCKED' using errcode='42501'; end if;
      next_status:=m.status;
      if a='meeting.start' then
        if m.status<>'planned' then raise exception 'OS_MEETING_STATE' using errcode='22023'; end if; next_status:='active';
      elsif a='meeting.finish' then
        if m.status<>'active' then raise exception 'OS_MEETING_STATE' using errcode='22023'; end if; next_status:='review';
      elsif a='meeting.review' then
        if m.status<>'review' or not(m.owner_id=u or public.os_is_admin()) or exists(select 1 from jsonb_array_elements(meta->'items') i where i->>'state'='pending') then raise exception 'OS_MEETING_REVIEW_DENIED' using errcode='42501'; end if;
        next_status:='done'; meta:=meta||jsonb_build_object('reviewedBy',u,'reviewedAt',now());
        for item in select value from jsonb_array_elements(meta->'items') where value->>'state'='accepted' loop
          if coalesce(item->>'kind','') not in ('decision','task') or length(btrim(coalesce(item->>'text','')))=0 then raise exception 'OS_MEETING_ITEM_INVALID' using errcode='22023'; end if;
          insert into public.os_records(record_type,title,description,status,parent_id,owner_id,created_by,updated_by,assignee_id,due_date,metadata)
            values(item->>'kind',left(item->>'text',240),item->>'text',case when item->>'kind'='decision' then 'confirmed' else 'todo' end,m.id,u,u,u,nullif(item->>'ownerId','')::uuid,nullif(item->>'dueOn','')::date,jsonb_build_object('workspace','knowledge','meetingItemId',item->>'id','confirmedAt',now())) returning id into result_id;
        end loop;
      elsif a='meeting.save' then
        if m.status='review' and not(m.owner_id=u or public.os_is_admin()) then raise exception 'OS_MEETING_REVIEW_LOCKED' using errcode='42501'; end if;
        if p?'items' then
          if jsonb_typeof(p->'items')<>'array' or jsonb_array_length(p->'items')>100 then raise exception 'OS_MEETING_ITEMS_INVALID' using errcode='22023'; end if;
          for item in select value from jsonb_array_elements(p->'items') loop
            if coalesce(item->>'kind','') not in ('decision','task') or coalesce(item->>'state','') not in ('pending','accepted','discarded') or length(btrim(coalesce(item->>'text','')))=0 then raise exception 'OS_MEETING_ITEM_INVALID' using errcode='22023'; end if;
          end loop;
          meta:=jsonb_set(meta,'{items}',p->'items');
        end if;
        if p?'agenda' then meta:=jsonb_set(meta,'{agenda}',p->'agenda'); end if;
        if p?'summary' then meta:=jsonb_set(meta,'{summary}',p->'summary'); end if;
        if p?'attendees' or p?'visibility' then
          if not(m.owner_id=u or public.os_is_admin()) then raise exception 'OS_MEETING_OWNER_REQUIRED' using errcode='42501'; end if;
          if p?'visibility' then
            if p->>'visibility' not in ('team','attendees') or (p->>'visibility'='team' and public.os_is_partner()) then raise exception 'OS_VISIBILITY_INVALID' using errcode='22023'; end if;
            meta:=jsonb_set(meta,'{visibility}',p->'visibility');
          end if;
          if p?'attendees' then
            delete from public.os_meeting_attendees where meeting_id=m.id and user_id<>m.owner_id;
            for attendee in select distinct jsonb_array_elements_text(p->'attendees')::uuid loop
              if not exists(select 1 from public.os_profiles where id=attendee and is_active) then raise exception 'OS_ATTENDEE_INVALID' using errcode='22023'; end if;
              insert into public.os_meeting_attendees(meeting_id,user_id,added_by) values(m.id,attendee,u) on conflict do nothing;
            end loop;
          end if;
        end if;
      end if;
      update public.os_records set title=coalesce(nullif(btrim(p->>'title'),''),title),description=coalesce(p->>'content',description),
        status=next_status,metadata=meta,starts_at=case when a='meeting.start' then now() when p?'startsAt' then nullif(p->>'startsAt','')::timestamptz else starts_at end,
        ends_at=case when a='meeting.finish' then now() else ends_at end where id=m.id returning * into m;
      update public.os_documents set title=m.title,content_md=coalesce(meta->>'agenda','')||E'\n\n'||m.description,retention_hold=retention_hold or next_status='done' where meeting_record_id=m.id;
    end if;
    perform pg_catalog.set_config('os.workspace_meeting_ok','',true);
  else raise exception 'OS_UNKNOWN_COMMAND' using errcode='22023';
  end if;
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail) values(u,replace(a,'.','_'),case when a like 'meeting.%' then 'meeting' else 'proposal' end,rid,'{}');
  return jsonb_build_object('id',rid);
end $$;
revoke all on function public.os_knowledge_workflow_command(jsonb) from public,anon,authenticated;

-- Close the legacy approval RPC path with exactly the same checks as the new review screen.
create or replace function public.os_apply_document_proposal(p_proposal_id uuid,p_note text default '')
returns public.os_documents language plpgsql security definer set search_path='' as $$
declare d public.os_documents;
begin
  perform public.os_knowledge_workflow_command(jsonb_build_object('action','proposal.decide','id',p_proposal_id,'decision','approved','reason',p_note));
  select doc.* into d from public.os_documents doc join public.os_document_proposals p on p.document_id=doc.id where p.id=p_proposal_id;
  return d;
end $$;
revoke all on function public.os_apply_document_proposal(uuid,text) from public,anon;
grant execute on function public.os_apply_document_proposal(uuid,text) to authenticated;

create function public.os_workspace_guard_record() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if ((tg_op='INSERT' and new.record_type in ('meeting','decision') and new.metadata->>'workspace'='knowledge') or (tg_op<>'INSERT' and old.record_type in ('meeting','decision') and old.metadata->>'workspace'='knowledge'))
    and current_setting('os.workspace_meeting_ok',true) is distinct from '1' then
    raise exception 'OS_MEETING_COMMAND_REQUIRED' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger os_workspace_record_guard before insert or update or delete on public.os_records for each row execute function public.os_workspace_guard_record();
revoke all on function public.os_workspace_guard_record() from public,anon,authenticated;

create function public.os_workspace_guard_profile_kind() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.member_kind is distinct from old.member_kind and auth.uid() is not null and not public.os_is_admin() then raise exception 'OS_MEMBER_KIND_ADMIN_REQUIRED' using errcode='42501'; end if;
  return new;
end $$;
create trigger os_workspace_profile_kind_guard before update on public.os_profiles for each row execute function public.os_workspace_guard_profile_kind();
revoke all on function public.os_workspace_guard_profile_kind() from public,anon,authenticated;

create function public.os_workspace_guard_purge() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('os.workspace_purge_ok',true) is distinct from '1' then raise exception 'OS_PURGE_COMMAND_REQUIRED' using errcode='42501'; end if;
  return old;
end $$;
create trigger os_workspace_purge_guard before delete on public.os_documents for each row execute function public.os_workspace_guard_purge();
revoke all on function public.os_workspace_guard_purge() from public,anon,authenticated;
-- Version properties are additive; older snapshots remain explicitly unknown.
alter table public.os_document_versions add column if not exists properties jsonb;
create function public.os_workspace_version_properties() returns trigger language plpgsql security definer set search_path='' as $$
begin
  select jsonb_build_object('folder',d.folder,'brand',d.brand,'team',d.team,'tags',d.tags,'review_due_on',d.review_due_on)
    into new.properties from public.os_documents d where d.id=new.document_id;
  return new;
end $$;
create trigger os_workspace_version_properties before insert on public.os_document_versions for each row execute function public.os_workspace_version_properties();
revoke all on function public.os_workspace_version_properties() from public,anon,authenticated;

-- Knowledge-only notices use the existing inbox, with no copied document body/title.
create function public.os_enqueue_knowledge_notice(recipient uuid,actor uuid,source_type text,source_id uuid,reason text,dedupe text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if recipient is null or not exists(select 1 from public.os_profiles where id=recipient and is_active) then return; end if;
  if reason not in ('knowledge_review','knowledge_update','knowledge_access','knowledge_reminder','knowledge_mention') or source_type not in ('record','document') then raise exception 'OS_KNOWLEDGE_NOTICE_INVALID'; end if;
  insert into public.os_records(record_type,title,description,status,owner_id,created_by,updated_by,metadata)
    values('notification','업무 알림','','unread',recipient,coalesce(actor,recipient),coalesce(actor,recipient),
      jsonb_build_object('sourceType',source_type,'sourceId',source_id::text,'reason',reason,'readAt','','dedupeKey','knowledge:'||source_id::text||':'||recipient::text||':'||reason||':'||dedupe))
    on conflict do nothing;
end $$;
revoke all on function public.os_enqueue_knowledge_notice(uuid,uuid,text,uuid,text,text) from public,anon,authenticated;

-- Recipient checks do not impersonate a user or rely on an admin's audit grant.
-- Every ancestor must be readable, so a public child cannot leak a private tree.
create function public.os_workspace_recipient_read(p_document uuid,p_recipient uuid)
returns boolean language sql stable security definer set search_path='' as $$
  with recursive chain as (
    select d.*,array[d.id] as visited,false as cycle from public.os_documents d where d.id=p_document
    union all
    select d.*,c.visited||d.id,d.id=any(c.visited) from public.os_documents d join chain c on d.id=c.parent_document_id
      where not c.cycle and cardinality(c.visited)<64
  ) select coalesce(bool_and(not d.cycle and case
    when p.member_kind='partner' and d.source='mcp' and d.status<>'canonical' then false
    when d.status='archived' then false
    when d.status='draft' then d.owner_id=p.id
    when d.meeting_record_id is not null then exists(select 1 from public.os_records m where m.id=d.meeting_record_id and m.archived_at is null and
      (exists(select 1 from public.os_meeting_attendees a where a.meeting_id=m.id and a.user_id=p.id)
        or (p.member_kind='staff' and m.metadata->>'visibility'='team')))
    when d.status='canonical' then true
    when d.status not in ('team','review','reviewed') then false
    when p.member_kind='partner' then d.source<>'mcp' and (d.owner_id=p.id or exists(select 1 from public.os_doc_categories c where c.id=d.category_id and c.archived_at is null and p.id=any(c.partner_ids)))
    else true end) and bool_or(d.parent_document_id is null),false)
  from chain d cross join public.os_profiles p where p.id=p_recipient and p.is_active
$$;
revoke all on function public.os_workspace_recipient_read(uuid,uuid) from public,anon,authenticated;

create function public.os_workspace_mention_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; previous text:='';
begin
  if tg_op='UPDATE' then
    if new.content_md is not distinct from old.content_md then return new; end if;
    previous:=old.content_md;
  end if;
  -- Draft autosaves are in os_document_drafts and never reach this trigger.
  for recipient in select distinct (m)[1]::uuid from regexp_matches(new.content_md,'@\{([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\|[^{}]+\}','g') m loop
    if recipient is distinct from auth.uid()
      and not exists(select 1 from regexp_matches(previous,'@\{([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\|[^{}]+\}','g') m where (m)[1]::uuid=recipient)
      and public.os_workspace_recipient_read(new.id,recipient) then
      perform public.os_enqueue_knowledge_notice(recipient,coalesce(auth.uid(),new.owner_id),'document',new.id,'knowledge_mention',new.current_version::text);
    end if;
  end loop;
  return new;
end $$;
create trigger os_workspace_mention_notice after insert or update of content_md on public.os_documents for each row execute function public.os_workspace_mention_notice();
revoke all on function public.os_workspace_mention_notice() from public,anon,authenticated;

create function public.os_workspace_review_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; sender uuid; reason text; key text; doc uuid;
begin
  doc:=new.document_id;
  if tg_table_name='os_document_proposals' then
    sender:=new.author_id; key:=new.id::text||':'||new.updated_at::text;
    if new.agent_key_id is not null then select owner_user_id into sender from public.os_agent_keys where id=new.agent_key_id; end if;
  else sender:=new.submitted_by; key:=new.id::text; end if;
  if new.status='open' and (tg_op='INSERT' or old.status is distinct from new.status) then
    if new.requested_approver_id is not null then
      perform public.os_enqueue_knowledge_notice(new.requested_approver_id,sender,'document',doc,'knowledge_review',key);
    else
      for recipient in select id from public.os_profiles where is_active and role='admin' and member_kind='staff' and id is distinct from sender loop
        perform public.os_enqueue_knowledge_notice(recipient,sender,'document',doc,'knowledge_review',key);
      end loop;
    end if;
  elsif tg_op='UPDATE' and new.status is distinct from old.status and new.status in ('approved','returned') then
    perform public.os_enqueue_knowledge_notice(sender,auth.uid(),'document',doc,'knowledge_update',key||':'||new.status);
  end if;
  return new;
end $$;
create trigger os_workspace_proposal_notice after insert or update on public.os_document_proposals for each row execute function public.os_workspace_review_notice();
create trigger os_workspace_candidate_notice after insert or update on public.os_document_candidates for each row execute function public.os_workspace_review_notice();
revoke all on function public.os_workspace_review_notice() from public,anon,authenticated;

create function public.os_workspace_meeting_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
  if new.record_type<>'meeting' or new.metadata->>'workspace' is distinct from 'knowledge' then return new; end if;
  if tg_op='UPDATE' and new.status is distinct from old.status and new.status in ('active','done') then
    for recipient in select user_id from public.os_meeting_attendees where meeting_id=new.id and user_id<>coalesce(auth.uid(),new.owner_id) loop
      perform public.os_enqueue_knowledge_notice(recipient,auth.uid(),'record',new.id,'knowledge_update',new.version::text);
    end loop;
  end if;
  return new;
end $$;
create trigger os_workspace_meeting_notice after update on public.os_records for each row execute function public.os_workspace_meeting_notice();
revoke all on function public.os_workspace_meeting_notice() from public,anon,authenticated;

create function public.os_workspace_attendee_notice() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.user_id<>new.added_by then perform public.os_enqueue_knowledge_notice(new.user_id,new.added_by,'record',new.meeting_id,'knowledge_update','attendee:'||new.added_at::text); end if;
  return new;
end $$;
create trigger os_workspace_attendee_notice after insert on public.os_meeting_attendees for each row execute function public.os_workspace_attendee_notice();
revoke all on function public.os_workspace_attendee_notice() from public,anon,authenticated;

-- Service-only bounded maintenance. No schedule or enabled setting is created.
create function public.os_workspace_purge_expired() returns integer language plpgsql security definer set search_path='' as $$
declare d public.os_documents; removed integer:=0;
begin
  perform pg_catalog.set_config('os.workspace_purge_ok','1',true);
  for d in select * from public.os_documents
    where status='archived' and archived_at is not null and archived_at<now()-interval '30 days'
      and not retention_hold and archived_from_status is distinct from 'canonical' and meeting_record_id is null
      and not exists(select 1 from public.os_documents child where child.parent_document_id=os_documents.id)
    order by archived_at,id limit 100 for update skip locked
  loop
    delete from public.os_document_proposal_comments where proposal_id in(select id from public.os_document_proposals where document_id=d.id);
    delete from public.os_document_proposals where document_id=d.id;
    delete from public.os_document_candidates where document_id=d.id;
    delete from public.os_documents where id=d.id;
    insert into public.os_knowledge_events(action,target_type,target_id,detail) values('document_purge','document',d.id,jsonb_build_object('reason','30일 지난 휴지통 자동 정리','system',true));
    removed:=removed+1;
  end loop;
  perform pg_catalog.set_config('os.workspace_purge_ok','',true);
  return removed;
end $$;
revoke all on function public.os_workspace_purge_expired() from public,anon,authenticated;
grant execute on function public.os_workspace_purge_expired() to service_role;

create function public.os_workspace_send_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare item record; today date:=(now() at time zone 'Asia/Seoul')::date; count_before bigint; count_after bigint;
begin
  -- Serialize this short job to make the returned insertion count meaningful.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('knowledge-reminders',0));
  select count(*) into count_before from public.os_records where record_type='notification' and metadata->>'reason'='knowledge_reminder';
  for item in select id,steward_id,review_due_on from public.os_documents where status='canonical' and review_due_on<today and steward_id is not null and mod(today-review_due_on-1,7)=0 loop
    perform public.os_enqueue_knowledge_notice(item.steward_id,null,'document',item.id,'knowledge_reminder','canon:'||today::text);
  end loop;
  for item in select id,document_id,requested_approver_id,updated_at from public.os_document_proposals where status='open' and updated_at<now()-interval '48 hours' and requested_approver_id is not null loop
    perform public.os_enqueue_knowledge_notice(item.requested_approver_id,null,'document',item.document_id,'knowledge_reminder','proposal:'||item.id::text||':'||item.updated_at::text);
  end loop;
  for item in select id,document_id,requested_approver_id from public.os_document_candidates where status='open' and submitted_at<now()-interval '48 hours' loop
    perform public.os_enqueue_knowledge_notice(item.requested_approver_id,null,'document',item.document_id,'knowledge_reminder','candidate:'||item.id::text);
  end loop;
  for item in select id,owner_id,version from public.os_records where record_type='meeting' and metadata->>'workspace'='knowledge' and status='review' and archived_at is null and updated_at<now()-interval '48 hours' loop
    perform public.os_enqueue_knowledge_notice(item.owner_id,null,'record',item.id,'knowledge_reminder','meeting-review:'||item.id::text);
  end loop;
  select count(*) into count_after from public.os_records where record_type='notification' and metadata->>'reason'='knowledge_reminder';
  return (count_after-count_before)::integer;
end $$;
revoke all on function public.os_workspace_send_reminders() from public,anon,authenticated;
grant execute on function public.os_workspace_send_reminders() to service_role;

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
