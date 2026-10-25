-- Candidate integration test for 20261025090000_toss_sync_by_business.
-- NOT run by npm test. Run only on a DEV database, after the migration body (or with it
-- prepended inside this transaction). The final block always raises, so everything rolls back.
-- Expect "failures=0".
create temp table tb(check_name text, ok boolean);
do $$
#variable_conflict use_variable
declare actor uuid; run jsonb; lease uuid := gen_random_uuid(); b text := repeat('b', 64); e text := repeat('e', 64);
begin
  select id into actor from public.os_profiles where is_active and role = 'admin' order by id limit 1;
  delete from public.os_fin_stores where biz = 'myin';

  run := public.os_fin_toss_sync('begin', actor, 'test', b, p_from => current_date - 3, p_to => current_date - 1, p_biz => 'myin');
  insert into tb values ('myin store created', exists(select 1 from public.os_fin_stores where biz = 'myin' and name = '마이인' and secret_env = 'TOSS_SECRET_KEY_MYIN'));
  insert into tb values ('run belongs to myin store', (select biz from public.os_fin_stores where id = (run->>'store_id')::uuid) = 'myin');
  perform public.os_fin_toss_sync('claim', actor, 'test', b, p_run => (run->>'id')::uuid, p_lease => lease);
  perform public.os_fin_toss_sync('commit', actor, 'test', b, p_run => (run->>'id')::uuid, p_lease => lease, p_payload => jsonb_build_object(
    'payments', jsonb_build_array(jsonb_build_object('payment_key','tb-myin-pay-1','order_id','tb-order-1','order_name','시험','method','카드','card_issuer',null,
      'amount',10000,'status','DONE','canceled_amount',0,'approved_at',now(),'paid_date',current_date - 1,'cancels','[]'::jsonb)),
    'transaction_count', 1, 'skipped_count', 0, 'next_cursor', null));
  insert into tb values ('payment written as myin', (select biz from public.os_fin_payments where payment_key = 'tb-myin-pay-1') = 'myin');

  begin perform public.os_fin_toss_sync('begin', actor, 'test', b, p_from => current_date - 1, p_to => current_date - 1, p_biz => 'hm');
    insert into tb values ('unknown business refused', false);
  exception when others then insert into tb values ('unknown business refused', sqlerrm = 'TOSS_SYNC_INVALID'); end;

  -- The old call without p_biz still means 브랜디에듀.
  begin
    run := public.os_fin_toss_sync('begin', actor, 'test', e, p_from => current_date - 1, p_to => current_date - 1);
    insert into tb values ('default call is edu', (select biz from public.os_fin_stores where id = (run->>'store_id')::uuid) = 'edu');
  exception when others then insert into tb values ('default call is edu', sqlerrm in ('TOSS_SYNC_BINDING', 'TOSS_SYNC_ACTIVE'));
  end;

  raise exception 'TB_RESULT checks=% failures=% | %', (select count(*) from tb), (select count(*) from tb where not ok), (select string_agg(check_name, ' ; ') from tb where not ok);
end $$;
