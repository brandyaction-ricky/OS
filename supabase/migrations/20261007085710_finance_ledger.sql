-- Additive finance ledger. REVIEW ONLY: applying this file requires DEV approval.
-- No demo, store, financial or employee data is inserted by this migration.
create table public.os_fin_settings (id uuid primary key default gen_random_uuid(), key text unique not null, value jsonb not null);
create table public.os_fin_stores (
  id uuid primary key default gen_random_uuid(), biz text unique not null check(biz in ('edu','myin','hm')),
  name text not null, status text not null default 'disconnected' check(status in ('connected','pending','disconnected')),
  secret_env text not null, settle_lag_bdays smallint not null default 3, fee_rate_estimate numeric(5,4),
  bank_keyword text not null default '토스페이먼츠', last_tx_synced_at timestamptz, last_settlement_synced_at timestamptz,
  tx_cursor jsonb, settlement_cursor jsonb
);
create table public.os_fin_payments (
  id uuid primary key default gen_random_uuid(), store_id uuid not null references public.os_fin_stores,
  biz text not null, payment_key text unique not null, order_id text not null, order_name text not null,
  method text not null, card_issuer text, amount bigint not null check(amount>=0),
  status text not null check(status in ('DONE','CANCELED','PARTIAL_CANCELED','WAITING_FOR_DEPOSIT')),
  canceled_amount bigint not null default 0 check(canceled_amount>=0 and canceled_amount<=amount),
  approved_at timestamptz, paid_date date not null, fee bigint, customer_masked text not null default '',
  source_channel text, raw jsonb not null default '{}', synced_at timestamptz
);
create table public.os_fin_payment_cancels (
  id uuid primary key default gen_random_uuid(), payment_id uuid not null references public.os_fin_payments,
  transaction_key text unique not null, cancel_amount bigint not null check(cancel_amount>0),
  canceled_at timestamptz not null, cancel_date date not null, reason text not null check(length(reason)<=200),
  fee_refund bigint, origin text not null check(origin in ('toss_sync','os_refund'))
);
create table public.os_fin_settlements (
  id uuid primary key default gen_random_uuid(), store_id uuid not null references public.os_fin_stores,
  biz text not null, payment_key text not null, transaction_key text not null, is_cancel boolean not null,
  method text not null, amount bigint not null, fee bigint not null, supply_fee bigint, vat_fee bigint,
  pay_out_amount bigint not null, sold_date date not null, paid_out_date date not null, raw jsonb not null default '{}',
  unique(store_id,transaction_key), check(pay_out_amount=amount-fee)
);
create table public.os_fin_payout_notes (
  id uuid primary key default gen_random_uuid(), store_id uuid not null references public.os_fin_stores,
  paid_out_date date not null, reason text not null, memo text not null default '' check(length(memo)<=300)
);
create table public.os_fin_refund_requests (
  id uuid primary key default gen_random_uuid(), payment_id uuid not null references public.os_fin_payments,
  kind text not null check(kind in ('full','partial')), amount bigint not null check(amount>0),
  reason text not null check(length(reason) between 1 and 200),
  state text not null default 'requested' check(state in ('requested','executing','done','failed','rejected')),
  requested_by uuid not null, requested_at timestamptz not null default now(), decided_by uuid,
  decided_at timestamptz, execution_started_at timestamptz, attempt_at timestamptz,
  result jsonb not null default '{}', mock boolean not null default true,
  check(decided_by is null or decided_by<>requested_by)
);
create table public.os_fin_external_revenues (
  id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('youtube','outsource','lecture','etc')),
  biz text not null check(biz in ('ba','edu','myin','hm')), title text not null check(length(title) between 1 and 120),
  client text not null default '' check(length(client)<=80), revenue_date date not null, usd numeric(12,2),
  supply bigint not null default 0 check(supply>=0), vat bigint not null default 0 check(vat>=0),
  due_date date, invoice text not null default '' check(length(invoice)<=120), memo text not null default '' check(length(memo)<=300),
  check((kind='youtube' and usd>0) or (kind<>'youtube' and supply>0))
);
create table public.os_fin_bank_accounts (
  id uuid primary key default gen_random_uuid(), bank text not null check(length(bank)<=30),
  name text not null check(length(name) between 1 and 30), last4 text check(last4~'^[0-9]{4}$'),
  uses text[] not null default '{}', method text not null check(method in ('excel','bank_api','openbanking','aggregator')),
  sync_freq text not null check(sync_freq in ('hourly','4x_daily','daily_0700')),
  include_in_net boolean not null default true, opening_balance bigint, last_synced_at timestamptz
);
create table public.os_fin_import_mappings (
  id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('card','bank')),
  header_signature text not null, columns jsonb not null, unique(kind,header_signature)
);
create table public.os_fin_import_batches (
  id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('card','bank')),
  account_id uuid references public.os_fin_bank_accounts, file_name text not null check(length(file_name)<=150),
  row_count integer not null check(row_count between 0 and 5000), inserted integer not null, duplicates integer not null,
  skipped integer not null, period_from date, period_to date, mapping_id uuid references public.os_fin_import_mappings
);
create table public.os_fin_bank_transactions (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.os_fin_bank_accounts,
  tx_date date not null, time text not null, deposit bigint not null default 0 check(deposit>=0),
  withdrawal bigint not null default 0 check(withdrawal>=0), balance_after bigint,
  description text not null check(length(description) between 1 and 200), branch text,
  dedupe_key text not null, manual_category text, link_type text check(link_type in ('payout','external_revenue','transfer')),
  link_ref text, import_batch_id uuid references public.os_fin_import_batches,
  unique(account_id,dedupe_key), check((deposit>0 and withdrawal=0) or (withdrawal>0 and deposit=0)),
  check((link_type is null)=(link_ref is null))
);
create table public.os_fin_bank_rules (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 50),
  keyword text not null check(length(keyword) between 1 and 50), direction text not null check(direction in ('in','out')),
  category text not null check(category<>'내 통장 간 이체'), enabled boolean not null default true, sort_order integer not null default 0
);
create table public.os_fin_cards (
  id uuid primary key default gen_random_uuid(), issuer text not null default 'KB국민카드', name text not null check(length(name) between 1 and 30),
  last4 text not null check(last4~'^[0-9]{4}$'), holder_profile_id uuid references public.os_profiles,
  holder_name text not null default '' check(length(holder_name)<=40)
);
create table public.os_fin_card_transactions (
  id uuid primary key default gen_random_uuid(), card_id uuid not null references public.os_fin_cards,
  used_date date not null, time text not null, merchant text not null check(length(merchant) between 1 and 120),
  amount_krw bigint not null check(amount_krw>=0), foreign_amount numeric(12,2), currency char(3), approval_no text not null,
  installment smallint, canceled boolean not null default false, manual_category text, manual_biz text, manual_vat text,
  memo text check(length(memo)<=200), receipt_path text, import_batch_id uuid references public.os_fin_import_batches,
  unique(card_id,approval_no,used_date)
);
create table public.os_fin_card_rules (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 40),
  keywords text[] not null check(cardinality(keywords)>0), category text not null, biz text not null, vat_type text not null,
  memo_template text not null default '' check(length(memo_template)<=100), enabled boolean not null default true, sort_order integer not null default 0
);
create table public.os_fin_recurring_overrides (
  id uuid primary key default gen_random_uuid(), merchant_key text unique not null, owner_profile_id uuid references public.os_profiles,
  owner_name text not null default '', state text not null check(state in ('유지','해지 검토','해지함'))
);
create table public.os_fin_budget_items (
  id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('fixed','variable','labor')),
  name text not null check(length(name) between 1 and 40), biz text not null,
  monthly_amount bigint not null check(monthly_amount>=0), source text not null check(source in ('card','bank','manual')),
  card_categories text[] not null default '{}', bank_categories text[] not null default '{}',
  owner_name text not null default '', memo text not null default '' check(length(memo)<=200), sort_order integer not null default 0,
  check(source<>'card' or cardinality(card_categories)>0),
  check(source<>'bank' or (cardinality(bank_categories)>0 and not bank_categories && array['카드 대금','강사 정산','내 통장 간 이체']))
);
create table public.os_fin_budget_actuals (
  id uuid primary key default gen_random_uuid(), item_id uuid not null references public.os_fin_budget_items,
  month date not null check(extract(day from month)=1), amount bigint not null check(amount>=0), unique(item_id,month)
);
create table public.os_fin_events (
  id uuid primary key default gen_random_uuid(), kind text not null, subject_table text not null, subject_id text not null,
  summary text not null check(length(summary)<=300), before jsonb, after jsonb
);

-- Consistent metadata/RLS, limited to these newly introduced tables.
do $$ declare t text; begin
  foreach t in array array['settings','stores','payments','payment_cancels','settlements','payout_notes','refund_requests',
    'external_revenues','bank_accounts','bank_transactions','bank_rules','cards','card_transactions','card_rules',
    'recurring_overrides','budget_items','budget_actuals','import_batches','import_mappings','events'] loop
    execute format('alter table public.os_fin_%I add column created_by uuid, add column updated_by uuid, add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now(), add column version integer not null default 1, add column archived_at timestamptz',t);
    execute format('alter table public.os_fin_%I enable row level security',t);
    execute format('revoke all on public.os_fin_%I from public, anon, authenticated',t);
    execute format('grant select on public.os_fin_%I to authenticated',t);
    execute format('grant all on public.os_fin_%I to service_role',t);
    execute format('create policy finance_read on public.os_fin_%I for select to authenticated using ((select public.os_is_active_member()) and (select public.os_has_finance_access()))',t);
    if t not in ('stores','payments','payment_cancels','settlements','refund_requests','events') then
      execute format('grant insert,update on public.os_fin_%I to authenticated',t);
      execute format('create policy finance_insert on public.os_fin_%I for insert to authenticated with check ((select public.os_is_active_member()) and (select public.os_has_finance_access()) and created_by=(select auth.uid()) and updated_by=(select auth.uid()))',t);
      execute format('create policy finance_update on public.os_fin_%I for update to authenticated using ((select public.os_is_active_member()) and (select public.os_has_finance_access())) with check ((select public.os_is_active_member()) and (select public.os_has_finance_access()) and updated_by=(select auth.uid()))',t);
    end if;
  end loop;
end $$;

create index os_fin_payments_date on public.os_fin_payments(paid_date desc);
create index os_fin_payments_biz_date on public.os_fin_payments(biz,paid_date);
create index os_fin_payments_store on public.os_fin_payments(store_id);
create index os_fin_cancels_payment on public.os_fin_payment_cancels(payment_id);
create index os_fin_cancels_date on public.os_fin_payment_cancels(cancel_date);
create index os_fin_settlements_date on public.os_fin_settlements(paid_out_date);
create index os_fin_settlements_store_date on public.os_fin_settlements(store_id,paid_out_date);
create unique index os_fin_payout_note_live on public.os_fin_payout_notes(store_id,paid_out_date) where archived_at is null;
create unique index os_fin_refund_active on public.os_fin_refund_requests(payment_id) where state in ('requested','executing','failed');
create unique index os_fin_account_name on public.os_fin_bank_accounts(lower(name)) where archived_at is null;
create index os_fin_bank_date on public.os_fin_bank_transactions(account_id,tx_date,time);
create index os_fin_bank_date_all on public.os_fin_bank_transactions(tx_date);
create index os_fin_bank_link on public.os_fin_bank_transactions(link_type,link_ref);
create unique index os_fin_external_link on public.os_fin_bank_transactions(link_ref) where link_type='external_revenue' and archived_at is null;
create index os_fin_bank_batch on public.os_fin_bank_transactions(import_batch_id);
create index os_fin_cards_holder on public.os_fin_cards(holder_profile_id);
create index os_fin_card_date on public.os_fin_card_transactions(used_date);
create index os_fin_card_batch on public.os_fin_card_transactions(import_batch_id);
create index os_fin_recurring_owner on public.os_fin_recurring_overrides(owner_profile_id);
create index os_fin_batch_account on public.os_fin_import_batches(account_id);
create index os_fin_batch_mapping on public.os_fin_import_batches(mapping_id);
create index os_fin_events_time on public.os_fin_events(created_at desc);

create view public.os_fin_payouts_v with (security_invoker=true) as
select store_id,paid_out_date,count(*) as count,sum(amount) as amount_sum,sum(fee) as fee_sum,
  sum(supply_fee) as supply_fee_sum,sum(vat_fee) as vat_fee_sum,sum(pay_out_amount) as pay_out_sum,
  min(sold_date) as sold_from,max(sold_date) as sold_to
from public.os_fin_settlements where archived_at is null group by store_id,paid_out_date;
revoke all on public.os_fin_payouts_v from public,anon;
grant select on public.os_fin_payouts_v to authenticated,service_role;

-- API and direct Data API writes share the same immutable metadata and domain guards.
create function public.os_fin_before_write() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(72107631);
  if tg_op='UPDATE' then
    new.id:=old.id; new.created_by:=old.created_by; new.created_at:=old.created_at; new.version:=old.version+1;
  else new.version:=1; end if;
  new.updated_at:=now();
  if auth.uid() is not null then new.updated_by:=auth.uid(); if tg_op='INSERT' then new.created_by:=auth.uid(); end if; end if;
  if tg_table_name='os_fin_budget_items' then
    if new.archived_at is null and new.source='bank' and exists(
      select 1 from public.os_fin_budget_items b where b.id<>new.id and b.archived_at is null and b.source='bank' and b.bank_categories && new.bank_categories
    ) then raise exception 'FINANCE_BUDGET_OVERLAP'; end if;
  end if;
  if tg_table_name='os_fin_budget_actuals' then
    if new.archived_at is null and not exists(
      select 1 from public.os_fin_budget_items b where b.id=new.item_id and b.source='manual' and b.archived_at is null
    ) then raise exception 'FINANCE_MANUAL_ONLY'; end if;
  end if;
  return new;
end $$;
revoke all on function public.os_fin_before_write() from public,anon,authenticated;

create function public.os_fin_after_write() returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Only keys/versions, never customer text, receipts, notes or provider payloads in audit.
  insert into public.os_fin_events(kind,subject_table,subject_id,summary,before,after,created_by,updated_by)
  values('change',tg_table_name,new.id::text,tg_op,
    case when tg_op='UPDATE' then jsonb_build_object('version',old.version) else null end,
    jsonb_build_object('version',new.version,'archived',new.archived_at is not null),new.updated_by,new.updated_by);
  return new;
end $$;
revoke all on function public.os_fin_after_write() from public,anon,authenticated;

do $$ declare t text; begin
  foreach t in array array['settings','stores','payments','payment_cancels','settlements','payout_notes','refund_requests',
    'external_revenues','bank_accounts','bank_transactions','bank_rules','cards','card_transactions','card_rules',
    'recurring_overrides','budget_items','budget_actuals','import_batches','import_mappings'] loop
    execute format('create trigger finance_before_write before insert or update on public.os_fin_%I for each row execute function public.os_fin_before_write()',t);
    execute format('create trigger finance_after_write after insert or update on public.os_fin_%I for each row execute function public.os_fin_after_write()',t);
  end loop;
end $$;

-- One atomic transaction for linked transfers, import chunks and multi-row edits.
-- SECURITY INVOKER: identifiers are allowlisted and all writes still pass caller RLS.
create function public.os_fin_commit(p_changes jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c jsonb; r jsonb; n jsonb; t text; cols text; vals text; sets text; result jsonb:='[]'; v integer;
begin
  if auth.uid() is null or not public.os_is_active_member() or not public.os_has_finance_access() then raise exception 'FINANCE_FORBIDDEN'; end if;
  if jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>1200 then raise exception 'FINANCE_INVALID_BATCH'; end if;
  perform pg_advisory_xact_lock(72107631);
  for c in select value from jsonb_array_elements(p_changes) loop
    t:=c->>'resource'; r:=c->'row'; v:=(r->>'version')::integer;
    if t not in ('settings','payout_notes','external_revenues','bank_accounts','bank_transactions','bank_rules','cards',
      'card_transactions','card_rules','recurring_overrides','budget_items','budget_actuals','import_batches','import_mappings') then raise exception 'FINANCE_INVALID_RESOURCE'; end if;
    r:=(r-'version'-'created_at'-'updated_at'-'created_by'-'updated_by')||jsonb_build_object('updated_by',auth.uid());
    if v=0 then r:=r||jsonb_build_object('created_by',auth.uid()); end if;
    select string_agg(format('%I',key),','),string_agg(format('x.%I',key),','),string_agg(format('%I=x.%I',key,key),',')
      into cols,vals,sets from jsonb_object_keys(r) as k(key);
    if v=0 then
      execute format('insert into public.os_fin_%1$I (%2$s) select %3$s from jsonb_populate_record(null::public.os_fin_%1$I,$1) x returning to_jsonb(os_fin_%1$I.*)',t,cols,vals) into n using r;
    else
      execute format('update public.os_fin_%1$I a set %2$s from jsonb_populate_record(null::public.os_fin_%1$I,$1) x where a.id=x.id and a.version=$2 returning to_jsonb(a.*)',t,sets) into n using r,v;
      if n is null then raise exception 'FINANCE_VERSION_CONFLICT'; end if;
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('resource',t,'row',n));
  end loop;
  -- Check both ends after all rows have been updated; reject half-pairs atomically.
  if exists(select 1 from public.os_fin_bank_transactions a where a.link_type='transfer' and a.archived_at is null and not exists(
    select 1 from public.os_fin_bank_transactions b where b.id::text=a.link_ref and b.link_type='transfer' and b.link_ref=a.id::text
      and b.archived_at is null and b.account_id<>a.account_id and abs(b.tx_date-a.tx_date)<=1
      and b.deposit=a.withdrawal and b.withdrawal=a.deposit
  )) then raise exception 'FINANCE_TRANSFER_INVALID'; end if;
  return result;
end $$;
revoke all on function public.os_fin_commit(jsonb) from public,anon;
grant execute on function public.os_fin_commit(jsonb) to authenticated;

-- Refund workflow cannot be written through the Data API or generic batch.
create function public.os_fin_refund_command(p_command text,p_id uuid,p_version integer,p_payment uuid default null,p_amount bigint default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.os_fin_refund_requests; p public.os_fin_payments; u uuid:=auth.uid();
begin
  if u is null or not public.os_is_active_member() or not public.os_has_finance_access() then raise exception 'FINANCE_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(72107631);
  if p_command='request' then
    select * into p from public.os_fin_payments where id=p_payment and archived_at is null for update;
    if p.id is null or p.status not in ('DONE','PARTIAL_CANCELED') or p_amount<1 or p_amount>p.amount-p.canceled_amount then raise exception 'FINANCE_REFUND_AMOUNT'; end if;
    insert into public.os_fin_refund_requests(payment_id,kind,amount,reason,requested_by,created_by,updated_by)
      values(p.id,case when p_amount=p.amount-p.canceled_amount then 'full' else 'partial' end,p_amount,p_reason,u,u,u) returning * into r;
  else
    select * into r from public.os_fin_refund_requests where id=p_id and archived_at is null for update;
    if r.id is null or r.version<>p_version then raise exception 'FINANCE_VERSION_CONFLICT'; end if;
    if r.requested_by=u then raise exception 'FINANCE_SELF_APPROVAL'; end if;
    if p_command='reject' and r.state in ('requested','failed') then
      update public.os_fin_refund_requests set state='rejected',decided_by=u,decided_at=now(),updated_by=u where id=r.id returning * into r;
    elsif (p_command='approve' and r.state='requested') or (p_command='retry' and r.decided_by=u and
      (r.state='failed' or (r.state='executing' and r.attempt_at<now()-interval '2 minutes'))) then
      if r.execution_started_at<now()-interval '14 days' then raise exception 'FINANCE_REFUND_RECONCILE_REQUIRED'; end if;
      select * into p from public.os_fin_payments where id=r.payment_id for update;
      if p_command='approve' and r.amount>p.amount-p.canceled_amount then raise exception 'FINANCE_REFUND_AMOUNT'; end if;
      update public.os_fin_refund_requests set state='executing',decided_by=u,decided_at=coalesce(decided_at,now()),
        execution_started_at=coalesce(execution_started_at,now()),attempt_at=now(),updated_by=u where id=r.id returning * into r;
    else raise exception 'FINANCE_REFUND_STATE'; end if;
  end if;
  return to_jsonb(r);
end $$;
revoke all on function public.os_fin_refund_command(text,uuid,integer,uuid,bigint,text) from public,anon;
grant execute on function public.os_fin_refund_command(text,uuid,integer,uuid,bigint,text) to authenticated;

-- Service-only completion never changes real payments in mock mode.
create function public.os_fin_refund_finish_mock(p_id uuid,p_version integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.os_fin_refund_requests;
begin
  update public.os_fin_refund_requests set state='done',mock=true,result='{"mock":true,"money_moved":false}'::jsonb
    where id=p_id and version=p_version and state='executing' returning * into r;
  if r.id is null then raise exception 'FINANCE_VERSION_CONFLICT'; end if;
  return to_jsonb(r);
end $$;
revoke all on function public.os_fin_refund_finish_mock(uuid,integer) from public,anon,authenticated;
grant execute on function public.os_fin_refund_finish_mock(uuid,integer) to service_role;

create function public.os_fin_log_action(p_kind text,p_view text,p_ids uuid[] default '{}') returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.os_is_active_member() or not public.os_has_finance_access() then raise exception 'FINANCE_FORBIDDEN'; end if;
  if p_kind not in ('csv_export','memo_request') or p_view not in ('overview','sales','settlements','bank','cards','recurring','budget') or cardinality(p_ids)>1000 then raise exception 'FINANCE_INVALID_ACTION'; end if;
  if p_kind='memo_request' and (cardinality(p_ids)=0 or exists(select 1 from unnest(p_ids) i where not exists(select 1 from public.os_fin_card_transactions c where c.id=i and c.archived_at is null))) then raise exception 'FINANCE_INVALID_ACTION'; end if;
  insert into public.os_fin_events(kind,subject_table,subject_id,summary,after,created_by,updated_by)
    values(p_kind,'finance',p_view,case when p_kind='memo_request' then 'Mock memo request (no messages sent)' else 'CSV export requested' end,
      jsonb_build_object('count',cardinality(p_ids),'mock',p_kind='memo_request'),auth.uid(),auth.uid());
end $$;
revoke all on function public.os_fin_log_action(text,text,uuid[]) from public,anon;
grant execute on function public.os_fin_log_action(text,text,uuid[]) to authenticated;


-- Deferred checks cover direct Data API writes as well as multi-row RPC changes.
create function public.os_fin_check_links() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.os_fin_bank_transactions a where a.archived_at is null and a.link_type='transfer' and not exists(
    select 1 from public.os_fin_bank_transactions b where b.id::text=a.link_ref and b.link_type='transfer' and b.link_ref=a.id::text
      and b.archived_at is null and b.account_id<>a.account_id and abs(b.tx_date-a.tx_date)<=1 and b.deposit=a.withdrawal and b.withdrawal=a.deposit
  )) then raise exception 'FINANCE_TRANSFER_INVALID'; end if;
  if exists(select 1 from public.os_fin_bank_transactions b where b.archived_at is null and b.link_type='external_revenue' and
    (b.deposit<=0 or not exists(select 1 from public.os_fin_external_revenues e where e.id::text=b.link_ref and e.archived_at is null))) then raise exception 'FINANCE_EXTERNAL_LINK_INVALID'; end if;
  if exists(select 1 from public.os_fin_bank_transactions b where b.archived_at is null and b.link_type='payout' and
    (b.deposit<=0 or not exists(select 1 from public.os_fin_settlements s where s.store_id::text||':'||s.paid_out_date::text=b.link_ref and s.archived_at is null))) then raise exception 'FINANCE_PAYOUT_LINK_INVALID'; end if;
  if exists(select 1 from public.os_fin_budget_actuals a where a.archived_at is null and not exists(
    select 1 from public.os_fin_budget_items b where b.id=a.item_id and b.source='manual' and b.archived_at is null
  )) then raise exception 'FINANCE_MANUAL_ONLY'; end if;
  return null;
end $$;
revoke all on function public.os_fin_check_links() from public,anon,authenticated;
create constraint trigger finance_bank_links after insert or update on public.os_fin_bank_transactions deferrable initially deferred for each row execute function public.os_fin_check_links();
create constraint trigger finance_external_links after update on public.os_fin_external_revenues deferrable initially deferred for each row execute function public.os_fin_check_links();
create constraint trigger finance_budget_links after update on public.os_fin_budget_items deferrable initially deferred for each row execute function public.os_fin_check_links();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('finance-receipts','finance-receipts',false,10485760,array['image/png','image/jpeg','image/gif','image/webp','application/pdf']);
create policy finance_receipt_read on storage.objects for select to authenticated
using(bucket_id='finance-receipts' and (select public.os_is_active_member()) and (select public.os_has_finance_access()));
create policy finance_receipt_insert on storage.objects for insert to authenticated
with check(bucket_id='finance-receipts' and (select public.os_is_active_member()) and (select public.os_has_finance_access())
  and (storage.foldername(name))[1]='cards' and exists(select 1 from public.os_fin_card_transactions c where c.id::text=(storage.foldername(name))[2] and c.archived_at is null));
