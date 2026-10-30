-- 회의 확정 → 텔레그램 (2026-10-30): a chat that typed /회의공유켜기 receives each confirmed meeting's summary.
-- Additive: one column with a default; existing chats stay off.
alter table public.os_telegram_chats add column if not exists meeting_summary_enabled boolean not null default false;
