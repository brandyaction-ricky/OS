import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { financeActor } from "./finance";
import { date } from "@/lib/finance/schema";
import { tossConnection, tossProvider } from "@/lib/finance/toss/provider";

const business=z.enum(["edu","myin","hm"]).default("edu");
const range={biz:business,from:date,to:date};
export async function readToss(request:Request,action:string){
  // Recheck the active profile for every page, including configuration status.
  await financeActor(request);
  if(request.method!=="GET")throw new ApiError(405,"TOSS_READ_ONLY","토스 연결은 조회만 지원합니다.");
  const query=Object.fromEntries(new URL(request.url).searchParams);
  if(action==="status"){
    const {biz}=z.object({biz:business}).strict().parse(query);
    return tossConnection(biz);
  }
  if(action==="transactions"){
    const {biz,from,to,cursor}=z.object({...range,cursor:z.string().min(1).max(64).optional()}).strict().parse(query);
    const result=await tossProvider(biz).transactions(from,to,cursor);
    return {biz,kind:action,from,to,readOnly:true,persisted:false,...result};
  }
  if(action==="settlements"){
    const {biz,from,to,page}=z.object({...range,page:z.coerce.number().int().min(1).max(10000).default(1)}).strict().parse(query);
    const result=await tossProvider(biz).settlements(from,to,page);
    return {biz,kind:action,from,to,readOnly:true,persisted:false,...result};
  }
  if(action==="payment"){
    const {biz,paymentKey}=z.object({biz:business,paymentKey:z.string().min(1).max(200)}).strict().parse(query);
    const row=await tossProvider(biz).payment(paymentKey);
    return {biz,kind:action,readOnly:true,persisted:false,row};
  }
  throw new ApiError(404,"TOSS_NOT_FOUND","지원하지 않는 토스 조회입니다.");
}
