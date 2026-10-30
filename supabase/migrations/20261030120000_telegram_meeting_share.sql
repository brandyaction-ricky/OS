-- 회의 확정 → 텔레그램 (2026-10-30): a chat set with /회의공유 마이인|에듀|회사 receives each confirmed meeting of that business.
-- Additive: one nullable column; existing chats stay off.
alter table public.os_telegram_chats add column if not exists meeting_share_business text
  check (meeting_share_business in ('myin', 'edu', 'company'));
