import { NextResponse } from "next/server";
import { z,ZodError } from "zod";
import { ApiError,apiErrorResponse,parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { assertSameOrigin,makeBrowserCookie,registerBrowser } from "@/lib/server/content-automation-v07";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const actor=await authenticateRequest(request);
    const input=z.object({name:z.string().trim().min(1).max(120)}).strict().parse(await parseJson(request,2000));
    const {browser,key}=await registerBrowser(actor,input.name,request.headers.get("user-agent")??"",request);
    return NextResponse.json({browser},{status:201,headers:{"Set-Cookie":makeBrowserCookie(key),"Cache-Control":"private, no-store"}});
  }catch(error){
    if(error instanceof ZodError)return apiErrorResponse(new ApiError(422,"BROWSER_NAME_INVALID","컴퓨터 이름을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
