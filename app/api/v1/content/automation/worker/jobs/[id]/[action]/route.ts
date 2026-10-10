import { NextResponse } from "next/server";
import { z,ZodError } from "zod";
import { ApiError,apiErrorResponse,parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/content-automation-v07";
import { workerCompleteJob } from "@/lib/server/content-automation-worker";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Params={params:Promise<{id:string;action:string}>};
export async function POST(request:Request,{params}:Params){
  try{
    assertSameOrigin(request);
    const actor=await authenticateRequest(request),{id,action}=await params;
    if(!z.string().uuid().safeParse(id).success||!["result","fail"].includes(action))
      throw new ApiError(404,"WORKER_JOB_NOT_FOUND","작업을 찾을 수 없습니다.");
    const raw=await parseJson(request,150_000);
    const input=z.object({runId:z.string().uuid(),result:z.unknown().optional(),reason:z.string().trim().max(3000).optional()}).strict().parse(raw);
    const job=await workerCompleteJob(actor,request,{runId:input.runId,jobId:id,
      result:input.result,reason:input.reason,failed:action==="fail"});
    return NextResponse.json({job});
  }catch(error){
    if(error instanceof ZodError)return apiErrorResponse(new ApiError(422,"WORKER_INPUT_INVALID","작업 결과를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
