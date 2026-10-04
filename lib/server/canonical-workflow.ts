import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";
import { canonicalExtractionPrompt, validateCanonicalRules, type CanonicalRun } from "@/lib/canonical-workflow";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { KnowledgeDocument } from "@/lib/types";
import type { RequestActor } from "./auth";
import { canReadKnowledgeDocument } from "./document-access";
import { readableKnowledgePages } from "./knowledge-page-access";
import { claude } from "./content-generation";

export const canonicalHash = (value:string)=>createHash("sha256").update(value).digest("hex");
export function canonicalDbError(error: {code?:string;message?:string}|null) {
  if (["42P01","42883","PGRST205","PGRST202"].includes(error?.code??"")) return new ApiError(503,"CANON_SETUP_PENDING","정본 작업 저장소의 DEV 적용 승인이 필요합니다. 기존 원문은 그대로 유지됩니다.");
  if (error?.message?.includes("CANON_SOURCE_CHANGED")) return new ApiError(409,"CANON_SOURCE_CHANGED","원문 버전이 바뀌었습니다. 최신 원문으로 다시 작업해 주세요.");
  return new ApiError(409,"CANON_SAVE_FAILED","작업 상태가 바뀌었거나 저장하지 못했습니다. 새로고침 후 확인해 주세요.");
}
export async function canonicalDocument(actor:RequestActor,id:string,version?:number) {
  const {data,error}=await actor.supabase.from("os_documents").select("*").eq("id",id).maybeSingle();
  if(error||!data||data.status!=="canonical"||!canReadKnowledgeDocument(actor,data)||!(await readableKnowledgePages(actor,[data])).has(id)) throw new ApiError(404,"CANON_NOT_FOUND","현재 읽을 수 있는 회사 정본을 선택해 주세요.");
  if(version!==undefined&&data.current_version!==version)throw new ApiError(409,"CANON_SOURCE_CHANGED","원문 버전이 바뀌었습니다. 최신 원문으로 다시 작업해 주세요.");
  return data as KnowledgeDocument;
}
export function publicCanonicalRun(run:CanonicalRun) {
  // Provider output, fingerprints and caller identity never leave this API.
  return Object.fromEntries(["id","document_id","kind","mode","status","source_version","result","error_code","model","created_at"].map(key=>[key,run[key as keyof CanonicalRun]])) as unknown as CanonicalRun;
}
export async function beginCanonicalRun(actor:RequestActor,document:KnowledgeDocument,kind:"sync"|"rules",mode:"queue"|"api",key:string) {
  const service=createServiceSupabase();
  const row={document_id:document.id,requested_by:actor.ownerId,kind,mode,status:kind==="rules"&&mode==="queue"?"queued":"running",source_version:document.current_version,source_hash:canonicalHash(document.content_md),request_key:key};
  const {data,error}=await service.from("os_canonical_runs").insert(row).select("*").single();
  if(error?.code==="23505"){
    const previous=await service.from("os_canonical_runs").select("*").eq("document_id",document.id).eq("requested_by",actor.ownerId).eq("kind",kind).eq("request_key",key).single();
    if(previous.error)throw canonicalDbError(previous.error);
    if(kind==="sync"&&previous.data.status==="failed"){
      const retry=await service.from("os_canonical_runs").update({status:"running",error_code:null,updated_at:new Date().toISOString()}).eq("id",previous.data.id).eq("status","failed").select("*").maybeSingle();
      if(retry.error)throw canonicalDbError(retry.error);
      if(retry.data)return {run:retry.data as CanonicalRun,fresh:true};
    }
    return {run:previous.data as CanonicalRun,fresh:false};
  }
  if(error||!data)throw canonicalDbError(error);
  return {run:data as CanonicalRun,fresh:true};
}
export async function failCanonicalRun(id:string,error:unknown) {
  const code=error instanceof ApiError?error.code:"CANON_PROCESS_FAILED";
  const {error:saveError}=await createServiceSupabase().from("os_canonical_runs").update({status:"failed",error_code:code,updated_at:new Date().toISOString()}).eq("id",id).eq("status","running");
  if(saveError)throw canonicalDbError(saveError);
}
export async function finishCanonicalRules(actor:RequestActor,run:CanonicalRun,raw:string,model:string,usage:Record<string,unknown>) {
  const service=createServiceSupabase();
  // Persist the paid/non-repeatable provider output before validating it. A
  // validation failure leaves recoverable output server-side, never a fake pass.
  const receipt=await service.from("os_canonical_runs").update({raw_output:raw,model,usage,updated_at:new Date().toISOString()}).eq("id",run.id).eq("status","running").select("id").maybeSingle();
  if(receipt.error||!receipt.data)throw canonicalDbError(receipt.error);
  const document=await canonicalDocument(actor,run.document_id,run.source_version);
  let result;
  try { result=validateCanonicalRules(JSON.parse(raw),document.content_md); }
  catch { throw new ApiError(422,"CANON_RULES_INVALID","추출 결과가 원문 인용·줄 번호 검증을 통과하지 못했습니다. 규칙을 저장하지 않았습니다."); }
  const completed=await service.from("os_canonical_runs").update({result,status:"done",updated_at:new Date().toISOString()}).eq("id",run.id).eq("status","running").select("*").maybeSingle();
  if(completed.error||!completed.data)throw canonicalDbError(completed.error);
  return completed.data as CanonicalRun;
}

const text={type:"string"};
const outputSchema={type:"object",additionalProperties:false,properties:{rules:{type:"array",items:{type:"object",additionalProperties:false,properties:{text,kind:{type:"string",enum:["required","forbidden","quality"]},channels:{type:"array",items:{type:"string",enum:["all","youtube","instagram","threads"]}},quote:text,lineStart:{type:"integer"},lineEnd:{type:"integer"}},required:["text","kind","channels","quote","lineStart","lineEnd"]}}},required:["rules"]};
export async function extractCanonicalRules(actor:RequestActor,document:KnowledgeDocument,mode:"queue"|"api",retryRunId?:string) {
  if(document.content_md.length>60_000)throw new ApiError(413,"CANON_EXTRACTION_TOO_LARGE","규칙 추출은 60,000자 이하 정본을 지원합니다. 문서를 절차별로 나눠 주세요.");
  if(retryRunId){
    const previous=await createServiceSupabase().from("os_canonical_runs").select("*").eq("id",retryRunId).eq("requested_by",actor.ownerId).eq("document_id",document.id).eq("kind","rules").maybeSingle();
    if(previous.error)throw canonicalDbError(previous.error);
    if(!previous.data||previous.data.status!=="failed")throw new ApiError(409,"CANON_RETRY_DENIED","실패한 내 작업만 다시 요청할 수 있습니다.");
  }
  const {run,fresh}=await beginCanonicalRun(actor,document,"rules",mode,`${document.current_version}:${canonicalHash(document.content_md)}:${mode}${retryRunId?`:retry:${retryRunId}`:""}`);
  if(!fresh||mode==="queue")return run;
  try {
    const generated=await claude(canonicalExtractionPrompt(document.content_md),process.env.CLAUDE_HAIKU_MODEL||"claude-haiku-4-5-20251001",outputSchema,8000);
    return await finishCanonicalRules(actor,run,generated.text,generated.model,generated.usage as Record<string,unknown>);
  } catch(error) { await failCanonicalRun(run.id,error); throw error; }
}
