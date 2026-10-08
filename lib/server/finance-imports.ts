import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { date, resourceSchemas, type FinanceRow } from "@/lib/finance/schema";
import type { RequestActor } from "./auth";
import { commitFinance, readLedger } from "./finance";
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
const cardRow=z.object({date,time,last:z.string().regex(/^\d{4}$/),merchant:z.string().min(1).max(120),appr:z.string().min(1).max(80),krw:z.number().int().safe().refine(x=>x!==0),fx:z.number().nonnegative().max(9999999999).optional(),cur:z.string().regex(/^[A-Z]{3}$/).optional()}).strict();
const bankRow=z.object({date,time,acct:z.string().uuid(),desc:z.string().min(1).max(200),in:z.number().int().nonnegative().safe(),out:z.number().int().nonnegative().safe(),balance:z.number().int().safe().nullable().optional()}).strict();
const inputSchema=z.object({kind:z.enum(["cards","bank"]),rows:z.array(z.unknown()).min(1).max(1000),cards:z.array(z.object({last:z.string().regex(/^\d{4}$/),name:z.string().trim().min(1).max(30),user:z.string().trim().min(1).max(40)}).strict()).max(100),fileName:z.string().max(150),headers:z.array(z.string().max(8192)).max(100),mapping:z.record(z.number().int().min(-1).max(99)),account:z.string().optional()}).strict();
/** Parsed JSON only; never stores the workbook, full card number, or unmapped columns. */
export async function importFinance(actor:RequestActor,input:unknown){
  const body=inputSchema.parse(input),current=await readLedger(actor),changes:Array<{resource:string;row:FinanceRow}>=[];
  const add=(resource:keyof typeof resourceSchemas,row:unknown)=>{const parsed=resourceSchemas[resource].parse(row) as FinanceRow;changes.push({resource,row:parsed});return parsed;};
  const base=()=>({id:randomUUID(),version:0,archived_at:null});
  const cards=current.cards.filter(c=>!c.archived_at);
  for(const c of body.cards)if(!cards.some(x=>x.last4===c.last))cards.push(add("cards",{...base(),issuer:"KB국민카드",name:c.name,last4:c.last,holder_profile_id:null,holder_name:c.user}));
  const kind=body.kind==="cards"?"card":"bank";
  const signature=createHash("sha256").update(JSON.stringify(body.headers)).digest("hex");
  const oldMapping=current.import_mappings.find(m=>m.kind===kind&&m.header_signature===signature);
  const mapping=add("import_mappings",{...(oldMapping?{id:oldMapping.id,version:oldMapping.version}:base()),kind,header_signature:signature,columns:body.mapping,archived_at:null});
  const batch={...base(),kind,account_id:body.kind==="bank"?z.string().uuid().parse(body.account):null,file_name:body.fileName||"가져온 파일",row_count:body.rows.length,inserted:0,duplicates:0,skipped:0,period_from:null as string|null,period_to:null as string|null,mapping_id:mapping.id};
  const transactions=new Map<string,FinanceRow>();
  let duplicates=0;
  for(const inputRow of body.rows){
    if(body.kind==="cards"){
      const r=cardRow.parse(inputRow),matches=cards.filter(c=>c.last4===r.last);
      if(matches.length!==1)throw new ApiError(400,"FINANCE_CARD_AMBIGUOUS","카드 이름·끝 4자리를 확인해 주세요.");
      const card=matches[0],key=`card:${card.id}:${r.appr}:${r.date}`;
      const original=current.card_transactions.find(c=>c.card_id===card.id&&c.approval_no===r.appr&&c.used_date===r.date);
      const old=transactions.get(key)||original;
      // Same approval with changed FX settlement/cancellation updates provider fields only.
      if(old&&old.amount_krw===Math.abs(r.krw)&&(old.canceled===(r.krw<0)||old.canceled)){duplicates++;continue;}
      const row={...(old?{id:old.id,version:old.version}:base()),archived_at:old?.archived_at??null,card_id:card.id,used_date:r.date,time:r.time,merchant:r.merchant,amount_krw:Math.abs(r.krw),foreign_amount:r.fx||null,currency:r.fx?(r.cur||"USD"):null,approval_no:r.appr,installment:old?.installment??null,canceled:r.krw<0,manual_category:old?.manual_category??null,manual_biz:old?.manual_biz??null,manual_vat:old?.manual_vat??null,memo:old?.memo??null,receipt_path:old?.receipt_path??null,import_batch_id:batch.id};
      row.canceled=Boolean(old?.canceled)||row.canceled;
      transactions.set(key,resourceSchemas.card_transactions.parse(row) as FinanceRow);
    }else{
      const r=bankRow.parse(inputRow);
      if(r.acct!==body.account||!current.bank_accounts.some(a=>a.id===r.acct&&!a.archived_at))throw new ApiError(400,"FINANCE_ACCOUNT_REQUIRED","가져올 활성 통장을 선택해 주세요.");
      const dedupe=createHash("sha256").update(JSON.stringify([r.acct,r.date,r.time,r.in,r.out,r.balance??null,r.desc])).digest("hex");
      const key=`bank:${dedupe}`;
      if(transactions.has(key)||current.bank_transactions.some(x=>x.account_id===r.acct&&x.dedupe_key===dedupe)){duplicates++;continue;}
      transactions.set(key,resourceSchemas.bank_transactions.parse({...base(),account_id:r.acct,tx_date:r.date,time:r.time,deposit:r.in,withdrawal:r.out,balance_after:r.balance??null,description:r.desc,branch:null,dedupe_key:dedupe,manual_category:null,link_type:null,link_ref:null,import_batch_id:batch.id}) as FinanceRow);
    }
  }
  batch.inserted=transactions.size;batch.duplicates=duplicates;
  const dates=[...transactions.values()].map(r=>String(r.used_date||r.tx_date)).sort();batch.period_from=dates[0]??null;batch.period_to=dates.at(-1)??null;
  add("import_batches",batch);
  for(const [key,row]of transactions)add(key.startsWith("card:")?"card_transactions":"bank_transactions",row);
  const result=await commitFinance(actor,{changes});
  return {...result,inserted:batch.inserted,duplicates};
}
