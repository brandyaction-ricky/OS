import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "@/lib/http";
import { executePublication, publicationProblems, publicationSettingsSchema, PublicationError, type PublicationSettings, type PublishCheckpoint } from "@/lib/channel-publishing";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { authorizeMetaConnection, assertMetaModeMatches, metaMode } from "./meta-oauth";
import { metaPublishProvider } from "./meta-publishing";

export function publicationSignature(record: Pick<OsRecord,"title"|"description"|"parent_id">, settings: PublicationSettings, sourceVersion: number) {
  return createHash("sha256").update(JSON.stringify([record.title, record.description, record.parent_id, settings, sourceVersion])).digest("hex");
}
export async function readPublication(actor: RequestActor, id: string) {
  const { data, error } = await actor.supabase.from("os_records").select("*").eq("id",id).eq("record_type","content_publish").is("archived_at",null).maybeSingle();
  if(error)throw new ApiError(500,"PUBLICATION_READ_FAILED","게시물을 읽지 못했습니다.");
  if(!data)throw new ApiError(404,"PUBLICATION_NOT_FOUND","게시물이 없습니다.");
  return data as OsRecord;
}
export async function savePublication(actor: RequestActor, current: OsRecord, changes: Partial<OsRecord>) {
  const {data,error}=await actor.supabase.from("os_records").update({...changes,updated_by:actor.id}).eq("id",current.id).eq("version",current.version).is("archived_at",null).select("*").maybeSingle();
  if(error||!data)throw new ApiError(409,"PUBLICATION_CHANGED","다른 작업이 게시물을 변경했습니다. 새로 불러와 주세요.");
  return data as OsRecord;
}
export async function publicationSourceVersion(actor: RequestActor, record: OsRecord) {
  if(!record.parent_id)throw new ApiError(409,"PUBLICATION_SOURCE_REQUIRED","기준 영상을 연결해 주세요.");
  const {data,error}=await actor.supabase.from("os_records").select("version").eq("id",record.parent_id).eq("record_type","content_topic").is("archived_at",null).maybeSingle();
  if(error||!data)throw new ApiError(409,"PUBLICATION_SOURCE_REQUIRED","기준 영상을 확인하지 못했습니다.");
  return Number(data.version);
}
export function assertPublicationApproval(record: OsRecord, settings: PublicationSettings, sourceVersion: number) {
  const approval=record.metadata.publicationApproval as {signature?:string;actorId?:string}|undefined;
  if(record.metadata.channelWorkflowVersion!==1 || record.metadata.needsRecheck!==false || !approval?.actorId || approval.signature!==publicationSignature(record,settings,sourceVersion)) throw new ApiError(409,"PUBLICATION_APPROVAL_REQUIRED","현재 문안·계정·기준 영상으로 최종 승인을 다시 받아 주세요.");
}
export function validatePublicationSettings(settings: PublicationSettings) {
  const problems=publicationProblems(settings);
  if(problems.length)throw new ApiError(400,"PUBLICATION_INVALID",problems.join(" "));
}
export async function signPublicationMedia(record: OsRecord, settings: PublicationSettings, live: boolean) {
  const urls:string[]=[];
  for(const media of settings.media){
    const pathPattern = /^production\/[0-9a-f-]{36}\/([0-9a-f-]{36})\/(visuals|roughCut)\/[0-9]{13}-[0-9a-f-]{36}\.(png|jpg|mp4)$/;
    const match=media.path.match(pathPattern);
    if(!match || match[1]!==record.parent_id)throw new ApiError(400,"PUBLICATION_MEDIA_PATH","이 영상의 비공개 제작 파일만 게시할 수 있습니다.");
    if(!live)continue;
    const store=createServiceSupabase().storage.from("os-content-media");
    const {data:files,error:readError}=await store.list(media.path.slice(0,media.path.lastIndexOf("/")),{search:media.path.slice(media.path.lastIndexOf("/")+1),limit:2});
    const file=files?.find(item=>item.name===media.path.slice(media.path.lastIndexOf("/")+1));
    if(readError||!file||Number(file.metadata?.size)!==media.size||file.metadata?.mimetype!==media.mimeType)throw new ApiError(409,"PUBLICATION_MEDIA_CHANGED","저장된 파일의 형식·용량을 확인하지 못했습니다. 다시 첨부해 주세요.");
    const {data,error}=await store.createSignedUrl(media.path,900);
    if(error||!data)throw new ApiError(409,"PUBLICATION_MEDIA_MISSING","게시 파일을 읽지 못했습니다.");
    urls.push(data.signedUrl);
  }
  return urls;
}

export async function publishChannelRecord(actor: RequestActor, record: OsRecord) {
  const settings=publicationSettingsSchema.parse(record.metadata);
  const connection=await authorizeMetaConnection(actor,settings.account.ownerId,settings.account.platform);
  assertMetaModeMatches(connection);
  // This release is explicitly mock-only. Live publishing needs a separately
  // reviewed database-enforced approval/checkpoint boundary and one-post QA.
  // Keep actor RLS writes; never elevate record updates to the service role.
  if(metaMode()!=="mock")throw new ApiError(503,"LIVE_PUBLISH_NOT_RELEASED","실계정 게시는 아직 공개하지 않았습니다. 권한 검증과 실계정 1건 검수 후 별도로 활성화합니다.");
  if(record.status==="published")return record;
  validatePublicationSettings(settings);
  assertPublicationApproval(record,settings,await publicationSourceVersion(actor,record));
  if(settings.publishMode==="manual")throw new ApiError(409,"MANUAL_PUBLICATION_REQUIRED","앱에서 직접 게시한 뒤 주소를 입력해 주세요.");
  if((record.metadata.publishOperation as {state?:string}|undefined)?.state==="running")throw new ApiError(409,"PUBLICATION_BUSY","게시 결과를 처리 중입니다. 중복 요청은 실행하지 않습니다.");
  const urls=await signPublicationMedia(record,settings,metaMode()==="live");
  const operationId=randomUUID();
  let current=await savePublication(actor,record,{metadata:{...record.metadata,publishOperation:{id:operationId,state:"running",at:new Date().toISOString(),actorId:actor.id},publishError:null}});
  try {
    const initial=(current.metadata.publishCheckpoint??{receipts:[]}) as PublishCheckpoint;
    const result=await executePublication(settings,initial,metaPublishProvider(connection,settings,current.id,urls),async checkpoint=>{
      current=await savePublication(actor,current,{metadata:{...current.metadata,publishCheckpoint:checkpoint,externalIds:checkpoint.receipts.map(item=>item.id)}});
    });
    const at=new Date().toISOString();
    return await savePublication(actor,current,{status:"published",stage:metaMode()==="mock"?"모의 게시 완료":"게시 완료",source_url:result.receipts[0]?.permalink||null,metadata:{...current.metadata,publishOperation:{id:operationId,state:"done",at,actorId:actor.id},publishedAt:at,postedBy:actor.id,permalink:result.receipts[0]?.permalink??"",mockPublished:metaMode()==="mock",manualTasks:settings.firstComment?[{kind:"first_comment",text:settings.firstComment,done:false}]:[]}});
  }catch(error){
    const code=error instanceof PublicationError?error.code:"PUBLICATION_RESULT_PENDING";
    try{await savePublication(actor,current,{metadata:{...current.metadata,publishOperation:{id:operationId,state:"failed",at:new Date().toISOString(),actorId:actor.id},publishError:{code,message:error instanceof PublicationError?error.message:"게시 결과 저장을 확인하지 못했습니다. 중복 게시하지 말고 결과를 확인하세요."}}});}catch{/* Preserve the running lock if checkpoint persistence was ambiguous. */}
    throw new ApiError(409,code,error instanceof PublicationError?error.message:"게시 결과 확인이 필요합니다. 자동 재게시하지 않았습니다.");
  }
}
