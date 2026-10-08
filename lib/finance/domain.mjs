/** Pure ledger calculations shared by HTTP and browser adapters. No demo data. */
export const DEFAULT_SETTINGS = Object.freeze({ net_include_research:false, usd_krw_estimate:1390, receipt_required_categories:["지급임차료","외주용역비","접대비"], data_start_date:null });
export const active = rows => (rows || []).filter(r => !r.archived_at);
const total = (rows,field) => rows.reduce((s,r)=>s+Number(r[field]||0),0);
export function settingsOf(data) { return {...DEFAULT_SETTINGS,...Object.fromEntries(active(data.settings).map(x=>[x.key,x.value]))}; }
export function classifiedCards(data) {
  const rules=active(data.card_rules).filter(x=>x.enabled).sort((a,b)=>a.sort_order-b.sort_order);
  return active(data.card_transactions).filter(x=>!x.canceled).map(row=>{
    const rule=rules.find(r=>r.keywords.some(k=>row.merchant.toLocaleLowerCase().includes(k.toLocaleLowerCase())));
    return {...row,category:row.manual_category??rule?.category??null,biz:row.manual_biz??rule?.biz??null,vat:row.manual_vat??rule?.vat_type??"판단 필요",memo:row.memo??rule?.memo_template??""};
  });
}
export function classifiedBank(data) {
  const accounts=new Set(active(data.bank_accounts).map(x=>x.id));
  const rules=active(data.bank_rules).filter(x=>x.enabled).sort((a,b)=>a.sort_order-b.sort_order);
  return active(data.bank_transactions).filter(x=>accounts.has(x.account_id)).map(row=>{
    const rule=rules.find(r=>(r.direction==="in")===(row.deposit>0)&&row.description.toLocaleLowerCase().includes(r.keyword.toLocaleLowerCase()));
    const linkedCategory=({payout:"토스 정산",external_revenue:"외부 매출",transfer:"내 통장 간 이체"})[row.link_type];
    return {...row,category:linkedCategory??row.manual_category??rule?.category??"미분류"};
  });
}
export function payoutsOf(data,today) {
  const stores=new Map((data.stores||[]).map(s=>[s.id,s]));
  const grouped=new Map();
  for(const s of active(data.settlements)) {
    const key=s.store_id+":"+s.paid_out_date;
    if(!grouped.has(key)) grouped.set(key,{id:key,store_id:s.store_id,biz:s.biz,date:s.paid_out_date,items:[]});
    grouped.get(key).items.push(s);
  }
  const bank=classifiedBank(data), used=new Set();
  return [...grouped.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)).map(p=>{
    const expected=total(p.items,"pay_out_amount");
    const explicit=bank.filter(b=>b.link_type==="payout"&&b.link_ref===p.id);
    // Ambiguous same-amount/store/date matches remain unconfirmed, never guessed.
    const candidates=bank.filter(b=>!b.link_type&&[null,undefined,"미분류","토스 정산"].includes(b.manual_category)&&!used.has(b.id)&&b.deposit===expected&&b.tx_date===p.date&&b.description.includes(stores.get(p.store_id)?.bank_keyword||"토스페이먼츠"));
    const sameExpected=[...grouped.values()].filter(x=>x.date===p.date&&total(x.items,"pay_out_amount")===expected).length;
    const matches=explicit.length?explicit:(candidates.length===1&&sameExpected===1?candidates:[]);
    matches.forEach(x=>used.add(x.id));
    const bankAmount=matches.length?total(matches,"deposit"):null;
    const state=p.date>today?"지급 예정":bankAmount===expected?"입금 확인":bankAmount!==null?"금액 다름":p.date===today?"입금 대기":"미확인";
    const note=active(data.payout_notes).find(n=>n.store_id===p.store_id&&n.paid_out_date===p.date);
    return {...p,amount:total(p.items,"amount"),fee:total(p.items,"fee"),expected,bankAmount,difference:bankAmount===null?null:bankAmount-expected,state,note,bankIds:matches.map(x=>x.id)};
  });
}
export function budgetOf(data,month,biz="all",today=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"})) {
  const included=new Set(active(data.bank_accounts).filter(x=>x.include_in_net).map(x=>x.id));
  const bank=classifiedBank(data).filter(x=>included.has(x.account_id)&&x.tx_date.startsWith(month)&&x.link_type!=="transfer"&&x.category!=="내 통장 간 이체");
  const cards=classifiedCards(data).filter(x=>x.used_date.startsWith(month));
  const cardUntil=active(data.card_transactions).map(x=>x.used_date).sort().at(-1)||"";
  const items=active(data.budget_items).filter(x=>biz==="all"||x.biz===biz||["any","common"].includes(x.biz)).map(item=>{
    const actual=active(data.budget_actuals).find(x=>x.item_id===item.id&&x.month===month+"-01");
    const matching=item.source==="card"?cards.filter(x=>(item.card_categories||[]).includes(x.category)&&(item.biz==="any"||x.biz===item.biz)):item.source==="bank"?bank.filter(x=>(item.bank_categories||[]).includes(x.category)):[];
    const amount=item.source==="manual"?(actual?actual.amount:null):item.source==="card"&&cardUntil<month+"-01"?null:item.source==="bank"&&!matching.length&&month>=today.slice(0,7)?null:total(matching,item.source==="card"?"amount_krw":"withdrawal");
    return {...item,actual:amount,missing:amount===null};
  });
  const settings=settingsOf(data);
  const payoutRows=payoutsOf(data,today);
  const payoutBank=new Set(payoutRows.filter(p=>biz==="all"||p.biz===biz).flatMap(p=>p.bankIds));
  const external=new Map(active(data.external_revenues).map(e=>[e.id,e]));
  const receipts=bank.filter(b=>payoutBank.has(b.id)||(b.link_type==="payout"&&(biz==="all"||data.stores?.find(s=>b.link_ref.startsWith(s.id+":"))?.biz===biz))||(b.link_type==="external_revenue"&&(biz==="all"||external.get(b.link_ref)?.biz===biz))||(biz==="all"&&(["토스 정산","외부 매출"].includes(b.category)||(settings.net_include_research&&b.category==="연구비"))));
  const income=total(receipts,"deposit"),cost=items.reduce((s,x)=>s+(x.actual??0),0);
  return {month,items,income,cost,net:income-cost,missing:items.filter(x=>x.missing).length};
}
export function overviewOf(data,month,biz="all",today=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"})) {
  const payments=active(data.payments), selected=p=>biz==="all"||p.biz===biz;
  const tx=payments.filter(p=>p.status!=="WAITING_FOR_DEPOSIT"&&p.paid_date.startsWith(month)&&selected(p));
  const paymentMap=new Map(payments.map(p=>[p.id,p]));
  const cancels=active(data.payment_cancels).filter(c=>c.cancel_date.startsWith(month)&&paymentMap.has(c.payment_id)&&selected(paymentMap.get(c.payment_id)));
  const bank=classifiedBank(data), settings=settingsOf(data);
  const external=active(data.external_revenues).filter(e=>e.revenue_date.startsWith(month)&&selected(e));
  const externalRevenue=external.reduce((sum,e)=>sum+(e.kind==="youtube"?(bank.find(b=>b.link_type==="external_revenue"&&b.link_ref===e.id)?.deposit??Math.round(e.usd*settings.usd_krw_estimate/10)*10):e.supply+e.vat),0);
  const gross=total(tx,"amount"), canceled=total(cancels,"cancel_amount");
  const fee=tx.some(t=>t.fee==null)||cancels.some(c=>c.fee_refund==null)?null:total(tx,"fee")-total(cancels,"fee_refund");
  return {month,biz,paymentCount:tx.length,gross,canceled,externalRevenue,netRevenue:gross-canceled+externalRevenue,fee,budget:budgetOf(data,month,biz,today)};
}
export function validateLinks(data) {
  const accounts=active(data.bank_accounts), names=new Set();
  for(const a of accounts){const n=a.name.toLocaleLowerCase();if(names.has(n))throw new Error("같은 이름의 통장이 있습니다.");names.add(n);}
  const bank=active(data.bank_transactions), ext=new Set(active(data.external_revenues).map(x=>x.id)), linked=new Set();
  for(const b of bank){
    if(!data.bank_accounts?.some(a=>a.id===b.account_id))throw new Error("통장을 찾을 수 없습니다.");
    if(b.link_type==="payout"&&(b.deposit<=0||!active(data.settlements).some(s=>s.store_id+":"+s.paid_out_date===b.link_ref)))throw new Error("입금 거래를 존재하는 토스 정산에 연결해 주세요.");
    if(b.link_type==="external_revenue"){
      if(b.deposit<=0||!ext.has(b.link_ref)||linked.has(b.link_ref))throw new Error("외부 매출은 입금 거래 하나에만 연결할 수 있습니다.");
      linked.add(b.link_ref);
    }
    if(b.link_type==="transfer"){
      const p=bank.find(x=>x.id===b.link_ref);
      if(!p||p.link_type!=="transfer"||p.link_ref!==b.id||p.account_id===b.account_id||p.deposit!==b.withdrawal||p.withdrawal!==b.deposit||Math.abs(Date.parse(p.tx_date)-Date.parse(b.tx_date))>86400000)throw new Error("이체는 다른 통장의 같은 금액·1일 이내 반대 거래끼리 묶어 주세요.");
    }
  }
  const cats=new Set();
  for(const b of active(data.budget_items).filter(x=>x.source==="bank"))for(const c of b.bank_categories){if(cats.has(c))throw new Error("같은 통장 출금 분류를 두 예산 항목에 넣을 수 없습니다.");cats.add(c);}
  for(const a of active(data.budget_actuals))if(!active(data.budget_items).some(b=>b.id===a.item_id&&b.source==="manual"))throw new Error("직접 입력 예산 항목에만 실적을 저장할 수 있습니다.");
}
