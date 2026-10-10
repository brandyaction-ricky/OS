import { NextResponse } from "next/server";
import { z,ZodError } from "zod";
import { ApiError,apiErrorResponse,parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/content-automation-v07";
import { workerFinish } from "@/lib/server/content-automation-worker";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const actor=await authenticateRequest(request);
    const input=z.object({runId:z.string().uuid()}).strict().parse(await parseJson(request,2000));
    return NextResponse.json({run:await workerFinish(actor,request,input.runId)});
  }catch(error){
    if(error instanceof ZodError)return apiErrorResponse(new ApiError(422,"WORKER_INPUT_INVALID","실행 번호를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
