begin;

-- Third handoff: people directory metadata and finance access.
alter table public.os_profiles add column if not exists affiliation text not null default '브랜디액션';
alter table public.os_profiles add column if not exists roles text[] not null default '{}';
alter table public.os_profiles add column if not exists onboarding jsonb not null default '{}'::jsonb;
alter table public.os_profiles add column if not exists finance_access boolean not null default false;

update public.os_profiles
set finance_access = true
where role = 'admin' or lower(email) in ('rickyjeon89@gmail.com', 'wjdgh1346@gmail.com');

create or replace function public.os_has_finance_access()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.os_profiles p
    where p.id = auth.uid() and p.is_active and (p.finance_access or p.role = 'admin')
  );
$$;

-- Expand the shared record layer without replacing existing records.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.os_records'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%record_type%'
  loop
    execute format('alter table public.os_records drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.os_records add constraint os_records_record_type_check check (record_type in (
  'project', 'task', 'goal', 'kpi', 'decision', 'meeting', 'ai_job',
  'content_topic', 'content_script', 'content_package', 'content_short',
  'content_publish', 'content_metric', 'skill', 'knowledge_link',
  'revenue', 'funnel', 'crm_action', 'customer', 'brand',
  'connection', 'access_rule', 'company_setting', 'channel',
  'leave_balance', 'leave_request', 'expense', 'contract', 'subscription', 'company_document'
));

drop policy if exists os_records_active_select on public.os_records;
create policy os_records_active_select on public.os_records
  for select to authenticated using (
    public.os_is_active_member()
    and (
      record_type not in ('expense', 'contract', 'subscription', 'company_document')
      or public.os_has_finance_access()
    )
  );

drop policy if exists os_records_active_insert on public.os_records;
create policy os_records_active_insert on public.os_records
  for insert to authenticated with check (
    public.os_is_active_member()
    and created_by = auth.uid() and updated_by = auth.uid()
    and (
      record_type not in ('expense', 'contract', 'subscription', 'company_document')
      or public.os_has_finance_access()
    )
  );

drop policy if exists os_records_owner_update on public.os_records;
create policy os_records_owner_update on public.os_records
  for update to authenticated using (
    public.os_is_active_member()
    and (
      record_type not in ('expense', 'contract', 'subscription', 'company_document')
      or public.os_has_finance_access()
    )
    and (created_by = auth.uid() or owner_id = auth.uid() or assignee_id = auth.uid() or public.os_is_admin())
  ) with check (
    public.os_is_active_member()
    and (
      record_type not in ('expense', 'contract', 'subscription', 'company_document')
      or public.os_has_finance_access()
    )
  );

-- A metadata-first list avoids sending every Markdown body to the browser.
create or replace function public.os_list_documents_v3(
  p_limit integer default 100,
  p_offset integer default 0,
  p_statuses public.os_doc_status[] default null,
  p_owner uuid default null,
  p_folder_prefix text default null,
  p_query text default null,
  p_include_content boolean default false
) returns table (
  id uuid,
  title text,
  content_md text,
  folder text,
  status public.os_doc_status,
  brand text,
  team text,
  tags text[],
  source text,
  source_ref text,
  owner_id uuid,
  created_by uuid,
  current_version integer,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id, d.title,
         case when p_include_content then d.content_md else '' end,
         d.folder, d.status, d.brand, d.team, d.tags, d.source, d.source_ref,
         d.owner_id, d.created_by, d.current_version, d.created_at, d.updated_at,
         count(*) over() as total_count
  from public.os_documents d
  where exists (
      select 1 from public.os_profiles me
      where me.id = auth.uid() and me.is_active
    )
    and (public.os_is_admin() or public.os_can_read_document(d.owner_id, d.status, d.team))
    and (p_statuses is null or d.status = any(p_statuses))
    and (p_owner is null or d.owner_id = p_owner)
    and (p_folder_prefix is null or d.folder = p_folder_prefix or d.folder like p_folder_prefix || '/%')
    and (p_query is null or d.title ilike '%' || p_query || '%' or d.content_md ilike '%' || p_query || '%')
  order by d.updated_at desc, d.id
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.os_list_documents_v3(integer, integer, public.os_doc_status[], uuid, text, text, boolean) from public, anon;
grant execute on function public.os_list_documents_v3(integer, integer, public.os_doc_status[], uuid, text, text, boolean) to authenticated;

-- Leave approval and balance deduction are one transaction and admin-only.
create or replace function public.os_decide_leave_request(
  p_request_id uuid,
  p_expected_version integer,
  p_status text
) returns public.os_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.os_records;
  balance_row public.os_records;
  leave_days numeric;
begin
  if not public.os_is_admin() then raise exception using errcode = '42501', message = 'ADMIN_REQUIRED'; end if;
  if p_status not in ('approved','rejected') then raise exception using errcode = '22023', message = 'INVALID_LEAVE_STATUS'; end if;
  select * into request_row from public.os_records
    where id = p_request_id and record_type = 'leave_request' and version = p_expected_version and archived_at is null
    for update;
  if request_row.id is null then return null; end if;
  if request_row.status <> 'pending' then raise exception using errcode = '22023', message = 'LEAVE_ALREADY_DECIDED'; end if;
  update public.os_records set status = p_status, updated_by = auth.uid()
    where id = request_row.id returning * into request_row;
  if p_status = 'approved' then
    leave_days := coalesce((request_row.metadata->>'days')::numeric, request_row.metric_current, 0);
    select * into balance_row from public.os_records
      where record_type = 'leave_balance' and archived_at is null
        and metadata->>'memberId' = coalesce(request_row.metadata->>'memberId', request_row.assignee_id::text)
      order by updated_at desc limit 1 for update;
    if balance_row.id is not null then
      update public.os_records set
        metric_current = greatest(0, coalesce(balance_row.metric_current, 0) - leave_days),
        progress = case when coalesce(balance_row.metric_target, 0) > 0 then
          round(((coalesce(balance_row.metric_target, 0) - greatest(0, coalesce(balance_row.metric_current, 0) - leave_days)) / balance_row.metric_target) * 100)::integer
          else 0 end,
        updated_by = auth.uid()
      where id = balance_row.id;
    end if;
  end if;
  return request_row;
end;
$$;

revoke all on function public.os_decide_leave_request(uuid, integer, text) from public, anon;
grant execute on function public.os_decide_leave_request(uuid, integer, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'os-company-files', 'os-company-files', false, 10000000,
  array['application/pdf','image/jpeg','image/png','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Telegram access requests can be approved from the OS without a redeploy.
create table if not exists public.os_telegram_users (
  external_user_id text primary key,
  external_chat_id text,
  display_name text not null default '',
  username text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.os_profiles(id) on delete set null
);

alter table public.os_telegram_users enable row level security;
drop policy if exists os_telegram_users_admin_select on public.os_telegram_users;
create policy os_telegram_users_admin_select on public.os_telegram_users
  for select to authenticated using (public.os_is_admin());
drop policy if exists os_telegram_users_admin_update on public.os_telegram_users;
create policy os_telegram_users_admin_update on public.os_telegram_users
  for update to authenticated using (public.os_is_admin()) with check (public.os_is_admin());

commit;
