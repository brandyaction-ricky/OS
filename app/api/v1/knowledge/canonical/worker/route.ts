import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest, requireAgentScope } from "@/lib/server/auth";
import { canonicalExtractionPrompt, canonicalRulesSchema } from "@/lib/canonical-workflow";
import { createServiceSupabase } from "@/lib/supabase/server";
import { canonicalDbError, canonicalDocument, failCanonicalRun, finishCanonicalRules, publicCanonicalRun } from "@/lib/server/canonical-workflow";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("claim"),runId:z.string().uuid()}),
  z.object({action:z.literal("complete"),runId:z.string().uuid(),result:canonicalRulesSchema,model:z.string().trim().min(1).max(100)}),
  z.object({action:z.literal("fail"),runId:z.string().uuid()}),
]);
const failure=(error:unknown)=>apiErrorResponse(error instanceof ZodError?new ApiError(400,"CANON_WORKER_INPUT","작업 입력을 확인해 주세요."):error instanceof ApiError?error:new ApiError(500,"CANON_WORKER_FAILED","추출 작업을 처리하지 못했습니다."));
async function worker(request:Request){
  const actor=await authenticateRequest(request,{allowAgent:true,requiredAgentScope:"records.write"});
  if(actor.type!=="agent")throw new ApiError(403,"CANON_WORKER_AGENT_REQUIRED","구독 워커 전용 접근 키가 필요합니다.");
  requireAgentScope(actor,"knowledge.read");return actor;
}
export async function GET(request:Request){
  try{
    const actor=await worker(request);const service=createServiceSupabase();
    const after=z.string().uuid().nullable().parse(new URL(request.url).searchParams.get("after"));
    let query=service.from("os_canonical_runs").select("*").eq("requested_by",actor.ownerId).eq("kind","rules").eq("mode","queue").eq("status","queued");
    if(after){
      const cursor=await service.from("os_canonical_runs").select("id,created_at").eq("id",after).eq("requested_by",actor.ownerId).eq("kind","rules").eq("mode","queue").maybeSingle();
      if(cursor.error)throw canonicalDbError(cursor.error);
      if(!cursor.data)throw new ApiError(400,"CANON_CURSOR_INVALID","내 작업의 다음 페이지 위치를 확인해 주세요.");
      query=query.or(`created_at.gt.${cursor.data.created_at},and(created_at.eq.${cursor.data.created_at},id.gt.${cursor.data.id})`);
    }
    const {data,error}=await query.order("created_at").order("id").limit(30);
    if(error)throw canonicalDbError(error);
    const runs=[];
    for(const run of data??[]){try{await canonicalDocument(actor,run.document_id,run.source_version);runs.push(publicCanonicalRun(run));}catch(error){if(!(error instanceof ApiError)||![404,409].includes(error.status))throw error;}}
    // Advance over stale/inaccessible jobs too, so they cannot hide later work.
    return NextResponse.json({runs,nextAfter:data?.length===30?data[29].id:null});
  }catch(error){return failure(error);}
}
export async function POST(request:Request){
  try{
    const actor=await worker(request);const input=schema.parse(await parseJson(request,100_000));const service=createServiceSupabase();
    const {data:run,error}=await service.from("os_canonical_runs").select("*").eq("id",input.runId).eq("requested_by",actor.ownerId).eq("kind","rules").eq("mode","queue").maybeSingle();
    if(error)throw canonicalDbError(error);if(!run)throw new ApiError(404,"CANON_RUN_NOT_FOUND","추출 작업을 찾을 수 없습니다.");
    const document=await canonicalDocument(actor,run.document_id,input.action==="fail"?undefined:run.source_version);
    if(input.action==="claim"){
      const claimed=await service.from("os_canonical_runs").update({status:"running",updated_at:new Date().toISOString()}).eq("id",run.id).eq("status","queued").select("*").maybeSingle();
      if(claimed.error||!claimed.data)throw new ApiError(409,"CANON_RUN_CLAIMED","다른 워커가 먼저 작업을 시작했습니다.");
      return NextResponse.json({run:publicCanonicalRun(claimed.data),prompt:canonicalExtractionPrompt(document.content_md)});
    }
    if(run.status==="done")return NextResponse.json({run:publicCanonicalRun(run)});
    if(run.status!=="running")throw new ApiError(409,"CANON_RUN_STATE","먼저 대기 작업을 선점해 주세요.");
    if(input.action==="fail"){await failCanonicalRun(run.id,new ApiError(422,"CANON_WORKER_FAILED","구독 워커 실패"));return NextResponse.json({failed:true});}
    try{return NextResponse.json({run:publicCanonicalRun(await finishCanonicalRules(actor,run,JSON.stringify(input.result),input.model,{billing:"subscription"}))});}
    catch(error){await failCanonicalRun(run.id,error);throw error;}
  }catch(error){return failure(error);}
}
