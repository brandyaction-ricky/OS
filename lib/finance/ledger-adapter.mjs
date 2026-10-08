import { active, payoutsOf, settingsOf } from "./domain.mjs";
const methods={excel:"xl",bank_api:"kb",openbanking:"ob",aggregator:"sc"};
const frequencies={hourly:"매시간",'4x_daily':"하루 4번",daily_0700:"하루 1번 (07:00)"};
const stateNames={requested:"승인 대기",executing:"처리 중",done:"승인 · 취소됨",failed:"실패",rejected:"반려"};
export function workspaceFromLedger(data,today) {
  const settings=settingsOf(data), DB={v:6,bankRules:[],rules:[],budget:[],ext:[],ov:{},bov:{},refunds:{},po:{},owners:{},recState:{},oct:true,synced:true,accounts:[],archivedAccounts:[],netRnd:settings.net_include_research};
  const account=a=>({id:a.id,bank:a.bank,name:a.name,last:a.last4||"",uses:a.uses,method:methods[a.method],freq:frequencies[a.sync_freq],incl:a.include_in_net,open:a.opening_balance??null,sample:false});
  DB.accounts=active(data.bank_accounts).map(account);DB.archivedAccounts=(data.bank_accounts||[]).filter(x=>x.archived_at).map(account);
  DB.tossSync=active(data.stores).filter(s=>s.status==="connected").map(s=>({biz:s.biz,transactions:s.last_tx_synced_at,settlements:s.last_settlement_synced_at}));
  DB.rules=active(data.card_rules).sort((a,b)=>a.sort_order-b.sort_order).map(r=>({id:r.id,name:r.name,kw:r.keywords,cat:r.category,biz:r.biz,vat:r.vat_type,memo:r.memo_template,on:r.enabled}));
  DB.bankRules=active(data.bank_rules).sort((a,b)=>a.sort_order-b.sort_order).map(r=>({id:r.id,name:r.name,keyword:r.keyword,direction:r.direction,cat:r.category,on:r.enabled}));
  DB.ext=active(data.external_revenues).map(e=>({id:e.id,type:e.kind,biz:e.biz,title:e.title,client:e.client,date:e.revenue_date,usd:e.usd,supply:e.supply,vat:e.vat,due:e.due_date||"",invoice:e.invoice,memo:e.memo}));
  DB.budget=active(data.budget_items).sort((a,b)=>a.sort_order-b.sort_order).map(b=>({id:b.id,type:b.kind,name:b.name,biz:b.biz,amount:b.monthly_amount,source:b.source,cats:b.card_categories,bcats:b.bank_categories,owner:b.owner_name,memo:b.memo,actual:Object.fromEntries(active(data.budget_actuals).filter(x=>x.item_id===b.id).map(x=>[x.month.slice(0,7),x.amount]))}));
  for(const r of active(data.recurring_overrides)){DB.owners[r.merchant_key]=r.owner_profile_id||r.owner_name;DB.recState[r.merchant_key]=r.state;}
  const refunds=active(data.refund_requests).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
  for(const r of refunds)DB.refunds[r.payment_id]={id:r.id,version:r.version,amount:r.amount,type:r.kind==="full"?"전액":"부분",by:r.requested_by,at:r.requested_at,reason:r.reason,state:r.state==="done"&&r.mock?"모의 승인 완료":stateNames[r.state],mock:r.mock,result:r.result,date:r.decided_at?.slice(0,10)};
  const tx=active(data.payments).map(p=>({
    id:p.id,orderId:p.order_id,biz:p.biz,product:p.order_name,method:p.method,amount:p.amount,
    status:({DONE:"완료",CANCELED:"취소",PARTIAL_CANCELED:"부분 취소",WAITING_FOR_DEPOSIT:"입금 대기"})[p.status],
    date:p.paid_date,time:p.approved_at?new Date(p.approved_at).toLocaleTimeString("ko-KR",{timeZone:"Asia/Seoul",hour12:false,hour:"2-digit",minute:"2-digit"}):"",
    fee:p.fee??0,feeKnown:p.fee!=null,cancel:p.canceled_amount,
    cancelEvents:active(data.payment_cancels).filter(c=>c.payment_id===p.id).map(c=>({date:c.cancel_date,amount:c.cancel_amount,feeRefund:c.fee_refund})),
    cancelDate:active(data.payment_cancels).filter(x=>x.payment_id===p.id).map(x=>x.cancel_date).sort().at(-1),
    cust:p.customer_masked||"미기록",approval:"미제공",key:p.payment_key?.slice(-4)||"",issuer:p.card_issuer||"",src:p.source_channel||"미기록",
  }));
  const cards=active(data.cards).map(c=>({id:c.id,name:c.name,last:c.last4,user:c.holder_name||c.holder_profile_id||""}));
  const cr=active(data.card_transactions).map(c=>{
    DB.ov[c.id]={...(c.manual_category!==null?{cat:c.manual_category}:{}),...(c.manual_biz!==null?{biz:c.manual_biz}:{}),...(c.manual_vat!==null?{vat:c.manual_vat}:{}),...(c.memo!==null?{memo:c.memo}:{}),receipt:!!c.receipt_path,receiptName:c.receipt_path?.split("/").at(-1)||""};
    return {id:c.id,date:c.used_date,time:c.time,card:c.card_id,merchant:c.merchant,krw:c.amount_krw,fx:c.foreign_amount,cur:c.currency,appr:c.approval_no,canceled:c.canceled,memo:c.memo,receipt:!!c.receipt_path,mcat:c.manual_category,mbiz:c.manual_biz};
  });
  const bank=active(data.bank_transactions).map(b=>({id:b.id,acct:b.account_id,date:b.tx_date,time:b.time,desc:b.description,in:b.deposit,out:b.withdrawal,balance:b.balance_after,branch:b.branch,cat:b.manual_category??"미분류",link:b.link_type?{type:({external_revenue:"ext",transfer:"xfer",payout:"po"})[b.link_type],id:b.link_ref}:null}));
  const st=active(data.settlements).map(s=>({tx:tx.find(t=>t.id===data.payments?.find(p=>p.payment_key===s.payment_key)?.id)||{id:s.payment_key,product:"정산 거래",method:s.method},biz:s.biz,sold:s.sold_date,pay:s.paid_out_date,amount:s.amount,fee:s.fee,cancel:s.is_cancel}));
  const po=payoutsOf(data,today).map(p=>({id:p.id,biz:p.biz,pay:p.date,items:st.filter(s=>s.biz===p.biz&&s.pay===p.date),amount:p.amount,fee:p.fee,supply:Math.round(p.fee/1.1),vat:p.fee-Math.round(p.fee/1.1),payout:p.expected,count:p.items.length,soldFrom:p.items.map(x=>x.sold_date).sort()[0],soldTo:p.items.map(x=>x.sold_date).sort().at(-1),state:p.note&&["미확인","금액 다름"].includes(p.state)?"사유 기록":p.state,bank:p.bankAmount,bankIds:p.bankIds,note:p.note?{...p.note,by:p.note.updated_by,at:p.note.updated_at}:null}));
  for(const n of active(data.payout_notes))DB.po[n.store_id+":"+n.paid_out_date]={reason:n.reason,memo:n.memo,by:n.updated_by,at:n.updated_at};
  return {DB,TX:tx,CR:cr,CARDS:cards,BANK:bank,ST:st,PO:po,settings};
}

/** Diff only user-editable projections, not generated aggregates or provider fields. */
export function createLedgerProjection(initial) {
  let rows=initial;const ids=new Map();
  const idFor=(resource,key,match)=>{const found=rows[resource]?.find(match);if(found)return found.id;const k=resource+":"+key;if(!ids.has(k))ids.set(k,crypto.randomUUID());return ids.get(k);};
  function project(s) {
    const out={};const put=(r,id,fields)=>{const old=rows[r]?.find(x=>x.id===id);(out[r]??=[]).push({id,version:old?.version??0,archived_at:null,...fields});};
    for(const a of [...s.DB.accounts,...s.DB.archivedAccounts||[]])put("bank_accounts",a.id,{bank:a.bank,name:a.name,last4:a.last||null,uses:a.uses||[],method:Object.keys(methods).find(k=>methods[k]===a.method)||"excel",sync_freq:Object.keys(frequencies).find(k=>frequencies[k]===a.freq)||"daily_0700",include_in_net:a.incl!==false,opening_balance:a.open??null,archived_at:s.DB.accounts.some(x=>x.id===a.id)?null:rows.bank_accounts?.find(x=>x.id===a.id)?.archived_at||new Date().toISOString()});
    for(const e of s.DB.ext)put("external_revenues",e.id,{kind:e.type,biz:e.biz,title:e.title,client:e.client||"",revenue_date:e.date,usd:e.usd??null,supply:e.supply||0,vat:e.vat||0,due_date:e.due||null,invoice:e.invoice||"",memo:e.memo||""});
    s.DB.rules.forEach((r,i)=>put("card_rules",r.id,{name:r.name,keywords:r.kw,category:r.cat,biz:r.biz,vat_type:r.vat,memo_template:r.memo||"",enabled:r.on,sort_order:i}));
    s.DB.bankRules.forEach((r,i)=>put("bank_rules",r.id,{name:r.name,keyword:r.keyword,direction:r.direction,category:r.cat,enabled:r.on,sort_order:i}));
    for(const c of s.CARDS){const old=rows.cards?.find(x=>x.id===c.id);put("cards",c.id,{issuer:old?.issuer||"KB국민카드",name:c.name,last4:c.last,holder_profile_id:old?.holder_profile_id??null,holder_name:c.user||""});}
    for(const c of s.CR){const old=rows.card_transactions?.find(x=>x.id===c.id),o=s.DB.ov[c.id]||{};put("card_transactions",c.id,{card_id:c.card,used_date:c.date,time:c.time||"00:00",merchant:c.merchant,amount_krw:c.krw,foreign_amount:c.fx??null,currency:c.cur??null,approval_no:c.appr,installment:old?.installment??null,canceled:c.canceled??false,manual_category:o.cat??c.mcat??null,manual_biz:o.biz??c.mbiz??null,manual_vat:o.vat??old?.manual_vat??null,memo:"memo" in o?o.memo:c.memo??null,receipt_path:old?.receipt_path??null,import_batch_id:old?.import_batch_id??null});}
    for(const b of s.BANK){const old=rows.bank_transactions?.find(x=>x.id===b.id),o=s.DB.bov[b.id]||{},link="link" in o?o.link:b.link;put("bank_transactions",b.id,{account_id:b.acct,tx_date:b.date,time:b.time||"00:00",deposit:b.in,withdrawal:b.out,balance_after:b.balance??null,description:b.desc,branch:b.branch??null,dedupe_key:old?.dedupe_key||b.dedupeKey||b.id,manual_category:o.cat??(b.cat==="미분류"?null:b.cat),link_type:link?({ext:"external_revenue",xfer:"transfer",po:"payout"})[link.type]:null,link_ref:link?.id||null,import_batch_id:old?.import_batch_id??null});}
    s.DB.budget.forEach((b,i)=>{put("budget_items",b.id,{kind:b.type,name:b.name,biz:b.biz,monthly_amount:b.amount,source:b.source,card_categories:b.cats||[],bank_categories:b.bcats||[],owner_name:b.owner||"",memo:b.memo||"",sort_order:i});if(b.source==="manual")for(const [month,amount]of Object.entries(b.actual||{}))put("budget_actuals",idFor("budget_actuals",b.id+month,x=>x.item_id===b.id&&x.month===month+"-01"),{item_id:b.id,month:month+"-01",amount});});
    for(const merchant of new Set([...Object.keys(s.DB.owners),...Object.keys(s.DB.recState)]))put("recurring_overrides",idFor("recurring_overrides",merchant,x=>x.merchant_key===merchant),{merchant_key:merchant,owner_profile_id:null,owner_name:s.DB.owners[merchant]||"",state:s.DB.recState[merchant]||"유지"});
    for(const [key,n]of Object.entries(s.DB.po)){const [store,dt]=key.split(":");put("payout_notes",idFor("payout_notes",key,x=>x.store_id===store&&x.paid_out_date===dt),{store_id:store,paid_out_date:dt,reason:n.reason,memo:n.memo||""});}
    put("settings",idFor("settings","net_include_research",x=>x.key==="net_include_research"),{key:"net_include_research",value:s.DB.netRnd});
    return out;
  }
  return {project,ack(changes){for(const c of changes){rows[c.resource]=[...(rows[c.resource]||[]).filter(x=>x.id!==c.row.id),c.row];}},diff(before,after){
    const a=project(before),b=project(after),changes=[];
    for(const resource of new Set([...Object.keys(a),...Object.keys(b)])){
      for(const row of b[resource]||[]){const prev=a[resource]?.find(x=>x.id===row.id);if(JSON.stringify(prev)!==JSON.stringify(row))changes.push({resource,row});}
      for(const old of a[resource]||[])if(!b[resource]?.some(x=>x.id===old.id)&&old.version>0)changes.push({resource,row:{...old,archived_at:new Date().toISOString()}});
    }
    return changes;
  }};
}
