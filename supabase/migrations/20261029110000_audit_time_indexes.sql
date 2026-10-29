-- 변경 기록: the audit list reads the newest rows of each log by created_at, but these three logs had no index that
-- starts with created_at, so every open scanned whole tables (os_record_events ~38,000 rows: ~0.74 s cold).
-- Additive indexes only; no data, policy or grant change.
begin;

create index if not exists os_record_events_created_idx on public.os_record_events (created_at desc);
create index if not exists os_document_events_created_idx on public.os_document_events (created_at desc);
create index if not exists os_agent_audit_logs_created_idx on public.os_agent_audit_logs (created_at desc);

commit;
