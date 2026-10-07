import { z } from "zod";
import { ApiError } from "@/lib/http";
import { refundRequestSchema } from "@/lib/finance/schema";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { financeDbError } from "./finance";

/** Approvals persist, but money movement stays off until a separately approved rollout. */
export async function refundCommand(actor:RequestActor,command:string,input:unknown){
  if(!["request","approve","retry","reject"].includes(command))throw new ApiError(404,"FINANCE_NOT_FOUND","지원하지 않는 환불 작업입니다.");
  const request=command==="request"?refundRequestSchema.parse(input):null;
  const decision=request?null:z.object({id:z.string().uuid(),version:z.number().int().positive()}).strict().parse(input);
  const executes=command==="approve"||command==="retry";
  // Mock mode must be opted into on a DEV server. Never turn a live request into a fake success.
  if(executes&&process.env.FINANCE_REFUND_MODE!=="mock")throw new ApiError(409,"FINANCE_REFUND_DISABLED","실제 결제 취소는 아직 활성화되지 않았습니다. 환불 요청·반려만 저장할 수 있습니다.");
  if(executes&&(process.env.VERCEL_ENV==="production"||process.env.OS_ENVIRONMENT==="production"))throw new ApiError(409,"FINANCE_REFUND_DISABLED","운영 환경에서는 모의 환불을 실행할 수 없습니다.");
  const service=executes?createServiceSupabase():null;
  const {data,error}=await actor.supabase.rpc("os_fin_refund_command",{
    p_command:command,p_id:decision?.id??null,p_version:decision?.version??0,
    p_payment:request?.payment_id??null,p_amount:request?.amount??null,p_reason:request?.reason??null,
  });
  if(error)financeDbError(error);
  if(!executes)return {row:data};
  const {data:row,error:doneError}=await service!.rpc("os_fin_refund_finish_mock",{p_id:data.id,p_version:data.version});
  if(doneError)financeDbError(doneError);
  return {row,mock:true,message:"개발 환경의 모의 승인입니다. 실제 결제는 취소되지 않았습니다."};
}
