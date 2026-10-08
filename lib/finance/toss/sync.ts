import type { TossPayment, tossProvider } from "./provider";
import { ApiError } from "@/lib/http";

export const SYNC_TRANSACTION_PAGE_SIZE=10;
export interface TossSyncRun {
  id:string; date_from:string; date_to:string; mode:"test"|"live";
  state:"running"|"complete"|"abandoned"; phase:"transactions"|"settlements"|"complete";
  tx_cursor:string|null; settlement_page:number; page_count:number;
  transaction_count:number; payment_count:number; cancel_count:number; settlement_count:number; skipped_count:number;
  updated_at:string; completed_at:string|null; last_error_code:string|null;
}
export function publicSyncRun(run:TossSyncRun){
  // Explicit allowlist: no upstream identifiers, leases, credentials, binding or actor IDs.
  const {id,date_from,date_to,mode,state,phase,page_count,transaction_count,payment_count,cancel_count,settlement_count,skipped_count,updated_at,completed_at,last_error_code}=run;
  return {id,date_from,date_to,mode,state,phase,page_count,transaction_count,payment_count,cancel_count,settlement_count,skipped_count,updated_at,completed_at,last_error_code};
}
function checkedPayment(p:TossPayment){
  const total=p.cancels.reduce((sum,c)=>sum+c.cancel_amount,0);
  if(!Number.isSafeInteger(total)||total!==p.canceled_amount||new Set(p.cancels.map(c=>c.transaction_key)).size!==p.cancels.length
    ||(p.status==="CANCELED"&&p.canceled_amount!==p.amount)
    ||(p.status==="PARTIAL_CANCELED"&&!(p.canceled_amount>0&&p.canceled_amount<p.amount))
    ||(["DONE","WAITING_FOR_DEPOSIT"].includes(p.status)&&p.canceled_amount!==0))
    throw new ApiError(502,"TOSS_SYNC_INVALID_PAYMENT","결제·취소 합계가 맞지 않아 이번 묶음을 저장하지 않았습니다.");
  // Cancellation reasons may contain personal data. Store a fixed provenance label instead.
  return {...p,cancels:p.cancels.map(c=>({...c,reason:"토스 API 취소 내역"}))};
}
/** Exactly one upstream page per user action; no hidden loop, retry or self-invocation. */
export async function collectTossSyncPage(run:TossSyncRun,provider:ReturnType<typeof tossProvider>){
  if(run.phase==="transactions"){
    const page=await provider.transactions(run.date_from,run.date_to,run.tx_cursor??undefined,SYNC_TRANSACTION_PAGE_SIZE);
    // At most ten GET lookups, one shared request deadline supplied by the server.
    const found=await Promise.all(page.keys.map(key=>provider.payment(key)));
    const payments=found.filter(p=>["DONE","CANCELED","PARTIAL_CANCELED","WAITING_FOR_DEPOSIT"].includes(p.status)).map(checkedPayment);
    return {payments,transaction_count:page.rows.length,skipped_count:found.length-payments.length,next_cursor:page.next};
  }
  if(run.phase==="settlements"){
    const page=await provider.settlements(run.date_from,run.date_to,run.settlement_page);
    if(new Set(page.rows.map(s=>s.transaction_key)).size!==page.rows.length||page.rows.some(s=>s.paid_out_date<run.date_from||s.paid_out_date>run.date_to))
      throw new ApiError(502,"TOSS_SYNC_INVALID_SETTLEMENT","정산 날짜·중복을 검증하지 못해 이번 묶음을 저장하지 않았습니다.");
    return {settlements:page.rows,next_page:page.next};
  }
  throw new ApiError(409,"TOSS_SYNC_FINISHED","이미 종료된 수집입니다. 상태를 새로 확인해 주세요.");
}
