-- 재무 요청 a5310134 (2026-10-29): 홈택스 전자(세금)계산서 매출 + 같은 매출·입금 연결 기록 + 부가세 참고 자료 내려받기 기록.
-- Additive: two new tables with the same finance access rules as the other os_fin_* tables (read and write only for
-- active members with finance access; rows are soft-deleted). os_fin_log_action also accepts the two new screens.
-- No existing row, column or policy changes.
begin;

create table public.os_fin_tax_invoices (
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
create index os_fin_tax_invoices_biz_date_idx on public.os_fin_tax_invoices (biz, written_date) where archived_at is null;

-- Only decisions are stored: a pair confirmed as the same sale (counted once) or rejected (never suggested again).
create table public.os_fin_revenue_links (
  id uuid primary key default gen_random_uuid(),
  tax_invoice_id uuid not null references public.os_fin_tax_invoices(id),
  target_type text not null check (target_type in ('payment', 'external_revenue', 'bank_tx')),
  target_ref text not null check (char_length(target_ref) between 1 and 200),
  state text not null check (state in ('confirmed', 'rejected')),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version integer not null default 1, archived_at timestamptz,
  unique (tax_invoice_id, target_type, target_ref)
);
create index os_fin_revenue_links_target_idx on public.os_fin_revenue_links (target_type, target_ref) where archived_at is null;
-- One confirmed same-sale partner and one confirmed deposit per invoice.
create unique index os_fin_revenue_links_one_sale on public.os_fin_revenue_links (tax_invoice_id) where state = 'confirmed' and target_type <> 'bank_tx' and archived_at is null;
create unique index os_fin_revenue_links_one_deposit on public.os_fin_revenue_links (tax_invoice_id) where state = 'confirmed' and target_type = 'bank_tx' and archived_at is null;

do $$
declare t text;
begin
  foreach t in array array['tax_invoices', 'revenue_links'] loop
    execute format('alter table public.os_fin_%I enable row level security', t);
    execute format('revoke all on public.os_fin_%I from public, anon, authenticated', t);
    execute format('grant select, insert, update on public.os_fin_%I to authenticated', t);
    execute format('grant all on public.os_fin_%I to service_role', t);
    execute format('create policy finance_read on public.os_fin_%I for select to authenticated using ((select public.os_is_active_member()) and (select public.os_has_finance_access()))', t);
    execute format('create policy finance_insert on public.os_fin_%I for insert to authenticated with check ((select public.os_is_active_member()) and (select public.os_has_finance_access()) and created_by = (select auth.uid()) and updated_by = (select auth.uid()))', t);
    execute format('create policy finance_update on public.os_fin_%I for update to authenticated using ((select public.os_is_active_member()) and (select public.os_has_finance_access())) with check ((select public.os_is_active_member()) and (select public.os_has_finance_access()) and updated_by = (select auth.uid()))', t);
  end loop;
end $$;

-- The CSV/엑셀 download log also names the 세금계산서 list and 부가세 참고 자료.
create or replace function public.os_fin_log_action(p_kind text, p_view text, p_ids uuid[] default '{}') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.os_is_active_member() or not public.os_has_finance_access() then raise exception 'FINANCE_FORBIDDEN'; end if;
  if p_kind not in ('csv_export', 'memo_request') or p_view not in ('overview', 'sales', 'settlements', 'bank', 'cards', 'recurring', 'budget', 'tax_invoices', 'vat') or cardinality(p_ids) > 1000 then raise exception 'FINANCE_INVALID_ACTION'; end if;
  if p_kind = 'memo_request' and (cardinality(p_ids) = 0 or exists(select 1 from unnest(p_ids) i where not exists(select 1 from public.os_fin_card_transactions c where c.id = i and c.archived_at is null))) then raise exception 'FINANCE_INVALID_ACTION'; end if;
  insert into public.os_fin_events(kind, subject_table, subject_id, summary, after, created_by, updated_by)
    values(p_kind, 'finance', p_view, case when p_kind = 'memo_request' then 'Mock memo request (no messages sent)' else 'CSV export requested' end,
      jsonb_build_object('count', cardinality(p_ids), 'mock', p_kind = 'memo_request'), auth.uid(), auth.uid());
end $$;
revoke all on function public.os_fin_log_action(text, text, uuid[]) from public, anon;
grant execute on function public.os_fin_log_action(text, text, uuid[]) to authenticated;

commit;
