import { NextResponse } from "next/server";
import { z,ZodError } from "zod";
import { ApiError,apiErrorResponse,parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/content-automation-v07";
import { enqueueShortformRender,shortformRenderStatus } from "@/lib/server/shortform-render";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
const schema=z.object({itemId:z.string().uuid(),version:z.number().int().positive(),confirmVoiceCost:z.boolean().default(false)}).strict();
export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const actor=await authenticateRequest(request);
    if(!canUseYoutubeAutomationPilot(process.env))throw new ApiError(404,"AUTOMATION_PILOT_DISABLED","영상 제작 연결을 준비 중입니다.");
    const input=schema.parse(await parseJson(request,2000));
    return NextResponse.json(await enqueueShortformRender(actor,input.itemId,input.version,input.confirmVoiceCost),{headers:{"cache-control":"no-store"}});
  }catch(error){return apiErrorResponse(error instanceof ZodError?new ApiError(422,"SHORTFORM_REQUEST_INVALID","제작 요청을 확인해 주세요."):error);}
}
export async function GET(request:Request){
  try{
    const actor=await authenticateRequest(request),id=z.string().uuid().parse(new URL(request.url).searchParams.get("itemId"));
    return NextResponse.json(await shortformRenderStatus(actor,id),{headers:{"cache-control":"no-store"}});
  }catch(error){return apiErrorResponse(error instanceof ZodError?new ApiError(422,"SHORTFORM_REQUEST_INVALID","콘텐츠를 선택해 주세요."):error);}
}
