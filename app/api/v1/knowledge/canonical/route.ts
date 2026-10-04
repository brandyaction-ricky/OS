import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { canonicalSourceUrl, fetchCanonicalSource } from "@/lib/server/canonical-source-fetch";
import { beginCanonicalRun, canonicalDbError, canonicalDocument, canonicalHash, extractCanonicalRules, failCanonicalRun, publicCanonicalRun } from "@/lib/server/canonical-workflow";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=120;
const base={documentId:z.string().uuid(),expectedVersion:z.number().int().positive()};
const schema=z.discriminatedUnion("action",[
  z.object({...base,action:z.literal("source"),url:z.string().max(2000),enabled:z.boolean(),expectedRevision:z.number().int().nonnegative()}),
  z.object({...base,action:z.literal("sync"),content:z.string().min(1).max(500_000).refine(value=>Boolean(value.trim())).optional()}),
  z.object({...base,action:z.literal("extract"),mode:z.enum(["queue","api"]).default("queue"),retryRunId:z.string().uuid().optional()}),
  z.object({...base,action:z.literal("adopt"),runId:z.string().uuid(),index:z.number().int().min(0).max(29)}),
  z.object({...base,action:z.literal("cancel"),runId:z.string().uuid()}),
]);
function safeError(error:unknown){return apiErrorResponse(error instanceof ZodError?new ApiError(400,"CANON_INPUT_INVALID","정본 작업 입력을 확인해 주세요."):error instanceof ApiError?error:new ApiError(500,"CANON_PROCESS_FAILED","정본 작업을 처리하지 못했습니다. 원문은 변경하지 않았습니다."));}

export async function GET(request:Request){
  try{
    const actor=await authenticateRequest(request);const id=z.string().uuid().parse(new URL(request.url).searchParams.get("documentId"));
    await canonicalDocument(actor,id);
    const service=createServiceSupabase();
    const [source,runs]=await Promise.all([
      service.from("os_canonical_sources").select("document_id,url,enabled,revision,checked_at,last_status,updated_at").eq("document_id",id).maybeSingle(),
      service.from("os_canonical_runs").select("*").eq("document_id",id).eq("requested_by",actor.id).order("created_at",{ascending:false}).limit(30),
    ]);
    if(source.error||runs.error)throw canonicalDbError(source.error||runs.error);
    return NextResponse.json({source:source.data,runs:(runs.data??[]).map(publicCanonicalRun),canConfigure:actor.role==="admin",apiConfigured:Boolean(process.env.ANTHROPIC_API_KEY||process.env.CLAUDE_API_KEY),autoSyncConfigured:process.env.CANONICAL_SYNC_ENABLED==="true",allowedHosts:(process.env.CANONICAL_SOURCE_HOSTS??"").split(",").map(s=>s.trim()).filter(Boolean)});
  }catch(error){return safeError(error);}
}

export async function POST(request:Request){
  try{
    const actor=await authenticateRequest(request);const input=schema.parse(await parseJson(request,600_000));
    const document=await canonicalDocument(actor,input.documentId,input.expectedVersion);const service=createServiceSupabase();
    if(input.action==="source"){
      if(actor.role!=="admin")throw new ApiError(403,"ADMIN_REQUIRED","외부 원문 연결은 관리자가 설정합니다.");
      const url=canonicalSourceUrl(input.url).href;
      const payload={url,enabled:input.enabled,owner_id:actor.id,revision:input.expectedRevision+1,last_status:"not_checked",checked_at:null,updated_at:new Date().toISOString()};
      const result=input.expectedRevision===0?await service.from("os_canonical_sources").insert({...payload,document_id:document.id}).select("document_id").single():await service.from("os_canonical_sources").update(payload).eq("document_id",document.id).eq("revision",input.expectedRevision).select("document_id").maybeSingle();
      if(result.error||!result.data)throw canonicalDbError(result.error);
      return NextResponse.json({saved:true});
    }
    if(input.action==="extract")return NextResponse.json({run:publicCanonicalRun(await extractCanonicalRules(actor,document,input.mode,input.retryRunId))},{status:202});
    if(input.action==="cancel"){
      const run=await service.from("os_canonical_runs").select("id,status,updated_at").eq("id",input.runId).eq("document_id",document.id).eq("requested_by",actor.id).eq("kind","rules").maybeSingle();
      if(run.error)throw canonicalDbError(run.error);
      if(!run.data||!(run.data.status==="queued"||run.data.status==="running"&&Date.parse(run.data.updated_at)<Date.now()-600_000))throw new ApiError(409,"CANON_CANCEL_DENIED","대기 중이거나 10분 이상 응답 없는 내 작업만 중단할 수 있습니다.");
      const cancelled=await service.from("os_canonical_runs").update({status:"failed",error_code:"CANON_CANCELLED",updated_at:new Date().toISOString()}).eq("id",input.runId).eq("status",run.data.status).eq("updated_at",run.data.updated_at).select("id").maybeSingle();
      if(cancelled.error||!cancelled.data)throw canonicalDbError(cancelled.error);
      return NextResponse.json({cancelled:true});
    }
    if(input.action==="adopt"){
      const {data:run,error}=await service.from("os_canonical_runs").select("document_id,requested_by").eq("id",input.runId).maybeSingle();
      if(error)throw canonicalDbError(error);
      if(!run||run.document_id!==document.id||run.requested_by!==actor.id)throw new ApiError(404,"CANON_RUN_NOT_FOUND","추출 작업을 찾을 수 없습니다.");
      const saved=await service.rpc("os_adopt_canonical_rule",{p_run:input.runId,p_index:input.index,p_actor:actor.id});
      if(saved.error)throw canonicalDbError(saved.error);
      return NextResponse.json({skillId:saved.data});
    }
    let content=input.content;
    let sourceRevision:number|undefined;
    if(content===undefined){
      if(actor.role!=="admin")throw new ApiError(403,"ADMIN_REQUIRED","외부 주소 동기화는 관리자가 실행합니다.");
      const {data:source,error}=await service.from("os_canonical_sources").select("url,revision").eq("document_id",document.id).maybeSingle();
      if(error)throw canonicalDbError(error);
      if(!source)throw new ApiError(409,"CANON_SOURCE_REQUIRED","외부 원문 주소를 먼저 연결해 주세요.");
      sourceRevision=source.revision;content=await fetchCanonicalSource(source.url);
    }
    const {run,fresh}=await beginCanonicalRun(actor,document,"sync","api",`${document.current_version}:${canonicalHash(content)}`);
    if(!fresh)return NextResponse.json({run:publicCanonicalRun(run)});
    try{
      const result=await service.rpc("os_finish_canonical_sync",{p_run:run.id,p_content:content});
      if(result.error)throw canonicalDbError(result.error);
      if(sourceRevision!==undefined)await service.from("os_canonical_sources").update({checked_at:new Date().toISOString(),last_status:result.data.result.unchanged?"unchanged":"proposed"}).eq("document_id",document.id).eq("revision",sourceRevision);
      return NextResponse.json({run:publicCanonicalRun(result.data)});
    }catch(error){await failCanonicalRun(run.id,error);throw error;}
  }catch(error){return safeError(error);}
}
