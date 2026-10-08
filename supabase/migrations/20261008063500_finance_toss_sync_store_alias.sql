-- Forward-only fix: the store composite variable must not shadow settlement alias s.
-- The original migration is immutable; preserve grants, data, cursors and leases.
create or replace function public.os_fin_toss_sync(
  p_action text, p_actor uuid, p_mode text, p_binding text,
  p_run uuid default null, p_from date default null, p_to date default null,
  p_lease uuid default null, p_payload jsonb default '{}'
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  store_row public.os_fin_stores; r public.os_fin_toss_sync_runs;
  p jsonb; c jsonb; v jsonb; pid uuid; n integer:=0; now_at timestamptz:=clock_timestamp();
begin
  -- Service-only grant plus current database permission, never JWT user_metadata.
  if not exists(select 1 from public.os_profiles where id=p_actor and is_active and (role='admin' or finance_access))
    then raise exception 'FINANCE_FORBIDDEN'; end if;
  if p_mode is null or p_mode not in ('test','live') or p_binding !~ '^[a-f0-9]{64}$' or p_binding is null
    then raise exception 'TOSS_SYNC_INVALID'; end if;
  -- Same short-transaction lock order as the existing ledger write triggers.
  perform pg_advisory_xact_lock(72107631);
  now_at:=clock_timestamp();
  if p_action='begin' then
    if p_from is null or p_to is null or p_to<p_from or p_to-p_from>30
      or p_to>(now_at at time zone 'Asia/Seoul')::date then raise exception 'TOSS_SYNC_INVALID'; end if;
    select * into store_row from public.os_fin_stores where biz='edu';
    if not found then
      insert into public.os_fin_stores(biz,name,status,secret_env,created_by,updated_by)
      values('edu','브랜디에듀','pending','TOSS_SECRET_KEY_EDU',p_actor,p_actor) returning * into store_row;
    end if;
    if store_row.archived_at is not null then raise exception 'TOSS_SYNC_INVALID'; end if;
    if exists(select 1 from public.os_fin_toss_sync_runs where store_id=store_row.id and (binding<>p_binding or mode<>p_mode))
      then raise exception 'TOSS_SYNC_BINDING'; end if;
    select * into r from public.os_fin_toss_sync_runs where store_id=store_row.id and state='running';
    if found then
      if r.date_from<>p_from or r.date_to<>p_to then raise exception 'TOSS_SYNC_ACTIVE'; end if;
      return to_jsonb(r);
    end if;
    insert into public.os_fin_toss_sync_runs(store_id,mode,binding,date_from,date_to,created_by,updated_by)
      values(store_row.id,p_mode,p_binding,p_from,p_to,p_actor,p_actor) returning * into r;
    return to_jsonb(r);
  end if;
  select * into r from public.os_fin_toss_sync_runs where id=p_run for update;
  if not found then raise exception 'TOSS_SYNC_NOT_FOUND'; end if;
  if r.binding<>p_binding or r.mode<>p_mode then raise exception 'TOSS_SYNC_BINDING'; end if;
  if r.state<>'running' then raise exception 'TOSS_SYNC_FINISHED'; end if;
  if p_action='claim' then
    if r.page_count>=10000 then raise exception 'TOSS_SYNC_INVALID'; end if;
    if r.lease_until>now_at then raise exception 'TOSS_SYNC_BUSY'; end if;
    if p_lease is null then raise exception 'TOSS_SYNC_INVALID'; end if;
    update public.os_fin_toss_sync_runs set lease_token=p_lease,lease_until=now_at+interval '150 seconds',
      updated_at=now_at,updated_by=p_actor,last_error_code=null where id=r.id returning * into r;
    return to_jsonb(r);
  elsif p_action='abandon' then
    if r.lease_until>now_at then raise exception 'TOSS_SYNC_BUSY'; end if;
    update public.os_fin_toss_sync_runs set state='abandoned',lease_token=null,lease_until=null,
      updated_at=now_at,updated_by=p_actor where id=r.id returning * into r;
    return to_jsonb(r);
  end if;
  if p_lease is null or r.lease_token is distinct from p_lease or r.lease_until<=now_at
    then raise exception 'TOSS_SYNC_LEASE'; end if;
  if p_action='fail' then
    update public.os_fin_toss_sync_runs set lease_token=null,lease_until=null,last_error_code='TOSS_SYNC_PAGE_FAILED',
      updated_at=now_at,updated_by=p_actor where id=r.id returning * into r;
    return to_jsonb(r);
  end if;
  if p_action<>'commit' or jsonb_typeof(p_payload)<>'object' then raise exception 'TOSS_SYNC_INVALID'; end if;
  if r.phase='transactions' then
    if jsonb_typeof(p_payload->'payments') is distinct from 'array'
      or jsonb_array_length(p_payload->'payments')>10
      or (p_payload->>'transaction_count')::integer not between 0 and 10
      or (p_payload->>'skipped_count')::integer not between 0 and 10
      or coalesce(length(p_payload->>'next_cursor'),0)>64
      or (p_payload->>'next_cursor' is not null and ((p_payload->>'transaction_count')::integer<>10
        or p_payload->>'next_cursor'=r.tx_cursor)) then raise exception 'TOSS_SYNC_INVALID'; end if;
    for p in select value from jsonb_array_elements(p_payload->'payments') loop
      if p->>'status' not in ('DONE','CANCELED','PARTIAL_CANCELED','WAITING_FOR_DEPOSIT')
        or jsonb_typeof(p->'cancels') is distinct from 'array'
        or length(p->>'payment_key') not between 1 and 200
        or (p->>'canceled_amount')::bigint <> (select coalesce(sum((value->>'cancel_amount')::bigint),0) from jsonb_array_elements(p->'cancels'))
        then raise exception 'TOSS_SYNC_INVALID'; end if;
      if exists(select 1 from public.os_fin_payments x where x.payment_key=p->>'payment_key' and
        (x.store_id<>r.store_id or x.amount<>(p->>'amount')::bigint or x.order_id<>p->>'order_id' or x.archived_at is not null
          or x.canceled_amount>(p->>'canceled_amount')::bigint or (x.status='CANCELED' and p->>'status'<>'CANCELED')))
        then raise exception 'TOSS_SYNC_STALE'; end if;
      insert into public.os_fin_payments as old(store_id,biz,payment_key,order_id,order_name,method,card_issuer,
        amount,status,canceled_amount,approved_at,paid_date,synced_at,created_by,updated_by)
      values(r.store_id,'edu',p->>'payment_key',p->>'order_id',p->>'order_name',p->>'method',p->>'card_issuer',
        (p->>'amount')::bigint,p->>'status',(p->>'canceled_amount')::bigint,(p->>'approved_at')::timestamptz,
        (p->>'paid_date')::date,now_at,p_actor,p_actor)
      on conflict(payment_key) do update set order_name=excluded.order_name,method=excluded.method,card_issuer=excluded.card_issuer,
        status=excluded.status,canceled_amount=excluded.canceled_amount,approved_at=excluded.approved_at,
        paid_date=excluded.paid_date,synced_at=excluded.synced_at,updated_by=p_actor;
      select id into pid from public.os_fin_payments where payment_key=p->>'payment_key';
      for c in select value from jsonb_array_elements(p->'cancels') loop
        if exists(select 1 from public.os_fin_payment_cancels x where x.transaction_key=c->>'transaction_key' and
          (x.payment_id<>pid or x.cancel_amount<>(c->>'cancel_amount')::bigint or x.archived_at is not null))
          then raise exception 'TOSS_SYNC_STALE'; end if;
        insert into public.os_fin_payment_cancels(payment_id,transaction_key,cancel_amount,canceled_at,cancel_date,reason,origin,created_by,updated_by)
        values(pid,c->>'transaction_key',(c->>'cancel_amount')::bigint,(c->>'canceled_at')::timestamptz,
          (c->>'cancel_date')::date,'토스 API 취소 내역','toss_sync',p_actor,p_actor)
        on conflict(transaction_key) do nothing;
        n:=n+1;
      end loop;
    end loop;
    update public.os_fin_toss_sync_runs set tx_cursor=p_payload->>'next_cursor',
      phase=case when p_payload->>'next_cursor' is null then 'settlements' else phase end,
      transaction_count=transaction_count+(p_payload->>'transaction_count')::integer,
      payment_count=payment_count+jsonb_array_length(p_payload->'payments'),cancel_count=cancel_count+n,
      skipped_count=skipped_count+(p_payload->>'skipped_count')::integer where id=r.id;
    if p_payload->>'next_cursor' is null then
      update public.os_fin_stores set last_tx_synced_at=now_at,tx_cursor=jsonb_build_object('from',r.date_from,'to',r.date_to),updated_by=p_actor where id=r.store_id;
    end if;
  elsif r.phase='settlements' then
    if jsonb_typeof(p_payload->'settlements') is distinct from 'array' or jsonb_array_length(p_payload->'settlements')>100
      or (p_payload->>'next_page' is not null and ((p_payload->>'next_page')::integer<>r.settlement_page+1
        or jsonb_array_length(p_payload->'settlements')<>100)) then raise exception 'TOSS_SYNC_INVALID'; end if;
    for v in select value from jsonb_array_elements(p_payload->'settlements') loop
      if (v->>'paid_out_date')::date not between r.date_from and r.date_to
        or (v->>'fee')::bigint<>(v->>'supply_fee')::bigint+(v->>'vat_fee')::bigint
        or (v->>'is_cancel')::boolean<>((v->>'amount')::bigint<0)
        then raise exception 'TOSS_SYNC_INVALID'; end if;
      if exists(select 1 from public.os_fin_settlements x where x.store_id=r.store_id and x.transaction_key=v->>'transaction_key'
        and (x.payment_key<>v->>'payment_key' or x.archived_at is not null)) then raise exception 'TOSS_SYNC_STALE'; end if;
      insert into public.os_fin_settlements as old(store_id,biz,payment_key,transaction_key,is_cancel,method,amount,fee,
        supply_fee,vat_fee,pay_out_amount,sold_date,paid_out_date,created_by,updated_by)
      values(r.store_id,'edu',v->>'payment_key',v->>'transaction_key',(v->>'is_cancel')::boolean,v->>'method',
        (v->>'amount')::bigint,(v->>'fee')::bigint,(v->>'supply_fee')::bigint,(v->>'vat_fee')::bigint,
        (v->>'pay_out_amount')::bigint,(v->>'sold_date')::date,(v->>'paid_out_date')::date,p_actor,p_actor)
      on conflict(store_id,transaction_key) do update set is_cancel=excluded.is_cancel,method=excluded.method,
        amount=excluded.amount,fee=excluded.fee,supply_fee=excluded.supply_fee,vat_fee=excluded.vat_fee,
        pay_out_amount=excluded.pay_out_amount,sold_date=excluded.sold_date,paid_out_date=excluded.paid_out_date,updated_by=p_actor;
    end loop;
    update public.os_fin_toss_sync_runs set settlement_page=coalesce((p_payload->>'next_page')::integer,settlement_page),
      settlement_count=settlement_count+jsonb_array_length(p_payload->'settlements'),
      phase=case when p_payload->>'next_page' is null then 'complete' else phase end,
      state=case when p_payload->>'next_page' is null then 'complete' else state end,
      completed_at=case when p_payload->>'next_page' is null then now_at else null end where id=r.id;
    if p_payload->>'next_page' is null then
      update public.os_fin_stores set last_settlement_synced_at=now_at,
        settlement_cursor=jsonb_build_object('from',r.date_from,'to',r.date_to),updated_by=p_actor where id=r.store_id;
    end if;
  else raise exception 'TOSS_SYNC_INVALID'; end if;
  -- Backfill known fees whichever phase/date window arrived first. No bank data is touched.
  update public.os_fin_payments p set fee=f.fee,updated_by=p_actor from
    (select payment_key,sum(fee)::bigint fee from public.os_fin_settlements where store_id=r.store_id and not is_cancel and archived_at is null
      and payment_key in (select value->>'payment_key' from jsonb_array_elements(coalesce(p_payload->'payments',p_payload->'settlements','[]'::jsonb))) group by payment_key) f
    where p.store_id=r.store_id and p.payment_key=f.payment_key and p.fee is distinct from f.fee;
  update public.os_fin_payment_cancels c set fee_refund=-s.fee,updated_by=p_actor from public.os_fin_settlements s
    join public.os_fin_payments p on p.payment_key=s.payment_key and p.store_id=s.store_id
    where s.store_id=r.store_id and s.is_cancel and s.archived_at is null and c.payment_id=p.id
      and s.payment_key in (select value->>'payment_key' from jsonb_array_elements(coalesce(p_payload->'payments',p_payload->'settlements','[]'::jsonb)))
      and c.transaction_key=s.transaction_key and c.fee_refund is distinct from -s.fee;
  update public.os_fin_stores set status='connected',updated_by=p_actor where id=r.store_id and status<>'connected';
  update public.os_fin_toss_sync_runs set lease_token=null,lease_until=null,last_error_code=null,page_count=page_count+1,
    updated_at=now_at,updated_by=p_actor where id=r.id returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.os_fin_toss_sync(text,uuid,text,text,uuid,date,date,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.os_fin_toss_sync(text,uuid,text,text,uuid,date,date,uuid,jsonb) to service_role;
