-- Development operations are stored as first-class records so ChatGPT Work and
-- the OS UI can share one auditable project history.
do $$
declare
  c record;
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
  'development_log', 'deployment',
  'content_topic', 'content_script', 'content_package', 'content_short',
  'content_publish', 'content_metric', 'skill', 'knowledge_link',
  'revenue', 'funnel', 'crm_action', 'customer', 'brand',
  'connection', 'access_rule', 'company_setting', 'channel',
  'leave_balance', 'leave_request', 'expense', 'contract', 'subscription', 'company_document'
));

create index if not exists os_records_project_history_idx
  on public.os_records(parent_id, record_type, updated_at desc)
  where archived_at is null and record_type in ('task', 'ai_job', 'decision', 'development_log', 'deployment');
