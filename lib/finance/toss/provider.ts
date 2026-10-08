import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { date, won } from "../schema";

const cancel=z.object({transactionKey:z.string().min(1).max(64),cancelAmount:won.min(1),canceledAt:z.string().datetime({offset:true}),cancelReason:z.string().max(200)});
const status=z.enum(["READY","IN_PROGRESS","DONE","CANCELED","PARTIAL_CANCELED","WAITING_FOR_DEPOSIT","ABORTED","EXPIRED"]);
const payment=z.object({paymentKey:z.string().min(1).max(200),orderId:z.string().max(64),orderName:z.string().max(120),method:z.string().nullable(),totalAmount:won,balanceAmount:won,status,approvedAt:z.string().datetime({offset:true}).nullable(),requestedAt:z.string().datetime({offset:true}),cancels:z.array(cancel).nullable().optional(),card:z.object({issuerCode:z.string()}).nullable().optional()});
const settlement=z.object({paymentKey:z.string().min(1).max(200),transactionKey:z.string().min(1).max(64),method:z.string(),amount:z.number().int().safe(),supplyAmount:z.number().int().safe(),vat:z.number().int().safe(),payOutAmount:z.number().int().safe(),soldDate:date,paidOutDate:date,currency:z.literal("KRW")});
const kstDate=(s:string)=>new Date(s).toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"});
export function normalizePayment(value:unknown){
  const p=payment.parse(value);
  if(p.balanceAmount>p.totalAmount)throw new ApiError(502,"TOSS_INVALID_RESPONSE","결제 금액을 검증하지 못했습니다.");
  return {payment_key:p.paymentKey,order_id:p.orderId,order_name:p.orderName,method:p.method||"미기록",card_issuer:p.card?.issuerCode??null,amount:p.totalAmount,canceled_amount:p.totalAmount-p.balanceAmount,status:p.status,approved_at:p.approvedAt,paid_date:kstDate(p.approvedAt||p.requestedAt),cancels:(p.cancels||[]).map(c=>({transaction_key:c.transactionKey,cancel_amount:c.cancelAmount,canceled_at:c.canceledAt,cancel_date:kstDate(c.canceledAt),reason:c.cancelReason}))};
}
export function normalizeSettlement(value:unknown){
  const s=settlement.parse(value),fee=s.supplyAmount+s.vat;
  if(!Number.isSafeInteger(fee)||s.payOutAmount!==s.amount-fee)throw new ApiError(502,"TOSS_INVALID_RESPONSE","정산 금액과 수수료가 맞지 않습니다.");
  return {payment_key:s.paymentKey,transaction_key:s.transactionKey,method:s.method,amount:s.amount,fee,supply_fee:s.supplyAmount,vat_fee:s.vat,pay_out_amount:s.payOutAmount,sold_date:s.soldDate,paid_out_date:s.paidOutDate,is_cancel:s.amount<0};
}
export type TossPayment=ReturnType<typeof normalizePayment>;
export type TossSettlement=ReturnType<typeof normalizeSettlement>;
export const TOSS_KEYS={edu:"TOSS_SECRET_KEY_EDU",myin:"TOSS_SECRET_KEY_MYIN",hm:"TOSS_SECRET_KEY_HM"} as const;
const TOSS_MIDS={edu:"TOSS_MID_EDU",myin:"TOSS_MID_MYIN",hm:"TOSS_MID_HM"} as const;
const identifier=z.string().min(1).max(64);
const transaction=z.object({transactionKey:identifier,paymentKey:z.string().min(1).max(200),orderId:z.string().max(64),method:z.string().max(40),status,transactionAt:z.string().datetime({offset:true}),currency:z.literal("KRW"),amount:z.number().int().safe()});
export const TOSS_PAGE_SIZE=100;
function config(biz:keyof typeof TOSS_KEYS,env:NodeJS.ProcessEnv){
  const mode=env.FINANCE_TOSS_MODE||"mock",key=env[TOSS_KEYS[biz]],mid=env[TOSS_MIDS[biz]];
  if(!["test","live"].includes(mode)||!key||!mid)throw new ApiError(409,"TOSS_NOT_CONFIGURED","토스 상점의 서버 연결 설정이 필요합니다.");
  if(!new RegExp(`^${mode}_(?:gsk|sk)_[A-Za-z0-9]+$`).test(key))throw new ApiError(409,"TOSS_KEY_MODE_MISMATCH","토스 키와 실행 환경을 확인해 주세요.");
  if((mode==="live"&&env.VERCEL_ENV!=="production")||(mode==="test"&&env.VERCEL_ENV==="production"))throw new ApiError(409,"TOSS_ENVIRONMENT_BLOCKED","라이브 키는 운영 서버에서만 사용할 수 있습니다. 개발·미리보기에는 테스트 키를 사용해 주세요.");
  return {mode:mode as "test"|"live",key,mid};
}
/** Server-only binding: never return this or the merchant identifier to the browser. */
export function tossSyncIdentity(biz:keyof typeof TOSS_KEYS,env:NodeJS.ProcessEnv=process.env){
  const {mode,mid}=config(biz,env);
  return {mode,binding:createHash("sha256").update(JSON.stringify([biz,mode,mid])).digest("hex")};
}
/** Configuration only: this does not claim that upstream authentication succeeded. */
export function tossConnection(biz:keyof typeof TOSS_KEYS,env:NodeJS.ProcessEnv=process.env){
  try {const {mode}=config(biz,env);return {biz,mode,configured:true,verified:false,readOnly:true,message:"서버 설정 완료 · 실제 조회 확인 전"};}
  catch(error){if(error instanceof ApiError)return {biz,mode:null,configured:false,verified:false,readOnly:true,message:error.message};throw error;}
}
function range(from:string,to:string){
  date.parse(from);date.parse(to);
  const days=(Date.parse(to)-Date.parse(from))/86400000;
  if(days<0||days>30)throw new ApiError(400,"TOSS_DATE_RANGE","조회 기간은 시작일 이후 최대 31일로 설정해 주세요.");
}
function invalid():never {throw new ApiError(502,"TOSS_INVALID_RESPONSE","토스 조회 결과를 검증하지 못했습니다. 자료를 저장하지 않았습니다.");}
export function tossProvider(biz:keyof typeof TOSS_KEYS,env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch,signal?:AbortSignal){
  const {key,mid}=config(biz,env);
  const merchant=(value:unknown)=>{
    const result=z.object({mId:z.string().min(1).max(14)}).safeParse(value);
    if(!result.success)invalid();
    if(result.data.mId!==mid)throw new ApiError(502,"TOSS_MERCHANT_MISMATCH","연결된 상점이 선택한 사업부와 일치하지 않아 조회를 중단했습니다.");
  };
  const validated=<T>(read:()=>T):T=>{try{return read();}catch(error){if(error instanceof ApiError)throw error;return invalid();}};
  // Intentionally GET-only: no caller can choose a mutation method or upstream URL.
  const call=async(path:string):Promise<unknown>=>{
    try{
      const timeout=AbortSignal.timeout(65000);
      const response=await fetcher(`https://api.tosspayments.com/v1/${path}`,{method:"GET",headers:{Authorization:`Basic ${Buffer.from(key+":").toString("base64")}`,Accept:"application/json"},cache:"no-store",signal:signal?AbortSignal.any([signal,timeout]):timeout,redirect:"error"});
      if(!response.ok){
        await response.body?.cancel();
        if(response.status===429)throw new ApiError(429,"TOSS_RATE_LIMITED","토스 조회 요청이 많습니다. 잠시 후 다시 시도해 주세요.");
        if(response.status===401||response.status===403)throw new ApiError(502,"TOSS_AUTH_FAILED","토스 인증에 실패했습니다. 서버의 상점·키 설정을 확인해 주세요.");
        throw new ApiError(502,"TOSS_REQUEST_FAILED","토스 조회를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      const reader=response.body?.getReader();if(!reader)invalid();
      const chunks:Uint8Array[]=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000){await reader.cancel();invalid();}chunks.push(value);}
      return validated(()=>JSON.parse(Buffer.concat(chunks).toString("utf8")));
    }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(502,"TOSS_NETWORK_ERROR","토스 응답을 확인하지 못했습니다. 잠시 후 다시 조회해 주세요.");}
  };
  return {
    async payment(paymentKey:string){
      z.string().min(1).max(200).parse(paymentKey);
      const raw=await call(`payments/${encodeURIComponent(paymentKey)}`);merchant(raw);
      validated(()=>z.object({currency:z.literal("KRW")}).parse(raw));
      const row=validated(()=>normalizePayment(raw));
      if(row.payment_key!==paymentKey)invalid();
      return row;
    },
    async transactions(from:string,to:string,cursor?:string,pageSize=TOSS_PAGE_SIZE){
      range(from,to);if(cursor!==undefined)identifier.parse(cursor);z.number().int().min(1).max(TOSS_PAGE_SIZE).parse(pageSize);
      const q=new URLSearchParams({startDate:`${from}T00:00:00`,endDate:`${to}T23:59:59`,limit:String(pageSize)});if(cursor)q.set("startingAfter",cursor);
      const raw=await call(`transactions?${q}`);
      const rows=validated(()=>z.array(z.unknown()).max(pageSize).parse(raw).map(value=>{merchant(value);const t=transaction.parse(value);return {transaction_key:t.transactionKey,payment_key:t.paymentKey,order_id:t.orderId,method:t.method,status:t.status,transaction_at:t.transactionAt,amount:t.amount};}));
      if(rows.some(row=>row.transaction_key===cursor)||new Set(rows.map(row=>row.transaction_key)).size!==rows.length)invalid();
      return {rows,keys:[...new Set(rows.map(x=>x.payment_key))],next:rows.length===pageSize?rows.at(-1)!.transaction_key:null};
    },
    async settlements(from:string,to:string,page=1){
      range(from,to);z.number().int().min(1).max(10000).parse(page);
      const q=new URLSearchParams({startDate:from,endDate:to,dateType:"paidOutDate",page:String(page),size:String(TOSS_PAGE_SIZE)});
      const raw=await call(`settlements?${q}`);
      const rows=validated(()=>z.array(z.unknown()).max(TOSS_PAGE_SIZE).parse(raw).map(value=>{merchant(value);return normalizeSettlement(value);}));
      return {rows,next:rows.length===TOSS_PAGE_SIZE?page+1:null};
    },
    async cancel(){
      // Live cancellation wiring is intentionally absent until separate approval.
      throw new ApiError(409,"TOSS_CANCEL_DISABLED","실제 결제 취소 연결은 별도 승인 후 구현합니다.");
    },
  };
}
