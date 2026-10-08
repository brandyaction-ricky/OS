import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

class ApiError extends Error {constructor(status,code,message){super(message);Object.assign(this,{status,code});}}
function load(file,imports={},env={}){
  const compiled={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(`../${file}`,import.meta.url),"utf8"),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
    module:compiled,exports:compiled.exports,require(name){if(name==="server-only")return {};if(name==="zod")return zod;if(name==="@/lib/http")return {ApiError};if(name in imports)return imports[name];throw new Error(`Unmocked import: ${name}`);},
    Buffer,AbortSignal,Response,URL,URLSearchParams,Date,process:{env},fetch:()=>{throw new Error("Real network is forbidden in tests");},
  });
  return compiled.exports;
}
const schema=load("lib/finance/schema.ts");
const provider=load("lib/finance/toss/provider.ts",{"../schema":schema});
const env={FINANCE_TOSS_MODE:"test",TOSS_SECRET_KEY_EDU:"test_sk_synthetic",TOSS_MID_EDU:"synthetic"};
const tx=(i=1)=>({mId:"synthetic",transactionKey:`t${i}`,paymentKey:"p1",orderId:"synthetic-order",method:"카드",status:"DONE",transactionAt:"2026-09-30T23:59:59+09:00",currency:"KRW",amount:1100,customerKey:"DO-NOT-EXPOSE",receiptUrl:"DO-NOT-EXPOSE"});
const settlement=()=>({mId:"synthetic",transactionKey:"s1",paymentKey:"p1",method:"카드",amount:1100,supplyAmount:90,vat:10,payOutAmount:1000,soldDate:"2026-09-10",paidOutDate:"2026-09-13",currency:"KRW",card:{number:"DO-NOT-EXPOSE"}});
const payment=()=>({mId:"synthetic",paymentKey:"p1",orderId:"synthetic-order",orderName:"Synthetic item",method:"카드",currency:"KRW",status:"DONE",totalAmount:1100,balanceAmount:1100,approvedAt:"2026-09-10T00:00:00+09:00",requestedAt:"2026-09-09T23:59:00+09:00",secret:"DO-NOT-EXPOSE",customerName:"DO-NOT-EXPOSE"});

test("Toss connection status exposes readiness, never a secret or verified claim",()=>{
  const result=provider.tossConnection("edu",env);
  assert.equal(result.configured,true);assert.equal(result.verified,false);assert.equal(result.readOnly,true);
  assert.doesNotMatch(JSON.stringify(result),/synthetic|TOSS_SECRET|TOSS_MID/);
  assert.equal(provider.tossConnection("edu",{}).configured,false);
  assert.equal(provider.tossConnection("myin",env).configured,false);
});
test("live keys are blocked in local/preview and test keys are blocked in Production",()=>{
  const live={...env,FINANCE_TOSS_MODE:"live",TOSS_SECRET_KEY_EDU:"live_sk_synthetic"};
  for(const VERCEL_ENV of [undefined,"preview","development"])assert.throws(()=>provider.tossProvider("edu",{...live,VERCEL_ENV}),e=>e.code==="TOSS_ENVIRONMENT_BLOCKED");
  assert.throws(()=>provider.tossProvider("edu",{...env,VERCEL_ENV:"production"}),e=>e.code==="TOSS_ENVIRONMENT_BLOCKED");
  assert.equal(provider.tossConnection("edu",{...live,VERCEL_ENV:"production"}).mode,"live");
  assert.throws(()=>provider.tossProvider("edu",{...env,FINANCE_TOSS_MODE:"live"}),e=>e.code==="TOSS_KEY_MODE_MISMATCH");
  assert.throws(()=>provider.tossProvider("edu",{...env,TOSS_MID_EDU:undefined}),e=>e.code==="TOSS_NOT_CONFIGURED");
  assert.equal(provider.tossConnection("edu",{...env,TOSS_SECRET_KEY_EDU:"test_gsk_synthetic"}).configured,true);
});
test("transactions use GET, full KST end day, bounded pages and strip raw customer fields",async()=>{
  const calls=[];
  const toss=provider.tossProvider("edu",env,async(url,options)=>{calls.push({url,options});return Response.json(Array.from({length:100},(_,i)=>tx(i)));});
  const result=await toss.transactions("2026-09-01","2026-09-30");
  const {url,options}=calls[0],q=new URL(url).searchParams;
  assert.equal(new URL(url).origin,"https://api.tosspayments.com");assert.equal(options.method,"GET");assert.equal(options.body,undefined);
  assert.equal(options.redirect,"error");assert.equal(options.cache,"no-store");assert.ok(options.signal);
  assert.equal(options.headers.Authorization,`Basic ${Buffer.from(env.TOSS_SECRET_KEY_EDU+":").toString("base64")}`);
  assert.equal(q.get("endDate"),"2026-09-30T23:59:59");assert.equal(q.get("startDate"),"2026-09-01T00:00:00");assert.equal(q.get("limit"),"100");
  assert.equal(result.next,"t99");assert.equal(result.keys.length,1);assert.equal(result.rows.length,100);
  assert.doesNotMatch(JSON.stringify(result),/DO-NOT-EXPOSE|mId|secret|receiptUrl|customerKey/);
});
test("pagination preserves cancellation events sharing a payment and never repeats cursor",async()=>{
  let sent;
  const toss=provider.tossProvider("edu",env,async url=>{sent=url;return Response.json([tx(2),{...tx(3),status:"PARTIAL_CANCELED",amount:100}]);});
  const result=await toss.transactions("2026-09-01","2026-09-30","t1");
  assert.equal(new URL(sent).searchParams.get("startingAfter"),"t1");assert.equal(result.rows.length,2);assert.equal(result.next,null);
  const repeated=provider.tossProvider("edu",env,async()=>Response.json([tx(1)]));
  await assert.rejects(repeated.transactions("2026-09-01","2026-09-30","t1"),e=>e.code==="TOSS_INVALID_RESPONSE");
});
test("invalid date ranges, page numbers and cursors fail before network access",async()=>{
  let calls=0;const toss=provider.tossProvider("edu",env,async()=>{calls++;return Response.json([]);});
  for(const [from,to] of [["2026-02-30","2026-03-01"],["2026-09-02","2026-09-01"],["2026-09-01","2026-10-02"]])await assert.rejects(toss.transactions(from,to));
  await assert.rejects(toss.transactions("2026-09-01","2026-09-30","x".repeat(65)));
  for(const page of [0,-1,1.5,10001])await assert.rejects(toss.settlements("2026-09-01","2026-09-30",page));
  assert.equal(calls,0);
});
test("every response must belong to the selected merchant, including a mixed page",async()=>{
  for(const [method,args,body] of [
    ["transactions",["2026-09-01","2026-09-30"],[tx(),{...tx(2),mId:"wrong"}]],
    ["settlements",["2026-09-01","2026-09-30"],[{...settlement(),mId:"wrong"}]],
    ["payment",["p1"],{...payment(),mId:"wrong"}],
  ]){
    const toss=provider.tossProvider("edu",env,async()=>Response.json(body));
    await assert.rejects(toss[method](...args),e=>e.code==="TOSS_MERCHANT_MISMATCH"&&!e.message.includes("wrong"));
  }
});
test("settlement pages use paidOutDate, preserve negative cancellations and fee arithmetic",async()=>{
  let sent;const body={...settlement(),amount:-1100,supplyAmount:-90,vat:-10,payOutAmount:-1000};
  const toss=provider.tossProvider("edu",env,async url=>{sent=url;return Response.json(Array.from({length:100},(_,i)=>({...body,transactionKey:`s${i}`})));});
  const result=await toss.settlements("2026-09-01","2026-09-30",2),q=new URL(sent).searchParams;
  assert.equal(q.get("dateType"),"paidOutDate");assert.equal(q.get("page"),"2");assert.equal(q.get("size"),"100");
  assert.equal(result.next,3);assert.equal(result.rows[0].is_cancel,true);assert.equal(result.rows[0].fee,-100);
  assert.doesNotMatch(JSON.stringify(result),/DO-NOT-EXPOSE|mId|card/);
});
test("payment read validates the requested payment and excludes customer/payment secrets",async()=>{
  const toss=provider.tossProvider("edu",env,async()=>Response.json(payment()));
  const row=await toss.payment("p1");assert.equal(row.amount,1100);
  assert.doesNotMatch(JSON.stringify(row),/DO-NOT-EXPOSE|customerName|secret|mId/);
  await assert.rejects(toss.payment("wrong"),e=>e.code==="TOSS_INVALID_RESPONSE");
});
test("malformed/oversized upstream responses become safe 502 errors, not raw validation dumps",async()=>{
  for(const body of [{private:"DO-NOT-EXPOSE"},[{...tx(),currency:"USD"}],Array.from({length:101},(_,i)=>tx(i)),[{...tx(),mId:undefined}]]){
    const toss=provider.tossProvider("edu",env,async()=>Response.json(body));
    await assert.rejects(toss.transactions("2026-09-01","2026-09-30"),e=>e.status===502&&e.code==="TOSS_INVALID_RESPONSE"&&!e.message.includes("DO-NOT"));
  }
  const huge=provider.tossProvider("edu",env,async()=>new Response("x".repeat(2_000_001)));
  await assert.rejects(huge.transactions("2026-09-01","2026-09-30"),e=>e.code==="TOSS_INVALID_RESPONSE");
  const invalid=provider.tossProvider("edu",env,async()=>new Response("not json"));
  await assert.rejects(invalid.transactions("2026-09-01","2026-09-30"),e=>e.code==="TOSS_INVALID_RESPONSE");
});
test("network/auth/rate limit errors are redacted and never retried or changed into a write",async()=>{
  for(const [status,code] of [[401,"TOSS_AUTH_FAILED"],[403,"TOSS_AUTH_FAILED"],[429,"TOSS_RATE_LIMITED"],[500,"TOSS_REQUEST_FAILED"]]){
    let calls=0;const toss=provider.tossProvider("edu",env,async()=>{calls++;return Response.json({message:env.TOSS_SECRET_KEY_EDU,code:"DO_NOT_EXPOSE"},{status});});
    await assert.rejects(toss.transactions("2026-09-01","2026-09-30"),e=>e.code===code&&!e.message.includes("synthetic"));assert.equal(calls,1);
  }
  const toss=provider.tossProvider("edu",env,async()=>{throw new Error(env.TOSS_SECRET_KEY_EDU);});
  await assert.rejects(toss.payment("p1"),e=>e.code==="TOSS_NETWORK_ERROR"&&!e.message.includes("synthetic"));
});
test("cancellation cannot make a request even with a valid-looking production configuration",async()=>{
  let calls=0;
  const toss=provider.tossProvider("edu",{...env,VERCEL_ENV:"production",FINANCE_TOSS_MODE:"live",TOSS_SECRET_KEY_EDU:"live_sk_synthetic"},async()=>{calls++;return Response.json({});});
  await assert.rejects(toss.cancel(),e=>e.code==="TOSS_CANCEL_DISABLED");assert.equal(calls,0);
});
function readApi(auth,connection){return load("lib/server/finance-toss.ts",{"./finance":{financeActor:auth},"@/lib/finance/schema":schema,"@/lib/finance/toss/provider":connection});}
const request=(query="",method="GET")=>new Request(`https://local.invalid/api/v1/finance/toss/transactions?${query}`,{method});
test("Toss API authenticates all actions before status or upstream calls",async()=>{
  let calls=0;const api=readApi(async()=>{throw new ApiError(403,"FINANCE_FORBIDDEN","denied");},{tossConnection(){calls++;},tossProvider(){calls++;}});
  for(const action of ["status","transactions","settlements","payment"])await assert.rejects(api.readToss(request(),action),e=>e.status===403);
  assert.equal(calls,0);
});
test("Toss API only passes validated fields and returns read-only non-persisted results",async()=>{
  const seen=[];let auth=0;
  const api=readApi(async()=>{auth++;},{tossConnection(){return {configured:true};},tossProvider(biz){seen.push(biz);return {transactions:async(...args)=>{seen.push(args);return {rows:[],next:null};},settlements:async(...args)=>{seen.push(args);return {rows:[],next:null};},payment:async key=>({payment_key:key})};}});
  const result=await api.readToss(request("biz=edu&from=2026-09-01&to=2026-09-30&cursor=t1"),"transactions");
  assert.equal(result.persisted,false);assert.equal(result.readOnly,true);assert.equal(result.kind,"transactions");assert.equal(seen[0],"edu");assert.equal(seen[1][2],"t1");
  await api.readToss(request("biz=edu&from=2026-09-01&to=2026-09-30&page=2"),"settlements");assert.equal(seen[3][2],2);
  assert.equal((await api.readToss(request("biz=edu&paymentKey=p1"),"payment")).row.payment_key,"p1");
  assert.equal((await api.readToss(request("biz=edu"),"status")).configured,true);
  for(const query of ["biz=other","biz=edu&secret=forged","biz=edu&from=2026-02-30&to=2026-03-01"])await assert.rejects(api.readToss(request(query),"transactions"));
  await assert.rejects(api.readToss(request("biz=edu","POST"),"status"),e=>e.status===405);
  await assert.rejects(api.readToss(request(),"cancel"),e=>e.status===404);
  assert.equal(auth,9);
});
test("production route exports only GET and UI previews do not persist live financial data",()=>{
  const route=fs.readFileSync(new URL("../app/api/v1/finance/toss/[action]/route.ts",import.meta.url),"utf8");
  assert.match(route,/private, no-store/);assert.match(route,/export async function GET/);assert.doesNotMatch(route,/export (?:async function|const) (?:POST|PUT|PATCH|DELETE)/);
  const ui=fs.readFileSync(new URL("../components/finance/toss-read-panel.tsx",import.meta.url),"utf8");
  assert.match(ui,/AbortController/);assert.match(ui,/pending.sequence/);assert.match(ui,/조회 결과는 원장·예산에 저장하거나 합산하지 않습니다/);
  assert.doesNotMatch(ui,/localStorage|sessionStorage|method:["']POST|dangerouslySetInnerHTML/);
});
test("read-only panels initially render labelled controls with upstream fetching disabled",()=>{
  let calls=0;
  const {TossReadPanel}=load("components/finance/toss-read-panel.tsx",{"react":React,"react/jsx-runtime":jsx,"@/lib/api-client":{apiRequest(){calls++;throw new Error("No request during render");}}});
  for(const kind of ["transactions","settlements"]){
    const html=renderToStaticMarkup(React.createElement(TossReadPanel,{token:null,kind}));
    assert.match(html,/읽기 전용/);assert.match(html,/서버 설정 확인 중/);
    assert.match(html,/disabled=""/);assert.match(html,/type="date"/);assert.match(html,/종료일/);
    assert.doesNotMatch(html,/live_sk_|test_sk_|TOSS_SECRET/);
  }
  assert.equal(calls,0);
});
