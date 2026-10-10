import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError,apiErrorResponse,parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { assertHumanOwner,assertSameOrigin,getPersonalRecord,updatePersonalRecord } from "@/lib/server/content-automation-v07";
import { validatePersonalAsset,validatePersonalItem,validatePersonalTemplate } from "@/lib/server/content-automation-validators";
import { AUTOMATION_PROCS } from "@/lib/server/content-automation-v07";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Params={params:Promise<{resource:string;id:string}>};
const types={topics:"content_topic",items:"content_publish",jobs:"ai_job",skills:"skill",templates:"content_package",assets:"content_asset"} as const;
const patchSchema=z.object({
  expectedVersion:z.number().int().positive(),
  title:z.string().trim().min(1).max(240).optional(),
  description:z.string().max(20_000).optional(),
  status:z.string().max(40).optional(),
  stage:z.string().max(80).optional(),
  dueDate:z.string().date().nullable().optional(),
  brand:z.string().trim().max(120).optional(),
  metadata:z.record(z.unknown()).optional(),
}).strict();
export async function GET(request:Request,{params}:Params){
  try{
    const actor=await authenticateRequest(request),{resource,id}=await params;
    if(!(resource in types)||!z.string().uuid().safeParse(id).success)throw new ApiError(404,"AUTOMATION_NOT_FOUND","내 기록을 찾을 수 없습니다.");
    const record=await getPersonalRecord(actor,id,types[resource as keyof typeof types]);
    return NextResponse.json({record});
  }catch(error){return apiErrorResponse(error);}
}
export async function PATCH(request:Request,{params}:Params){
  try{
    assertSameOrigin(request);
    const actor=await authenticateRequest(request),{resource,id}=await params;
    if(!(resource in types)||!z.string().uuid().safeParse(id).success)throw new ApiError(404,"AUTOMATION_NOT_FOUND","내 기록을 찾을 수 없습니다.");
    if(resource==="jobs")throw new ApiError(405,"JOB_ACTION_REQUIRED","작업 상태는 작업 버튼에서 바꿔 주세요.");
    const input=patchSchema.parse(await parseJson(request,250_000));
    const current=await getPersonalRecord(actor,id,types[resource as keyof typeof types]);
    if(current.version!==input.expectedVersion)throw new ApiError(409,"AUTOMATION_CHANGED","최신 내용으로 다시 불러와 주세요.");
    if(resource==="items"&&["ready","scheduled","published","review"].includes(current.status))
      throw new ApiError(409,"PERSONAL_REVIEW_GATE","확인 중이거나 확인된 콘텐츠는 다시 고치기로 제작 상태로 돌린 뒤 수정해 주세요.");
    if(resource==="items"&&(input.status!==undefined||input.stage!==undefined))
      throw new ApiError(403,"PERSONAL_REVIEW_GATE","콘텐츠 상태는 전용 확인·발행 절차에서만 바꿀 수 있습니다.");
    if(resource==="items"&&input.metadata?.channel&&input.metadata.channel!==current.metadata.channel)
      throw new ApiError(422,"CHANNEL_IMMUTABLE","채널을 바꿀 수 없습니다.");
    const changes:Record<string,unknown>={};
    for(const key of ["title","description","status","stage","brand"] as const)if(input[key]!==undefined)changes[key]=input[key];
    if(input.dueDate!==undefined)changes.due_date=input.dueDate;
    if(input.metadata){
      const metadata:Record<string,unknown>={...current.metadata,...input.metadata,space:"personal",
        ...(resource==="items"?{channel:current.metadata.channel}:{}),
        ...(resource==="templates"?{packageKind:"cardnews_template_v2"}:{})};
      if(resource==="items")validatePersonalItem(metadata,String(current.metadata.channel),assertHumanOwner(actor));
      if(resource==="assets"){
        if(metadata.storagePath!==current.metadata.storagePath)
          throw new ApiError(422,"ASSET_FILE_IMMUTABLE","이미지 파일은 바꿀 수 없습니다. 새 이미지를 올려 주세요.");
        validatePersonalAsset(metadata,assertHumanOwner(actor));
      }
      if(resource==="templates")validatePersonalTemplate(metadata,assertHumanOwner(actor));
      if(resource==="skills"){
        metadata.process=current.metadata.process;
        metadata.active=current.metadata.active;
        if(!AUTOMATION_PROCS.includes(metadata.process as typeof AUTOMATION_PROCS[number])
          ||typeof metadata.slug!=="string"||!/^([a-z0-9]+)(-[a-z0-9]+)*$/.test(metadata.slug))
          throw new ApiError(422,"SKILL_FIELDS_INVALID","공정과 영문 소문자 스킬 이름을 확인해 주세요.");
      }
      changes.metadata=metadata;
    }
    const record=await updatePersonalRecord(actor,current,changes);
    return NextResponse.json({record});
  }catch(error){
    if(error instanceof ZodError)return apiErrorResponse(new ApiError(422,"AUTOMATION_INPUT_INVALID","입력값을 확인해 주세요.",error.flatten()));
    return apiErrorResponse(error);
  }
}
