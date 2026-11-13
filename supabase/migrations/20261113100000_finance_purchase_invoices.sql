-- 재무 2026-11-13: 홈택스 전자(세금)계산서 매입 → 부가세 참고 자료의 매입세액 · 예상 납부세액 (매출세액 − 매입세액).
-- Additive: one new table with the same columns, checks and finance access rules as os_fin_tax_invoices (read and write
-- only for active members with finance access; rows are soft-deleted, no delete grant). Here the supplier is the
-- counterparty and the buyer is our business. No existing row, column, policy or function changes.
-- REVIEW ONLY: not applied to any database. DEV and Production each need the owner's approval first; until then the
-- API answers "not ready" and the rest of 부가세 참고 자료 keeps working.
begin;

create table public.os_fin_purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  biz text not null check (biz in ('ba', 'edu', 'myin', 'hm')),
  approval_no text not null unique check (char_length(approval_no) between 1 and 40),
  invoice_class text not null default 'tax' check (invoice_class in ('tax', 'exempt')),
  is_modified boolean not null default false,
  kind_label text not null default '' check (char_length(kind_label) <= 40),
  written_date date not null,
  issued_date date,
  sent_date date,
  supplier_reg_no text not null default '' check (supplier_reg_no ~ '^\d{0,10}$'),
  supplier_name text not null default '' check (char_length(supplier_name) <= 120),
  buyer_reg_no text not null default '' check (buyer_reg_no ~ '^\d{0,13}$'),
  buyer_name text not null default '' check (char_length(buyer_name) <= 120),
  buyer_email text not null default '' check (char_length(buyer_email) <= 200),
  item_summary text not null default '' check (char_length(item_summary) <= 300),
  supply_amount bigint not null,
  tax_amount bigint not null default 0,
  total_amount bigint not null,
  receipt_type text not null default '' check (char_length(receipt_type) <= 20),
  memo text not null default '' check (char_length(memo) <= 500),
  source text not null default 'hometax_excel' check (source in ('hometax_excel', 'popbill')),
  import_batch_id uuid,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version integer not null default 1, archived_at timestamptz,
  check (total_amount = supply_amount + tax_amount),
  check (invoice_class = 'tax' or tax_amount = 0)
);
create index os_fin_purchase_invoices_biz_date_idx on public.os_fin_purchase_invoices (biz, written_date) where archived_at is null;

do $$
declare t text;
begin
  foreach t in array array['purchase_invoices'] loop
    execute format('alter table public.os_fin_%I enable row level security', t);
    execute format('revoke all on public.os_fin_%I from public, anon, authenticated', t);
    execute format('grant select, insert, update on public.os_fin_%I to authenticated', t);
    execute format('grant all on public.os_fin_%I to service_role', t);
    execute format('create policy finance_read on public.os_fin_%I for select to authenticated using ((select public.os_is_active_member()) and (select public.os_has_finance_access()))', t);
    execute format('create policy finance_insert on public.os_fin_%I for insert to authenticated with check ((select public.os_is_active_member()) and (select public.os_has_finance_access()) and created_by = (select auth.uid()) and updated_by = (select auth.uid()))', t);
    execute format('create policy finance_update on public.os_fin_%I for update to authenticated using ((select public.os_is_active_member()) and (select public.os_has_finance_access())) with check ((select public.os_is_active_member()) and (select public.os_has_finance_access()) and updated_by = (select auth.uid()))', t);
  end loop;
end $$;

commit;
