import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as crypto from "node:crypto";
import { budgetOf, classifiedCards, payoutsOf, validateLinks } from "../lib/finance/domain.mjs";
import * as domain from "../lib/finance/domain.mjs";
import { createLedgerProjection, workspaceFromLedger } from "../lib/finance/ledger-adapter.mjs";
import { mountFinanceWorkspace } from "../lib/finance/workspace.mjs";
import { inferMapping, parseCsv, previewImport } from "../lib/finance/import-file.mjs";

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const row=(n,fields={})=>({id:id(n),version:1,archived_at:null,...fields});
class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
function load(file,imports={},env={}){
  const compiled={exports:{}};
  const source=fs.readFileSync(new URL(`../${file}`,import.meta.url),"utf8");
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:compiled,exports:compiled.exports,require(name){if(name==="zod")return zod;if(name==="node:crypto")return crypto;if(name==="@/lib/http")return {ApiError};if(name in imports)return imports[name];throw new Error(`Unmocked import: ${name}`);},console,Buffer,AbortSignal,Response,structuredClone,process:{env},Date,URLSearchParams,fetch:()=>{throw new Error("Network must be mocked");}});
  return compiled.exports;
}
const schema=load("lib/finance/schema.ts");
function ledger(extra={}){return {...Object.fromEntries(schema.READ_RESOURCES.map(x=>[x,[]])),...extra};}
function actorFor(data){
  const calls=[];
  return {id:id(900),role:"admin",calls,supabase:{from(table){
    const rows=data[table.replace(/^os_fin_/,"")]||[];
    return {select(){return this;},order(){return this;},range(a,b){return Promise.resolve({data:rows.slice(a,b+1),error:null});}};
  },async rpc(name,args){calls.push({name,args});return {data:args.p_changes||{},error:null};}}};
}
const server=load("lib/server/finance.ts",{"./auth":{authenticateRequest:async()=>{throw new ApiError(401,"AUTH_REQUIRED","auth");}},"@/lib/finance/schema":schema,"@/lib/finance/domain.mjs":domain});

test("finance normalized schema rejects unsafe amounts, date/time and privileged fields",()=>{
  const item={...row(1),kind:"manual",amount:1};
  assert.equal(schema.won.safeParse(1.2).success,false);
  assert.equal(schema.won.safeParse(Number.MAX_SAFE_INTEGER+1).success,false);
  assert.equal(schema.date.safeParse("2026-02-30").success,false);
  assert.equal(schema.resourceSchemas.settings.safeParse({...row(1),key:"net_include_research",value:"true"}).success,false);
  assert.equal(schema.resourceSchemas.settings.safeParse({...row(1),key:"net_include_research",value:true,created_by:id(900)}).success,false);
  assert.equal(schema.resourceSchemas.refund_requests,undefined);
  assert.equal(schema.resourceSchemas.budget_actuals.safeParse({...item,item_id:id(3),month:"2026-09-02"}).success,false);
});
test("real workspace starts empty, never copies mock money or employees into a new ledger",()=>{
  const data=workspaceFromLedger(ledger(),"2027-01-07");
  const model=mountFinanceWorkspace(null,{data,today:"2027-01-07"});
  assert.equal(model.transactions.length,0);assert.equal(model.cards.length,0);assert.equal(model.bankRows().length,0);
  assert.equal(model.state.ext.length,0);assert.equal(model.state.accounts.length,0);
  assert.equal(model.period.month,"2026-12");assert.equal(model.netOf("2026-12").net,0);
  model.startBudgetDefaults();assert.equal(model.state.budget.length,14);
  for(const item of model.state.budget){assert.match(item.id,/^[\da-f-]{36}$/);assert.equal(item.amount,0);assert.equal(item.owner,"");}
});
test("mock refund completion never claims the original payment was canceled",()=>{
  const data=workspaceFromLedger(ledger({
    payments:[row(1,{biz:"edu",status:"DONE",paid_date:"2026-09-10",amount:100000,canceled_amount:0})],
    refund_requests:[row(2,{payment_id:id(1),state:"done",mock:true,amount:10000,kind:"partial",result:{money_moved:false}})],
  }),"2026-10-07");
  assert.equal(data.DB.refunds[id(1)].state,"모의 승인 완료");
  const model=mountFinanceWorkspace(null,{data,today:"2026-10-07"});
  assert.equal(model.transactions[0].cancel,0);
});
test("all connected views render with an empty new ledger after the seventh day",()=>{
  const model=mountFinanceWorkspace(null,{data:workspaceFromLedger(ledger(),"2027-02-20"),today:"2027-02-20"});
  for(const page of ["overview","sales","settlements","bank","cards","recurring","budget"]){
    const html=model.renderPage(page);
    assert.doesNotMatch(html,/undefined|NaN|Invalid Date/,page);
    assert.doesNotMatch(html,/거래 06:00 · 정산 07:00/,page);
  }
});
test("connected populated views and editable projections agree with API schemas",()=>{
  const data=ledger({
    bank_accounts:[row(1,{bank:"은행",name:"QA 통장",last4:"1234",uses:[],method:"excel",sync_freq:"daily_0700",include_in_net:true,opening_balance:null})],
    bank_transactions:[row(2,{account_id:id(1),tx_date:"2026-09-10",time:"12:00",description:"PG",deposit:1000,withdrawal:0,balance_after:null,manual_category:null,link_type:null,link_ref:null,dedupe_key:"test",branch:null,import_batch_id:null})],
    stores:[row(3,{biz:"edu",bank_keyword:"PG"})],payments:[row(4,{biz:"edu",payment_key:"test-payment",order_id:"test-order",order_name:"Synthetic order",method:"카드",status:"DONE",paid_date:"2026-09-07",amount:1100,fee:null,canceled_amount:0,customer_masked:"가상***"})],
    settlements:[row(5,{store_id:id(3),biz:"edu",payment_key:"test-payment",sold_date:"2026-09-07",paid_out_date:"2026-09-10",amount:1100,fee:100,pay_out_amount:1000,method:"카드",is_cancel:false})],
    cards:[row(6,{issuer:"카드사",name:"QA 카드",last4:"5678",holder_name:"가상 담당",holder_profile_id:null})],
    card_transactions:[row(7,{card_id:id(6),used_date:"2026-09-09",time:"09:00",merchant:"Synthetic shop",amount_krw:100,approval_no:"TEST",foreign_amount:null,currency:null,manual_category:null,manual_biz:null,manual_vat:null,memo:null,receipt_path:null,canceled:false})],
    budget_items:[row(8,{kind:"fixed",name:"QA 예산",biz:"common",source:"manual",monthly_amount:200,card_categories:[],bank_categories:[],owner_name:"",memo:"",sort_order:0})],budget_actuals:[row(9,{item_id:id(8),month:"2026-09-01",amount:100})],
    external_revenues:[row(10,{kind:"lecture",biz:"ba",title:"QA 외부 매출",client:"",revenue_date:"2026-09-09",usd:null,supply:100,vat:10,due_date:null,invoice:"",memo:""})],
  });
  const workspace=workspaceFromLedger(data,"2026-10-07"),model=mountFinanceWorkspace(null,{data:workspace,today:"2026-10-07"});
  for(const page of ["overview","sales","settlements","bank","cards","recurring","budget"])assert.doesNotMatch(model.renderPage(page),/undefined|NaN|Invalid Date/,page);
  const projected=createLedgerProjection(data).project(workspace);
  for(const [resource,rows]of Object.entries(projected))for(const row of rows)assert.equal(schema.resourceSchemas[resource].safeParse(row).success,true,resource);
  assert.equal(model.netOf("2026-09").inn,1000);assert.equal(model.netOf("2026-09").cost,100);assert.match(model.renderPage("overview"),/수수료 자료 수집 후 확인/);
});
test("payout reconciliation refuses ambiguous equal deposits and sums explicit split deposits",()=>{
  const data=ledger({stores:[row(1,{bank_keyword:"PG"}),row(2,{bank_keyword:"PG"})],settlements:[row(3,{store_id:id(1),biz:"edu",paid_out_date:"2026-09-10",sold_date:"2026-09-06",amount:1100,fee:100,pay_out_amount:1000})],bank_accounts:[row(4,{include_in_net:true})],bank_transactions:[row(5,{account_id:id(4),tx_date:"2026-09-10",description:"PG",deposit:1000,withdrawal:0})]});
  assert.equal(payoutsOf(data,"2026-10-07")[0].state,"입금 확인");
  data.settlements.push(row(6,{...data.settlements[0],id:id(6),store_id:id(2)}));
  assert.ok(payoutsOf(data,"2026-10-07").every(p=>p.state==="미확인"));
  data.bank_transactions[0].link_type="payout";data.bank_transactions[0].link_ref=id(1)+":2026-09-10";data.bank_transactions[0].deposit=600;
  data.bank_transactions.push(row(7,{...data.bank_transactions[0],id:id(7),deposit:400}));
  assert.equal(payoutsOf(data,"2026-10-07")[0].bankAmount,1000);
});
test("canceled cards do not enter actual spend; explicit blank memo survives rules",()=>{
  const data=ledger({card_rules:[row(1,{enabled:true,sort_order:0,keywords:["SHOP"],category:"회의비",biz:"common",vat_type:"공제 예상",memo_template:"auto"})],card_transactions:[row(2,{used_date:"2026-09-10",merchant:"Shop",amount_krw:900,canceled:false,manual_category:null,manual_biz:null,manual_vat:null,memo:""}),row(3,{used_date:"2026-09-10",merchant:"Shop",amount_krw:1200,canceled:true})],budget_items:[row(4,{kind:"variable",source:"card",card_categories:["회의비"],biz:"common",monthly_amount:1000})]});
  assert.equal(classifiedCards(data).length,1);assert.equal(classifiedCards(data)[0].memo,"");assert.equal(budgetOf(data,"2026-09").cost,900);
});
test("manual actual zero is different from missing and research excludes by default",()=>{
  const data=ledger({bank_accounts:[row(1,{include_in_net:true})],bank_transactions:[row(2,{account_id:id(1),tx_date:"2026-09-10",description:"연구",deposit:500,withdrawal:0,manual_category:"연구비"})],budget_items:[row(3,{source:"manual",kind:"labor",monthly_amount:200}),row(4,{source:"manual",kind:"fixed",monthly_amount:200})],budget_actuals:[row(5,{item_id:id(3),month:"2026-09-01",amount:0})]});
  assert.equal(budgetOf(data,"2026-09").income,0);assert.equal(budgetOf(data,"2026-09").missing,1);
  data.settings=[row(6,{key:"net_include_research",value:true})];assert.equal(budgetOf(data,"2026-09").income,500);
  data.bank_accounts[0].include_in_net=false;assert.equal(budgetOf(data,"2026-09").income,0);
});
test("connected budget API and UI agree on unimported costs, bank categories and transfers",()=>{
  const data=ledger({bank_accounts:[row(1,{name:"A",include_in_net:true,method:"excel",sync_freq:"daily_0700"})],bank_transactions:[row(2,{account_id:id(1),tx_date:"2026-09-10",time:"00:00",description:"manual revenue",deposit:500,withdrawal:0,manual_category:"외부 매출"}),row(3,{account_id:id(1),tx_date:"2026-09-10",time:"00:00",description:"transfer",deposit:900,withdrawal:0,manual_category:"외부 매출",link_type:"transfer",link_ref:id(4)})],budget_items:[row(5,{source:"card",kind:"variable",card_categories:["회의비"],biz:"any",monthly_amount:100}),row(6,{source:"bank",kind:"fixed",bank_categories:["임대료"],biz:"any",monthly_amount:100})]});
  const model=mountFinanceWorkspace(null,{data:workspaceFromLedger(data,"2026-10-20"),today:"2026-10-20"});
  const api=budgetOf(data,"2026-09","all","2026-10-20"),ui=model.netOf("2026-09");
  assert.equal(api.income,500);assert.equal(api.income,ui.inn);assert.equal(api.cost,ui.cost);assert.equal(api.missing,ui.missing);assert.equal(api.missing,1);
  const empty=mountFinanceWorkspace(null,{data:workspaceFromLedger(ledger(),"2027-02-20"),today:"2027-02-20"});
  assert.deepEqual(empty.prevRange(),["2027-01-01","2027-01-20"]);
});
test("overview uses each cancellation event date and does not invent unknown fees",()=>{
  const data=ledger({payments:[row(1,{biz:"edu",status:"PARTIAL_CANCELED",paid_date:"2026-08-01",amount:1000,fee:null})],payment_cancels:[row(2,{payment_id:id(1),cancel_date:"2026-09-01",cancel_amount:100,fee_refund:null}),row(3,{payment_id:id(1),cancel_date:"2026-10-01",cancel_amount:200,fee_refund:null})]});
  const report=domain.overviewOf(data,"2026-09");assert.equal(report.canceled,100);assert.equal(report.gross,0);assert.equal(report.netRevenue,-100);assert.equal(report.fee,null);
});
test("API rechecks active finance access and never trusts stale actor claims",async()=>{
  for(const profile of [null,{is_active:false,role:"admin",finance_access:true},{is_active:true,role:"member",finance_access:false},{is_active:true,role:"member",finance_access:true},{is_active:true,role:"admin",finance_access:false}]){
    const actor={id:id(9),role:"admin",supabase:{from(){return {select(){return this;},eq(){return this;},single:async()=>({data:profile,error:null})};}}};
    const auth=load("lib/server/finance.ts",{"./auth":{authenticateRequest:async()=>actor},"@/lib/finance/schema":schema,"@/lib/finance/domain.mjs":domain});
    if(profile?.is_active&&(profile.role==="admin"||profile.finance_access))assert.equal(await auth.financeActor({}),actor);
    else await assert.rejects(auth.financeActor({}),e=>e.status===403);
  }
});
test("JSON parser enforces actual bytes even when Content-Length is absent",async()=>{
  assert.equal((await server.financeJson(new Request("http://localhost",{method:"POST",body:'{"ok":true}'}))).ok,true);
  await assert.rejects(server.financeJson(new Request("http://localhost",{method:"POST",body:"broken"})),e=>e.status===400);
  await assert.rejects(server.financeJson(new Request("http://localhost",{method:"POST",body:"x".repeat(3_500_001)})),e=>e.status===413);
});
test("receipt attachment rejects another transaction path, oversize data and stale writes",async()=>{
  const receipts=load("lib/server/finance-receipts.ts",{"./finance":{financeDbError:server.financeDbError}});
  let writes=0;let meta={size:100,contentType:"application/pdf"};
  const actor={id:id(9),supabase:{storage:{from(){return {info:async()=>({data:meta,error:null})};}},from(){return {update(){writes++;return this;},eq(){return this;},is(){return this;},select(){return this;},maybeSingle:async()=>({data:null,error:null})};}}};
  await assert.rejects(receipts.receiptAttach(actor,id(1),{version:1,path:`cards/${id(2)}/${id(3)}.pdf`}),e=>e.code==="FINANCE_RECEIPT_PATH");
  meta={size:10485761,contentType:"application/pdf",metadata:{size:100,mimetype:"application/pdf"}};await assert.rejects(receipts.receiptAttach(actor,id(1),{version:1,path:`cards/${id(1)}/${id(3)}.pdf`}),e=>e.code==="FINANCE_RECEIPT_INVALID");assert.equal(writes,0);
  meta={metadata:{size:100,mimetype:"application/pdf"}};await assert.rejects(receipts.receiptAttach(actor,id(1),{version:1,path:`cards/${id(1)}/${id(3)}.pdf`}),e=>e.code==="FINANCE_RECEIPT_INVALID");assert.equal(writes,0);
  meta={size:100,contentType:"application/pdf"};await assert.rejects(receipts.receiptAttach(actor,id(1),{version:1,path:`cards/${id(1)}/${id(3)}.pdf`}),e=>e.status===409);assert.equal(writes,1);
});
test("link validation requires reciprocal transfer and unique active external deposit",()=>{
  const data=ledger({bank_accounts:[row(1,{name:"A"}),row(2,{name:"B"})],bank_transactions:[row(3,{account_id:id(1),tx_date:"2026-09-10",deposit:0,withdrawal:100,link_type:"transfer",link_ref:id(4)}),row(4,{account_id:id(2),tx_date:"2026-09-11",deposit:100,withdrawal:0,link_type:"transfer",link_ref:id(3)})]});
  assert.doesNotThrow(()=>validateLinks(data));data.bank_transactions[1].deposit=101;assert.throws(()=>validateLinks(data),/이체/);
  data.bank_transactions=[row(5,{account_id:id(1),deposit:100,link_type:"external_revenue",link_ref:id(6)})];data.external_revenues=[row(6)];assert.doesNotThrow(()=>validateLinks(data));data.external_revenues[0].archived_at=new Date().toISOString();assert.throws(()=>validateLinks(data),/외부 매출/);
});
test("projection only sends changed user fields, preserves metadata and soft archives",()=>{
  const data=ledger({external_revenues:[row(1,{kind:"lecture",biz:"ba",title:"Workshop",client:"",revenue_date:"2026-09-01",usd:null,supply:100,vat:10,due_date:null,invoice:"",memo:""})]});
  const before=workspaceFromLedger(data,"2026-10-07"),after=structuredClone(before),projection=createLedgerProjection(data);
  assert.equal(projection.diff(before,after).length,0);after.DB.ext[0].memo="edit";
  const [change]=projection.diff(before,after);assert.equal(change.row.version,1);assert.equal(change.row.memo,"edit");assert.equal(change.resource,"external_revenues");assert.equal("created_by" in change.row,false);
  projection.ack([{...change,row:{...change.row,version:2}}]);assert.equal(projection.diff(before,after)[0].row.version,2);
  after.DB.ext=[];assert.ok(projection.diff(before,after)[0].row.archived_at);
});
test("projection maps bank connection labels without resetting their settings",()=>{
  const data=ledger({bank_accounts:[row(1,{bank:"은행",name:"A",last4:"1234",uses:[],method:"bank_api",sync_freq:"4x_daily",include_in_net:false,opening_balance:10})]});
  const workspace=workspaceFromLedger(data,"2026-10-07"),p=createLedgerProjection(data);
  assert.equal(workspace.DB.accounts[0].method,"kb");assert.equal(workspace.DB.accounts[0].freq,"하루 4번");
  assert.equal(p.project(workspace).bank_accounts[0].method,"bank_api");assert.equal(p.diff(workspace,structuredClone(workspace)).length,0);
});
test("server refuses stale versions and receipt path injection before RPC",async()=>{
  const data=ledger({settings:[row(1,{key:"net_include_research",value:false})]}),actor=actorFor(data);
  await assert.rejects(server.commitFinance(actor,{changes:[{resource:"settings",row:{...row(1),version:0,key:"net_include_research",value:true}}]}),e=>e.status===409);
  await assert.rejects(server.commitFinance(actor,{changes:[{resource:"__proto__",row:{}}]}),e=>e.status===400);
  assert.equal(actor.calls.length,0);
  await server.commitFinance(actor,{changes:[{resource:"settings",row:{...row(1),key:"net_include_research",value:true}}]});assert.equal(actor.calls[0].name,"os_fin_commit");
});
test("user read never exposes provider raw JSON or server secret names",async()=>{
  const rows=await server.readFinance(actorFor(ledger({stores:[row(1,{name:"Store",raw:{PII:"private"},secret_env:"hidden"})]})),"stores");
  assert.equal(rows[0].raw,undefined);assert.equal(rows[0].secret_env,undefined);
  await assert.rejects(server.readFinance(actorFor(ledger()),"os_profiles"),e=>e.status===404);
});
test("imports update same card approval without erasing manual classification or receipt",async()=>{
  const old=row(2,{card_id:id(1),used_date:"2026-09-10",time:"10:00",merchant:"Shop",amount_krw:100,approval_no:"A1",foreign_amount:1,currency:"USD",installment:null,canceled:false,manual_category:"회의비",manual_biz:"common",manual_vat:"공제 예상",memo:"keep",receipt_path:"private",import_batch_id:null});
  const data=ledger({cards:[row(1,{last4:"1234"})],card_transactions:[old]});let changes;
  const importer=load("lib/server/finance-imports.ts",{"@/lib/finance/schema":schema,"./finance":{readLedger:async()=>data,commitFinance:async(_,b)=>{changes=b.changes;return b;}}});
  const body={kind:"cards",rows:[{date:"2026-09-10",time:"10:00",last:"1234",merchant:"Shop",appr:"A1",krw:150,fx:1}],cards:[],fileName:"synthetic.csv",headers:["date"],mapping:{date:0},account:""};
  await importer.importFinance({},body);
  const saved=changes.find(c=>c.resource==="card_transactions").row;
  assert.equal(saved.id,old.id);assert.equal(saved.amount_krw,150);assert.equal(saved.memo,"keep");assert.equal(saved.manual_category,"회의비");assert.equal(saved.receipt_path,"private");
  body.rows[0].krw=-150;data.card_transactions=[saved];await importer.importFinance({},body);assert.equal(changes.find(c=>c.resource==="card_transactions").row.canceled,true);
});
test("bank import hash includes account, time, directions, balance, and description",async()=>{
  const data=ledger({bank_accounts:[row(1,{name:"A"})]}),saved=[];
  const importer=load("lib/server/finance-imports.ts",{"@/lib/finance/schema":schema,"./finance":{readLedger:async()=>data,commitFinance:async(_,b)=>{saved.push(...b.changes);return b;}}});
  const transaction={date:"2026-09-10",time:"10:00",acct:id(1),desc:"same",in:100,out:0,balance:100};
  await importer.importFinance({},{kind:"bank",rows:[transaction,transaction,{...transaction,balance:200}],cards:[],fileName:"synthetic.csv",headers:["date"],mapping:{date:0},account:id(1)});
  const transactions=saved.filter(c=>c.resource==="bank_transactions");assert.equal(transactions.length,2);assert.notEqual(transactions[0].row.dedupe_key,transactions[1].row.dedupe_key);
});
test("card preview handles FX update/cancel as updates instead of double-counted expense",()=>{
  const table=parseCsv("이용일,카드번호,가맹점,금액,승인번호,취소\n2026-09-10,1234,Shop,150,A1,\n2026-09-10,1234,Shop,150,A1,취소");
  const preview=previewImport(table,inferMapping(table.headers,"cards"),"cards",[{date:"2026-09-10",last:"1234",merchant:"Shop",appr:"A1",krw:100}]);
  assert.equal(preview.valid.length,1);assert.equal(preview.valid[0].krw,-150);
});
test("Toss adapter validates integer settlement arithmetic and drops sensitive raw fields",()=>{
  const provider=load("lib/finance/toss/provider.ts",{"../schema":schema});
  const settlement={paymentKey:"p",transactionKey:"t",method:"카드",amount:1100,supplyAmount:90,vat:10,payOutAmount:1000,soldDate:"2026-09-10",paidOutDate:"2026-09-13",currency:"KRW",card:{number:"DO-NOT-STORE"}};
  assert.equal(provider.normalizeSettlement(settlement).fee,100);assert.equal(provider.normalizeSettlement(settlement).card,undefined);
  assert.throws(()=>provider.normalizeSettlement({...settlement,payOutAmount:999}),e=>e.code==="TOSS_INVALID_RESPONSE");
  const p=provider.normalizePayment({paymentKey:"p",orderId:"o",orderName:"item",method:"카드",totalAmount:100,balanceAmount:50,status:"PARTIAL_CANCELED",approvedAt:"2026-09-01T00:00:00+09:00",requestedAt:"2026-08-31T23:59:00+09:00",cancels:[{transactionKey:"c",cancelAmount:50,canceledAt:"2026-10-01T00:30:00+09:00",cancelReason:"requested"}],customerName:"DO-NOT-STORE"});
  assert.equal(p.canceled_amount,50);assert.equal(p.cancels[0].cancel_date,"2026-10-01");assert.equal(p.customerName,undefined);
});
test("real cancellation remains absent even with live-looking configuration",async()=>{
  const provider=load("lib/finance/toss/provider.ts",{"../schema":schema});let calls=0;
  const toss=provider.tossProvider("edu",{FINANCE_TOSS_MODE:"test",TOSS_SECRET_KEY_EDU:"test_sk_synthetic"},async()=>{calls++;throw new Error("must not execute");});
  await assert.rejects(toss.cancel(),e=>e.code==="TOSS_CANCEL_DISABLED");assert.equal(calls,0);
});
test("refunds are disabled by default and mock approvals are denied in Production",async()=>{
  let calls=0;
  const imports={"@/lib/finance/schema":schema,"@/lib/supabase/server":{createServiceSupabase(){calls++;throw new Error("not allowed");}},"./finance":{financeDbError:server.financeDbError}};
  for(const env of [{},{FINANCE_REFUND_MODE:"mock",OS_ENVIRONMENT:"production"}]){
    const refund=load("lib/server/finance-refunds.ts",imports,env);
    await assert.rejects(refund.refundCommand({},"approve",{id:id(1),version:1}),e=>e.code==="FINANCE_REFUND_DISABLED");
  }
  assert.equal(calls,0);
});
test("migration declares private receipt storage, RLS, atomic CAS and non-self approval",()=>{
  const sql=fs.readFileSync(new URL("../supabase/migrations/20261007085710_finance_ledger.sql",import.meta.url),"utf8");
  assert.match(sql,/enable row level security/);assert.match(sql,/a.version=\$2/);assert.match(sql,/security_invoker=true/);assert.match(sql,/FINANCE_SELF_APPROVAL/);assert.match(sql,/deferrable initially deferred/);assert.match(sql,/'finance-receipts',false,10485760/);
  assert.doesNotMatch(sql,/delete from|truncate |drop table|grant .* to anon/i);
  assert.match(sql,/revoke all on function public.os_fin_refund_finish_mock\(uuid,integer\) from public,anon,authenticated/);
});
