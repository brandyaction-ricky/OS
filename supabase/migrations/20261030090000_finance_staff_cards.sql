-- 재무관리 (2026-10-30): 카드지출·정기 결제를 모든 직원에게 연다. 나머지 재무 자료는 그대로 재무 권한자만.
-- Staff (active members without finance access) read cards, card uses, card rules, recurring owners/states and settings;
-- they change only a card use's classification, purpose and receipt, and a recurring item's owner/state.
-- Policies are replaced only on those five tables and the receipt bucket; every other finance policy stays as it is.
-- os_fin_before_write / os_fin_commit / os_fin_log_action bodies are the live ones (checked by md5) plus the staff lines.
begin;

do $$ declare t text; begin
  foreach t in array array['settings','cards','card_transactions','card_rules','recurring_overrides'] loop
    execute format('drop policy finance_read on public.os_fin_%I',t);
    execute format('create policy finance_read on public.os_fin_%I for select to authenticated using ((select public.os_is_active_member()))',t);
  end loop;
  foreach t in array array['card_transactions','recurring_overrides'] loop
    execute format('drop policy finance_update on public.os_fin_%I',t);
    execute format('create policy finance_update on public.os_fin_%I for update to authenticated using ((select public.os_is_active_member())) with check ((select public.os_is_active_member()) and updated_by=(select auth.uid()))',t);
  end loop;
end $$;
drop policy finance_insert on public.os_fin_recurring_overrides;
create policy finance_insert on public.os_fin_recurring_overrides for insert to authenticated with check ((select public.os_is_active_member()) and created_by=(select auth.uid()) and updated_by=(select auth.uid()));

drop policy finance_receipt_read on storage.objects;
create policy finance_receipt_read on storage.objects for select to authenticated
using(bucket_id='finance-receipts' and (select public.os_is_active_member()));
drop policy finance_receipt_insert on storage.objects;
create policy finance_receipt_insert on storage.objects for insert to authenticated
with check(bucket_id='finance-receipts' and (select public.os_is_active_member())
  and (storage.foldername(name))[1]='cards' and exists(select 1 from public.os_fin_card_transactions c where c.id::text=(storage.foldername(name))[2] and c.archived_at is null));

create or replace function public.os_fin_before_write() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(72107631);
  if tg_op='UPDATE' then
    new.id:=old.id; new.created_by:=old.created_by; new.created_at:=old.created_at; new.version:=old.version+1;
  else new.version:=1; end if;
  new.updated_at:=now();
  if auth.uid() is not null then new.updated_by:=auth.uid(); if tg_op='INSERT' then new.created_by:=auth.uid(); end if; end if;
  -- Staff without finance access (2026-10-30): a card use keeps everything as imported except its classification, purpose and receipt.
  if tg_table_name='os_fin_card_transactions' and auth.uid() is not null and not public.os_has_finance_access() and (tg_op<>'UPDATE'
    or (to_jsonb(new)-array['manual_category','manual_biz','manual_vat','memo','receipt_path','version','updated_at','updated_by'])
      is distinct from (to_jsonb(old)-array['manual_category','manual_biz','manual_vat','memo','receipt_path','version','updated_at','updated_by'])) then
    raise exception 'FINANCE_STAFF_FIELDS';
  end if;
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

create or replace function public.os_fin_commit(p_changes jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c jsonb; r jsonb; n jsonb; t text; cols text; vals text; sets text; result jsonb:='[]'; v integer;
begin
  if auth.uid() is null or not public.os_is_active_member() then raise exception 'FINANCE_FORBIDDEN'; end if;
  if jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>1200 then raise exception 'FINANCE_INVALID_BATCH'; end if;
  -- Staff without finance access change only card uses and recurring owners/states (row policies and os_fin_before_write narrow it further).
  if not public.os_has_finance_access() and exists(select 1 from jsonb_array_elements(p_changes) e where e->>'resource' not in ('card_transactions','recurring_overrides')) then raise exception 'FINANCE_FORBIDDEN'; end if;
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

create or replace function public.os_fin_log_action(p_kind text, p_view text, p_ids uuid[] default '{}') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.os_is_active_member() or (not public.os_has_finance_access() and p_view not in ('cards', 'recurring')) then raise exception 'FINANCE_FORBIDDEN'; end if;
  if p_kind not in ('csv_export', 'memo_request') or p_view not in ('overview', 'sales', 'settlements', 'bank', 'cards', 'recurring', 'budget', 'tax_invoices', 'vat') or cardinality(p_ids) > 1000 then raise exception 'FINANCE_INVALID_ACTION'; end if;
  if p_kind = 'memo_request' and (cardinality(p_ids) = 0 or exists(select 1 from unnest(p_ids) i where not exists(select 1 from public.os_fin_card_transactions c where c.id = i and c.archived_at is null))) then raise exception 'FINANCE_INVALID_ACTION'; end if;
  insert into public.os_fin_events(kind, subject_table, subject_id, summary, after, created_by, updated_by)
    values(p_kind, 'finance', p_view, case when p_kind = 'memo_request' then 'Mock memo request (no messages sent)' else 'CSV export requested' end,
      jsonb_build_object('count', cardinality(p_ids), 'mock', p_kind = 'memo_request'), auth.uid(), auth.uid());
end $$;

commit;
