import { z } from "zod";
import { ApiError } from "@/lib/http";
import { date, won } from "../schema";

const cancel=z.object({transactionKey:z.string().min(1).max(64),cancelAmount:won.min(1),canceledAt:z.string().datetime({offset:true}),cancelReason:z.string().max(200)});
const payment=z.object({paymentKey:z.string().min(1).max(200),orderId:z.string().max(64),orderName:z.string().max(120),method:z.string().nullable(),totalAmount:won,balanceAmount:won,status:z.enum(["DONE","CANCELED","PARTIAL_CANCELED","WAITING_FOR_DEPOSIT"]),approvedAt:z.string().datetime({offset:true}).nullable(),requestedAt:z.string().datetime({offset:true}),cancels:z.array(cancel).nullable().optional(),card:z.object({issuerCode:z.string()}).nullable().optional()});
const settlement=z.object({paymentKey:z.string().min(1).max(200),transactionKey:z.string().min(1).max(64),method:z.string(),amount:z.number().int().safe(),supplyAmount:z.number().int().safe(),vat:z.number().int().safe(),payOutAmount:z.number().int().safe(),soldDate:date,paidOutDate:date,currency:z.literal("KRW")});
const kstDate=(s:string)=>new Date(s).toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"});
export function normalizePayment(value:unknown){
  const p=payment.parse(value);
  if(p.balanceAmount>p.totalAmount)throw new ApiError(502,"TOSS_INVALID_RESPONSE","결제 금액을 검증하지 못했습니다.");
  return {payment_key:p.paymentKey,order_id:p.orderId,order_name:p.orderName,method:p.method||"미기록",card_issuer:p.card?.issuerCode??null,amount:p.totalAmount,canceled_amount:p.totalAmount-p.balanceAmount,status:p.status,approved_at:p.approvedAt,paid_date:kstDate(p.approvedAt||p.requestedAt),cancels:(p.cancels||[]).map(c=>({transaction_key:c.transactionKey,cancel_amount:c.cancelAmount,canceled_at:c.canceledAt,cancel_date:kstDate(c.canceledAt),reason:c.cancelReason}))};
}
export function normalizeSettlement(value:unknown){
  const s=settlement.parse(value),fee=s.supplyAmount+s.vat;
  if(s.payOutAmount!==s.amount-fee)throw new ApiError(502,"TOSS_INVALID_RESPONSE","정산 금액과 수수료가 맞지 않습니다.");
  return {payment_key:s.paymentKey,transaction_key:s.transactionKey,method:s.method,amount:s.amount,fee,supply_fee:s.supplyAmount,vat_fee:s.vat,pay_out_amount:s.payOutAmount,sold_date:s.soldDate,paid_out_date:s.paidOutDate,is_cancel:s.amount<0};
}
export type TossPayment=ReturnType<typeof normalizePayment>;
export type TossSettlement=ReturnType<typeof normalizeSettlement>;
export const TOSS_KEYS={edu:"TOSS_SECRET_KEY_EDU",myin:"TOSS_SECRET_KEY_MYIN",hm:"TOSS_SECRET_KEY_HM"} as const;
export function tossProvider(biz:keyof typeof TOSS_KEYS,env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch){
  const mode=env.FINANCE_TOSS_MODE||"mock",key=env[TOSS_KEYS[biz]];
  if(!["test","live"].includes(mode)||!key)throw new ApiError(409,"TOSS_NOT_CONFIGURED","토스 상점 연결이 필요합니다.");
  if(!key.startsWith(mode==="test"?"test_sk_":"live_sk_"))throw new ApiError(409,"TOSS_KEY_MODE_MISMATCH","토스 키와 실행 환경을 확인해 주세요.");
  const call=async(path:string,method="GET",body?:unknown,idempotency?:string)=>{
    let response:Response;
    try{response=await fetcher(`https://api.tosspayments.com/v1/${path}`,{method,headers:{Authorization:`Basic ${Buffer.from(key+":").toString("base64")}`,"Content-Type":"application/json",...(idempotency?{"Idempotency-Key":idempotency}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store",signal:AbortSignal.timeout(65000),redirect:"error"});}
    catch{throw new ApiError(502,"TOSS_NETWORK_ERROR","토스 응답을 확인하지 못했습니다. 동일 요청으로 다시 확인해야 합니다.");}
    const data=await response.json().catch(()=>null);
    if(!response.ok){const code=typeof data?.code==="string"&&/^[A-Z_0-9]{1,80}$/.test(data.code)?data.code:"UPSTREAM_ERROR";throw new ApiError(502,`TOSS_${code}`,"토스 요청을 처리하지 못했습니다. 오류 코드와 상점 상태를 확인해 주세요.");}
    return data;
  };
  return {
    async payment(key:string){return normalizePayment(await call(`payments/${encodeURIComponent(key)}`));},
    async transactions(from:string,to:string,cursor?:string){
      const q=new URLSearchParams({startDate:from,endDate:to,limit:"50"});if(cursor)q.set("startingAfter",cursor);
      const rows=z.array(z.object({transactionKey:z.string(),paymentKey:z.string()})).max(50).parse(await call(`transactions?${q}`));
      return {keys:[...new Set(rows.map(x=>x.paymentKey))],next:rows.length===50?rows.at(-1)!.transactionKey:null};
    },
    async settlements(from:string,to:string,page=1){
      const q=new URLSearchParams({startDate:from,endDate:to,dateType:"paidOutDate",page:String(page),size:"1000"});
      const raw=z.array(z.unknown()).max(1000).parse(await call(`settlements?${q}`));
      return {rows:raw.map(normalizeSettlement),next:raw.length===1000?page+1:null};
    },
    async cancel(){
      // Live cancellation wiring is intentionally absent until separate approval.
      throw new ApiError(409,"TOSS_CANCEL_DISABLED","실제 결제 취소 연결은 별도 승인 후 구현합니다.");
    },
  };
}
