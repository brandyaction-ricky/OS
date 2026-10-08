import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as crypto from "node:crypto";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { overviewOf,payoutsOf,budgetOf } from "../lib/finance/domain.mjs";
import { workspaceFromLedger } from "../lib/finance/ledger-adapter.mjs";

class ApiError extends Error {constructor(status,code,message){super(message);Object.assign(this,{status,code});}}
function load(file,imports={},env={}){
  const compiled={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(`../${file}`,import.meta.url),"utf8"),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
    module:compiled,exports:compiled.exports,require(name){if(name==="server-only")return {};if(name==="node:crypto")return crypto;if(name==="zod")return zod;if(name==="@/lib/http")return {ApiError};if(name in imports)return imports[name];throw new Error(`Unmocked import: ${name}`);},
    console:{error(){}},Buffer,AbortSignal,Response,URL,URLSearchParams,Date,Set,process:{env},fetch:()=>{throw new Error("Real network forbidden");},
  });return compiled.exports;
}
const schema=load("lib/finance/schema.ts");
const sync=load("lib/finance/toss/sync.ts");
const provider=load("lib/finance/toss/provider.ts",{"../schema":schema});
const id="00000000-0000-4000-8000-000000000001";
const env={FINANCE_TOSS_SYNC_ENABLED:"true",FINANCE_TOSS_SYNC_PROJECT_REF:"aaaaaaaaaaaaaaaaaaaa",FINANCE_TOSS_MODE:"test",TOSS_SECRET_KEY_EDU:"test_sk_synthetic",TOSS_MID_EDU:"synthetic"};
const run=(extra={})=>({id,date_from:"2020-09-01",date_to:"2020-09-30",state:"running",phase:"transactions",mode:"test",tx_cursor:null,settlement_page:1,page_count:0,transaction_count:0,payment_count:0,cancel_count:0,settlement_count:0,skipped_count:0,updated_at:"2020-09-30T00:00:00Z",completed_at:null,last_error_code:null,...extra});
const payment=(extra={})=>({payment_key:"p1",order_id:"synthetic-order",order_name:"Synthetic item",method:"카드",card_issuer:null,amount:1100,canceled_amount:100,status:"PARTIAL_CANCELED",approved_at:"2020-09-10T00:00:00+09:00",paid_date:"2020-09-10",cancels:[{transaction_key:"c1",cancel_amount:100,canceled_at:"2020-10-01T00:00:00+09:00",cancel_date:"2020-10-01",reason:"DO-NOT-STORE"}],...extra});
const settlement=(extra={})=>({payment_key:"p1",transaction_key:"s1",method:"카드",amount:1100,fee:100,supply_fee:90,vat_fee:10,pay_out_amount:1000,sold_date:"2020-09-10",paid_out_date:"2020-09-13",is_cancel:false,...extra});
function harness({enabled=true,authError=null,rpcError=null,collectError=null,initial=run(),databaseUrl="https://aaaaaaaaaaaaaaaaaaaa.supabase.co",targetRef=env.FINANCE_TOSS_SYNC_PROJECT_REF}={}){
  let current=initial,services=0,providerCalls=0;const calls=[];
  const api=load("lib/server/finance-toss-sync.ts",{
    "@/lib/finance/schema":schema,
    "@/lib/config":{SUPABASE_URL:databaseUrl},
    "@/lib/finance/toss/provider":{tossSyncIdentity:()=>({mode:"test",binding:"PRIVATE"}),tossConnection:()=>({configured:true,mode:"test"}),tossProvider:()=>{providerCalls++;return {}; }},
    "@/lib/finance/toss/sync":{...sync,collectTossSyncPage:async()=>{if(collectError)throw collectError;return {payments:[payment()],transaction_count:1,skipped_count:0,next_cursor:null};}},
    "@/lib/supabase/server":{createServiceSupabase:()=>{services++;return {
      from:()=>({select:()=>({order:()=>({limit:()=>({maybeSingle:async()=>({data:current,error:null})})})})}),
      rpc:async(name,args)=>{calls.push({name,...args});if(rpcError)return {error:rpcError};
        if(args.p_action==="claim")return {data:{...current,lease_token:"PRIVATE",binding:"PRIVATE",tx_cursor:"PRIVATE_CURSOR",created_by:"PRIVATE"}};
        if(args.p_action==="commit")current={...current,phase:"settlements",page_count:1,payment_count:1};
        if(args.p_action==="abandon")current={...current,state:"abandoned"};
        return {data:current};},
    };}},
    "./finance":{financeActor:async()=>{if(authError)throw authError;return {id};},financeJson:request=>request.json(),financeDbError:e=>{throw new ApiError(503,"FINANCE_SETUP_REQUIRED",e.code);}},
  },{...env,FINANCE_TOSS_SYNC_ENABLED:String(enabled),FINANCE_TOSS_SYNC_PROJECT_REF:targetRef});
  return {api,calls,get services(){return services;},get providerCalls(){return providerCalls;}};
}
const request=body=>new Request("https://example.invalid/api/v1/finance/toss-sync",body?{method:"POST",body:JSON.stringify(body)}:{});

test("sync identity binds business, environment and merchant but not rotated secret",()=>{
  const a=provider.tossSyncIdentity("edu",env);
  assert.match(a.binding,/^[a-f0-9]{64}$/);
  assert.equal(a.binding,provider.tossSyncIdentity("edu",{...env,TOSS_SECRET_KEY_EDU:"test_sk_rotated"}).binding);
  assert.notEqual(a.binding,provider.tossSyncIdentity("edu",{...env,TOSS_MID_EDU:"another"}).binding);
  assert.throws(()=>provider.tossSyncIdentity("edu",{...env,FINANCE_TOSS_MODE:"live",TOSS_SECRET_KEY_EDU:"live_sk_synthetic"}),e=>e.code==="TOSS_ENVIRONMENT_BLOCKED");
});
test("bounded transaction pages preserve existing default and compose overall deadline",async()=>{
  let sent,options;const signal=AbortSignal.timeout(1000);
  const toss=provider.tossProvider("edu",env,async(url,opts)=>{sent=url;options=opts;return Response.json([]);},signal);
  await toss.transactions("2020-09-01","2020-09-30",undefined,10);
  assert.equal(new URL(sent).searchParams.get("limit"),"10");assert.equal(options.method,"GET");assert.ok(options.signal);
  await assert.rejects(toss.transactions("2020-09-01","2020-09-30",undefined,101));
});
test("transaction collection hydrates distinct payments and strips cancellation free text",async()=>{
  const calls=[];
  const payload=await sync.collectTossSyncPage(run(),{
    transactions:async(...args)=>{calls.push(args);return {rows:[{},{}],keys:["p1"],next:null};},
    payment:async key=>{assert.equal(key,"p1");return payment();},
  });
  assert.equal(calls[0][3],10);assert.equal(payload.transaction_count,2);assert.equal(payload.payments.length,1);
  assert.equal(payload.payments[0].cancels[0].reason,"토스 API 취소 내역");
  assert.doesNotMatch(JSON.stringify(payload),/DO-NOT-STORE/);
});
test("non-financial states are skipped explicitly, never converted to revenue",async()=>{
  const payload=await sync.collectTossSyncPage(run(),{transactions:async()=>({rows:[{}],keys:["p1"],next:null}),payment:async()=>payment({status:"EXPIRED",canceled_amount:0,cancels:[]})});
  assert.equal(payload.payments.length,0);assert.equal(payload.skipped_count,1);
});
test("bad cancel arithmetic, duplicate events and impossible statuses fail whole page",async()=>{
  for(const bad of [payment({canceled_amount:101}),payment({status:"DONE"}),payment({status:"CANCELED"}),payment({cancels:[payment().cancels[0],payment().cancels[0]],canceled_amount:200})]){
    await assert.rejects(sync.collectTossSyncPage(run(),{transactions:async()=>({rows:[{}],keys:["p1"],next:null}),payment:async()=>bad}),e=>e.code==="TOSS_SYNC_INVALID_PAYMENT");
  }
});
test("failure of any hydration never returns a partial commit payload",async()=>{
  await assert.rejects(sync.collectTossSyncPage(run(),{transactions:async()=>({rows:[{},{}],keys:["p1","p2"],next:"next"}),payment:async key=>{if(key==="p2")throw new Error("failed");return payment();}}));
});
test("settlement collection keeps signed refunds and checks dates and duplicate events",async()=>{
  const r=run({phase:"settlements",settlement_page:2});
  const refund=settlement({amount:-100,fee:-10,supply_fee:-9,vat_fee:-1,pay_out_amount:-90,is_cancel:true});
  const payload=await sync.collectTossSyncPage(r,{settlements:async(...args)=>{assert.equal(args[2],2);return {rows:[refund],next:null};}});
  assert.equal(payload.settlements[0].amount,-100);assert.equal(payload.next_page,null);
  for(const rows of [[refund,refund],[settlement({paid_out_date:"2020-10-01"})]])await assert.rejects(sync.collectTossSyncPage(r,{settlements:async()=>({rows,next:null})}),e=>e.code==="TOSS_SYNC_INVALID_SETTLEMENT");
});
test("public sync state is an allowlist, not a spread of privileged state",()=>{
  const result=sync.publicSyncRun(run({binding:"PRIVATE",lease_token:"PRIVATE",tx_cursor:"PRIVATE",store_id:"PRIVATE",created_by:"PRIVATE"}));
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|binding|lease_token|tx_cursor|store_id|created_by/);
});
test("anonymous/inactive/nonfinance failures happen before privileged client or provider",async()=>{
  for(const status of [401,403]){
    const h=harness({authError:new ApiError(status,"FORBIDDEN","forbidden")});
    await assert.rejects(h.api.readTossSync(request()));
    await assert.rejects(h.api.writeTossSync(request({action:"begin",from:"2020-09-01",to:"2020-09-30"})));
    assert.equal(h.services,0);assert.equal(h.providerCalls,0);
  }
});
test("feature defaults disabled, including all privileged writes",async()=>{
  const h=harness({enabled:false});const result=await h.api.readTossSync(request());
  assert.equal(result.enabled,false);assert.equal(result.run,null);
  await assert.rejects(h.api.writeTossSync(request({action:"step",runId:id})),e=>e.code==="TOSS_SYNC_DISABLED");
  assert.equal(h.services,0);assert.equal(h.calls.length,0);
});
test("sync status is non-mutating and strips internal fields",async()=>{
  const h=harness({initial:run({binding:"PRIVATE",tx_cursor:"PRIVATE",lease_token:"PRIVATE"})});
  const result=await h.api.readTossSync(request());assert.equal(result.enabled,true);assert.equal(h.calls.length,0);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  await assert.rejects(h.api.readTossSync(new Request("https://example.invalid/?secret=x")),e=>e.code==="TOSS_SYNC_INVALID");
});
test("missing or mismatched approved database stops before service-role access",async()=>{
  for(const options of [{databaseUrl:"https://bbbbbbbbbbbbbbbbbbbb.supabase.co"},{targetRef:""},{databaseUrl:"not-a-url"}]){
    const h=harness(options);
    await assert.rejects(h.api.readTossSync(request()),e=>e.code==="TOSS_SYNC_DATABASE_TARGET");
    await assert.rejects(h.api.writeTossSync(request({action:"begin",from:"2020-09-01",to:"2020-09-30"})),e=>e.code==="TOSS_SYNC_DATABASE_TARGET");
    assert.equal(h.services,0);assert.equal(h.providerCalls,0);
  }
});
test("sync body refuses business/provider rows, future dates and oversized windows",async()=>{
  const h=harness();
  for(const body of [{action:"begin",from:"2020-09-01",to:"2020-10-02"},{action:"begin",from:"2099-01-01",to:"2099-01-01"},{action:"begin",from:"2020-09-01",to:"2020-09-30",biz:"myin"},{action:"step",runId:id,payments:[]},{action:"step",runId:"invalid"}])await assert.rejects(h.api.writeTossSync(request(body)));
  assert.equal(h.services,0);assert.equal(h.calls.length,0);
});
test("begin is state only and a step claims then atomically commits one page",async()=>{
  const h=harness();const started=await h.api.writeTossSync(request({action:"begin",from:"2020-09-01",to:"2020-09-30"}));
  assert.equal(started.persisted,false);assert.equal(h.providerCalls,0);
  const result=await h.api.writeTossSync(request({action:"step",runId:id}));
  assert.deepEqual(h.calls.map(c=>c.p_action),["begin","claim","commit"]);
  assert.equal(h.calls[1].p_lease,h.calls[2].p_lease);assert.equal(h.calls[2].p_payload.transaction_count,1);
  assert.equal(result.persisted,true);assert.equal(result.run.phase,"settlements");assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});
test("page failure releases its lease without commit/advance and remains visible",async()=>{
  const h=harness({collectError:new ApiError(429,"TOSS_RATE_LIMITED","later")});
  await assert.rejects(h.api.writeTossSync(request({action:"step",runId:id})),e=>e.code==="TOSS_RATE_LIMITED");
  assert.deepEqual(h.calls.map(c=>c.p_action),["claim","fail"]);
  assert.equal(h.calls[0].p_lease,h.calls[1].p_lease);
});
test("abandon does not call Toss or delete ledger data",async()=>{
  const h=harness();const result=await h.api.writeTossSync(request({action:"abandon",runId:id}));
  assert.equal(result.persisted,false);assert.equal(result.run.state,"abandoned");assert.equal(h.providerCalls,0);
  assert.deepEqual(h.calls.map(c=>c.p_action),["abandon"]);
});
test("busy, binding, stale and revoked-actor RPC failures are safe and block upstream",async()=>{
  for(const [message,code,status]of [["TOSS_SYNC_BUSY","TOSS_SYNC_BUSY",409],["TOSS_SYNC_BINDING","TOSS_SYNC_BINDING",409],["TOSS_SYNC_STALE","TOSS_SYNC_STALE",409],["FINANCE_FORBIDDEN","FINANCE_FORBIDDEN",403]]){
    const h=harness({rpcError:{message:message+" PRIVATE"}});
    await assert.rejects(h.api.writeTossSync(request({action:"step",runId:id})),e=>e.code===code&&e.status===status&&!e.message.includes("PRIVATE"));
    assert.equal(h.providerCalls,0);
  }
});
test("normalized ledger powers sales and payouts without inventing bank income",()=>{
  const p={...payment(),id,store_id:"store",biz:"edu",fee:100};delete p.cancels;
  const data={stores:[{id:"store",biz:"edu",status:"connected",last_tx_synced_at:"2020-09-30"}],payments:[p],payment_cancels:[{...payment().cancels[0],payment_id:id,fee_refund:10}],settlements:[{...settlement(),store_id:"store",biz:"edu"}]};
  assert.equal(overviewOf(data,"2020-09").netRevenue,1100);assert.equal(overviewOf(data,"2020-10").netRevenue,-100);
  assert.equal(payoutsOf(data,"2020-09-30")[0].expected,1000);assert.equal(payoutsOf(data,"2020-09-30")[0].bankAmount,null);
  assert.equal(budgetOf(data,"2020-09").income,0);
  const view=workspaceFromLedger(data,"2020-09-30");assert.equal(view.TX.length,1);assert.equal(view.PO.length,1);assert.equal(view.DB.tossSync.length,1);
});
test("SQL review: additive service-only state, RLS, atomic cursor and no financial deletes",()=>{
  const sql=fs.readFileSync(new URL("../supabase/migrations/20261008054911_finance_toss_sync.sql",import.meta.url),"utf8");
  assert.match(sql,/enable row level security/);assert.match(sql,/security invoker set search_path=''/);
  assert.match(sql,/revoke all on function[^;]+from public,anon,authenticated/);
  assert.match(sql,/grant execute on function[^;]+to service_role/);
  assert.match(sql,/where id=p_actor and is_active and \(role='admin' or finance_access\)/);
  assert.match(sql,/r\.lease_token is distinct from p_lease/);assert.match(sql,/where state='running'/);
  assert.match(sql,/on conflict\(payment_key\) do update/);assert.match(sql,/on conflict\(transaction_key\) do nothing/);
  assert.match(sql,/on conflict\(store_id,transaction_key\) do update/);
  assert.doesNotMatch(sql,/delete from|truncate |drop table|insert into public\.os_fin_bank|update public\.os_fin_bank|security definer/i);
});
test("sync UI is labelled, disabled before status, requires consent and keeps partial wording",()=>{
  const {TossSyncPanel}=load("components/finance/toss-sync-panel.tsx",{react:React,"react/jsx-runtime":jsx,"@/lib/api-client":{}});
  const html=renderToStaticMarkup(React.createElement(TossSyncPanel,{token:null,onRefresh(){}}));
  assert.match(html,/에듀 토스 원장 수집/);assert.match(html,/원장에 저장합니다/);assert.match(html,/type="checkbox"[^>]*disabled/);assert.match(html,/disabled=""[^>]*>수집 시작/);
  const source=fs.readFileSync(new URL("../components/finance/toss-sync-panel.tsx",import.meta.url),"utf8");
  assert.match(source,/아직 전체 완료 아님/);assert.match(source,/저장분 유지/);assert.match(source,/sequence\.current\+\+/);assert.doesNotMatch(source,/setInterval\(|localStorage\.(getItem|setItem)|TOSS_SECRET/);
});
