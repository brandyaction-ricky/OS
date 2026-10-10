import { NextResponse } from "next/server";
import { ApiError,apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { browserCookieKey,makeBrowserCookie } from "@/lib/server/content-automation-v07";
import { workerState } from "@/lib/server/content-automation-worker";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  try{
    const actor=await authenticateRequest(request);
    const viaRaw=new URL(request.url).searchParams.get("via");
    if(viaRaw&&viaRaw!=="sched"&&viaRaw!=="now")throw new ApiError(400,"INVALID_WORKER_VIA","실행 방법을 확인해 주세요.");
    const via=viaRaw==="sched"||viaRaw==="now"?viaRaw:null;
    const state=await workerState(actor,request,via);
    return NextResponse.json(state,{headers:{"Set-Cookie":makeBrowserCookie(browserCookieKey(request)),"Cache-Control":"private, no-store"}});
  }catch(error){return apiErrorResponse(error);}
}
