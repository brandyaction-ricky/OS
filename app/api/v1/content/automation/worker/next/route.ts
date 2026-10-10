import { NextResponse } from "next/server";
import { z,ZodError } from "zod";
import { ApiError,apiErrorResponse,parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { assertSameOrigin,browserCookieKey,makeBrowserCookie } from "@/lib/server/content-automation-v07";
import { workerNext } from "@/lib/server/content-automation-worker";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const actor=await authenticateRequest(request);
    const input=z.object({via:z.enum(["sched","now"]),runId:z.string().uuid().optional()}).strict().parse(await parseJson(request,2000));
    const result=await workerNext(actor,request,input);
    return NextResponse.json(result,{headers:{"Set-Cookie":makeBrowserCookie(browserCookieKey(request)),"Cache-Control":"private, no-store"}});
  }catch(error){
    if(error instanceof ZodError)return apiErrorResponse(new ApiError(422,"WORKER_INPUT_INVALID","작업 요청을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
