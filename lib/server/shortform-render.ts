import { createHash,createHmac,randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import type { OsRecord } from "@/lib/record-types";
import { parseShortformBrief,shortformCutsSchema,shortformSeconds,validateDirectCuts,shortformBriefProblem } from "@/lib/shortform-production";
import { createServiceSupabase } from "@/lib/supabase/server";
import { safeSecretMatch,type RequestActor } from "./auth";
import { getPersonalRecord,assertHumanOwner } from "./content-automation-v07";
import { validatePersonalAsset } from "./content-automation-validators";
import { readShortformLongform } from "./shortform-longform";
import { fishVoiceSettings,synthesizeFishSegment } from "./fish-audio";

export const SHORTFORM_RENDER_KIND="shortform_render_v1";
const BUCKET="os-content-media",VOICE_BUCKET="os-youtube-voice",LEASE_MS=30*60_000;
type Service=ReturnType<typeof createServiceSupabase>;
// Canonical ordering survives jsonb's key reordering.
export function renderCanonical(value:unknown):string {
  if(Array.isArray(value))return "["+value.map(renderCanonical).join(",")+"]";
  if(value&&typeof value==="object")return "{"+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>JSON.stringify(k)+":"+renderCanonical(v)).join(",")+"}";
  return JSON.stringify(value)??"null";
}
export const renderDigest=(value:unknown)=>createHash("sha256").update(renderCanonical(value)).digest("hex");
function secret(){
  const value=process.env.YOUTUBE_MEDIA_WORKER_SECRET??"";
  if(value.length<32)throw new ApiError(503,"SHORTFORM_WORKER_UNAVAILABLE","렌더 PC 연결 설정이 필요합니다.");
  return value;
}
/** 9:16 for Shorts · Reels; 1:1 square and 4:5 portrait for feed ads (owner requests 2026-10-25). A plan without `aspect` is 9:16, as every plan before it. */
export type ShortformAspect="9:16"|"1:1"|"4:5";
type AdAspect=Exclude<ShortformAspect,"9:16">;
/** The first worker layoutVersion that draws each ad size; an older worker would draw it as 9:16 or fail, so it never gets the job. */
const AD_LAYOUT:Record<AdAspect,number>={"1:1":3,"4:5":4};
type Plan={
  layoutVersion:2;aspect?:AdAspect;
  mode:"reuse"|"direct";duration:number;brief:unknown;memo:string;
  cuts:{start:number;end:number;text:string;voice:string;assetId?:string;assetVersion?:number;assetPath?:string}[];
  source?:{id:string;key:string};
  voice?:{referenceFingerprint:string;model:string;settings:ReturnType<typeof fishVoiceSettings>};
};
type Run={kind:typeof SHORTFORM_RENDER_KIND;itemId:string;inputKey:string;plan:Plan;signature:string;
  voiceApproved:boolean;attempts:number;lease?:{token:string;expiresAt:string};outputPath?:string;error?:string;bytes?:number;sha256?:string;completedSignature?:string;
  voiceLock?:{index:number;at:string}};
function renderId(owner:string,itemId:string,inputKey:string){
  const key=renderDigest([owner,itemId,inputKey]);
  return `${key.slice(0,8)}-${key.slice(8,12)}-5${key.slice(13,16)}-a${key.slice(17,20)}-${key.slice(20,32)}`;
}
function completedSignature(owner:string,run:Run){
  return createHmac("sha256",secret()).update(renderCanonical(["complete",owner,run.itemId,run.inputKey,run.outputPath,run.bytes,run.sha256])).digest("hex");
}
function signature(owner:string,run:Pick<Run,"itemId"|"inputKey"|"voiceApproved">){
  return createHmac("sha256",secret()).update(renderCanonical([owner,run.itemId,run.inputKey,run.voiceApproved])).digest("hex");
}
export function verifyShortformRun(record:OsRecord):Run {
  const run=record.metadata as unknown as Run;
  if(record.record_type!=="ai_job"||run.kind!==SHORTFORM_RENDER_KIND||!record.owner_id
    ||!run.plan||run.inputKey!==renderDigest(run.plan)||record.id!==renderId(record.owner_id,run.itemId,run.inputKey)
    ||!safeSecretMatch(run.signature??"",signature(record.owner_id,run))
    ||record.status==="done"&&!safeSecretMatch(run.completedSignature??"",completedSignature(record.owner_id,run)))
    throw new ApiError(409,"SHORTFORM_RUN_INVALID","유효한 숏폼 제작 요청이 아닙니다.");
  return run;
}
async function ownRecord(service:Service,owner:string,id:string,type:string){
  const {data,error}=await service.from("os_records").select("*").eq("id",id).eq("owner_id",owner).eq("record_type",type).is("archived_at",null).maybeSingle();
  if(error||!data)throw new ApiError(404,"SHORTFORM_INPUT_MISSING","내 제작 원본·소재를 찾지 못했습니다.");
  return data as OsRecord;
}
async function buildPlan(service:Service,item:OsRecord,aspect:ShortformAspect="9:16"):Promise<Plan>{
  if(item.record_type!=="content_publish"||item.metadata.space!=="personal"||item.metadata.channel!=="shorts"||!["draft","blocked"].includes(item.status))
    throw new ApiError(409,"SHORTFORM_DRAFT_REQUIRED","제작 중인 내 숏폼 카드에서 요청해 주세요.");
  const brief=parseShortformBrief(item.metadata.shortformBrief);
  const problem=shortformBriefProblem(brief,"cuts");
  if(problem)throw new ApiError(422,"SHORTFORM_INPUT_REQUIRED",problem);
  const parsed=shortformCutsSchema.safeParse({cuts:item.metadata.cuts});
  if(!parsed.success||parsed.data.cuts.length>20)throw new ApiError(422,"SHORTFORM_CUTS_INVALID","1~20개 장면을 준비해 주세요.");
  if(brief.mode==="direct")validateDirectCuts(parsed.data,brief.duration);
  if(aspect!=="9:16"&&brief.purpose!=="ad")throw new ApiError(422,"SHORTFORM_ASPECT_AD_ONLY","정사각형 · 4:5는 광고 숏폼에서 만들어요.");
  const plan:Plan={layoutVersion:2,...(aspect!=="9:16"?{aspect}:{}),mode:brief.mode,duration:0,brief,memo:item.description??"",cuts:[]};
  let sourceDuration=0;
  if(brief.mode==="reuse"){
    const source=z.object({id:z.string().uuid(),key:z.string().regex(/^[a-f0-9]{64}$/)}).safeParse(item.metadata.shortformSource);
    if(!source.success)throw new ApiError(422,"SHORTFORM_SOURCE_REQUIRED","OS 롱폼 완성본을 연결해 주세요.");
    // Workers have no user session. Limit this first render path to an owned source, checked on every stage.
    await ownRecord(service,String(item.owner_id),source.data.id,"content_topic");
    const resolved=await readShortformLongform({supabase:service},source.data.id,source.data.key,()=>service);
    sourceDuration=resolved.durationSeconds;plan.source=source.data;
  }
  for(const cut of parsed.data.cuts){
    const start=shortformSeconds(cut.start),end=shortformSeconds(cut.end);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end-start>60||brief.mode==="reuse"&&end>sourceDuration)
      throw new ApiError(422,"SHORTFORM_RANGE_INVALID","실제 원본 안의 시작·끝 시각을 확인해 주세요.");
    const scene:Plan["cuts"][number]={start,end,text:cut.text,voice:brief.mode==="direct"?cut.voice??"":""};
    if(cut.text.length>240||scene.voice.length>1800)
      throw new ApiError(422,"SHORTFORM_TEXT_LONG","장면 자막은 240자, 내레이션은 1,800자 이내로 줄여 주세요.");
    if(scene.voice.length>(end-start)*12+20)
      throw new ApiError(422,"SHORTFORM_VOICE_TOO_LONG","장면 시간에 비해 내레이션이 깁니다. 음성을 만들기 전에 대본을 줄여 주세요.");
    if(brief.mode==="direct"){
      if(cut.missingAsset||!cut.assetId)throw new ApiError(422,"SHORTFORM_ASSET_REQUIRED","각 장면에 확보한 내 이미지를 선택해 주세요.");
      const asset=await ownRecord(service,String(item.owner_id),cut.assetId,"content_asset");
      if(asset.metadata.space!=="personal")throw new ApiError(403,"SHORTFORM_ASSET_FORBIDDEN","내 이미지에서 선택해 주세요.");
      validatePersonalAsset(asset.metadata,String(item.owner_id));
      if(Number(asset.metadata.width)>8000||Number(asset.metadata.height)>8000)
        throw new ApiError(422,"SHORTFORM_IMAGE_TOO_LARGE","장면 이미지는 가로·세로 8,000px 이하로 준비해 주세요.");
      const license=asset.metadata.license as {source?:string}|undefined;
      if(!license||license.source==="unknown")throw new ApiError(422,"SHORTFORM_ASSET_LICENSE","소재의 사용권을 확인해 주세요.");
      Object.assign(scene,{assetId:asset.id,assetVersion:asset.version,assetPath:String(asset.metadata.storagePath)});
    }
    plan.cuts.push(scene);plan.duration+=end-start;
  }
  if(plan.duration>60||plan.duration<1)throw new ApiError(422,"SHORTFORM_DURATION_INVALID","완성 길이는 1~60초여야 합니다.");
  if(brief.mode==="direct"&&plan.cuts.some(cut=>cut.voice.trim())){
    const referenceId=process.env.FISH_VOICE_REFERENCE_ID?.trim(),model=process.env.FISH_TTS_MODEL?.trim()||"s2.1-pro";
    if(!referenceId||!process.env.FISH_API_KEY?.trim())throw new ApiError(503,"FISH_NOT_CONFIGURED","내레이션 생성 설정이 필요합니다.");
    plan.voice={referenceFingerprint:renderDigest(referenceId),model,settings:fishVoiceSettings(process.env)};
  }
  return plan;
}
async function save(service:Service,row:OsRecord,status:string,stage:string,run:Run){
  const {data,error}=await service.from("os_records").update({status,stage,metadata:run,updated_by:row.owner_id})
    .eq("id",row.id).eq("version",row.version).is("archived_at",null).select("*").maybeSingle();
  if(error||!data)throw new ApiError(409,"SHORTFORM_RUN_CHANGED","제작 작업이 먼저 변경됐습니다.");
  return data as OsRecord;
}
export async function enqueueShortformRender(actor:RequestActor,itemId:string,version:number,voiceApproved:boolean){
  const owner=assertHumanOwner(actor),item=await getPersonalRecord(actor,itemId,"content_publish");
  return enqueueShortformRenderFor(owner,item,version,voiceApproved);
}
/** The queueing itself, for a card the caller was already allowed to (유튜브 공정 v1: a project member making its 숏폼, owned by the project owner). */
export async function enqueueShortformRenderFor(owner:string,item:OsRecord,version:number,voiceApproved:boolean,aspect:ShortformAspect="9:16"){
  const itemId=item.id,service=createServiceSupabase();
  if(item.owner_id!==owner)throw new ApiError(403,"SHORTFORM_OWNER_MISMATCH","제작 카드의 주인을 확인해 주세요.");
  if(item.version!==version)throw new ApiError(409,"SHORTFORM_INPUT_CHANGED","최신 내용을 저장하고 다시 요청해 주세요.");
  const plan=await buildPlan(service,item,aspect),inputKey=renderDigest(plan);
  if(plan.voice&&!voiceApproved)throw new ApiError(422,"SHORTFORM_VOICE_APPROVAL","내레이션 생성 비용을 확인해 주세요.");
  const {data:existing,error}=await service.from("os_records").select("*").eq("record_type","ai_job").eq("owner_id",owner)
    .eq("metadata->>kind",SHORTFORM_RENDER_KIND).eq("metadata->>itemId",itemId).eq("metadata->>inputKey",inputKey)
    .in("status",["backlog","in_progress","done"]).is("archived_at",null).order("created_at",{ascending:false}).limit(1);
  if(error)throw new ApiError(503,"SHORTFORM_QUEUE_FAILED","제작 대기열을 확인하지 못했습니다.");
  if(existing?.[0]){
    const run=verifyShortformRun(existing[0] as OsRecord);
    if(existing[0].status==="done"&&!run.plan.aspect&&item.metadata.mp4Path!==run.outputPath)
      await attachVideo(service,item,existing[0].id,run);
    return {runId:existing[0].id,reused:true};
  }
  // Deterministic id prevents simultaneous double clicks from buying the same voice twice.
  const id=renderId(owner,itemId,inputKey);
  const run:Run={kind:SHORTFORM_RENDER_KIND,itemId,inputKey,plan,voiceApproved,attempts:0,signature:signature(owner,{itemId,inputKey,voiceApproved})};
  const {error:insertError}=await service.from("os_records").insert({id,record_type:"ai_job",title:`${item.title} · 숏폼 제작`.slice(0,240),
    description:"확인한 장면 구성으로 비공개 MP4를 제작합니다.",owner_id:owner,created_by:owner,updated_by:owner,parent_id:itemId,
    status:"backlog",stage:"render_pending",priority:"normal",brand:item.brand,metadata:run});
  if(insertError?.code==="23505"){
    const row=await ownRecord(service,owner,id,"ai_job");verifyShortformRun(row);
    if(row.status==="blocked")await save(service,row,"backlog","render_pending",run);
    return {runId:id,reused:true};
  }
  if(insertError)throw new ApiError(503,"SHORTFORM_QUEUE_FAILED","제작 요청을 저장하지 못했습니다.");
  return {runId:id,reused:false};
}
async function currentInput(service:Service,row:OsRecord,run:Run){
  const owner=String(row.owner_id);
  const {data:profile}=await service.from("os_profiles").select("is_active").eq("id",owner).maybeSingle();
  if(profile?.is_active!==true)throw new ApiError(403,"SHORTFORM_OWNER_INACTIVE","제작자 계정을 확인해 주세요.");
  const item=await ownRecord(service,owner,run.itemId,"content_publish");
  if(renderDigest(await buildPlan(service,item,run.plan.aspect??"9:16"))!==run.inputKey)
    throw new ApiError(409,"SHORTFORM_INPUT_CHANGED","제작 조건·원본·소재가 변경되어 이전 작업을 중단했습니다.");
  return item;
}
async function sign(service:Service,bucket:string,path:string){
  const {data,error}=await service.storage.from(bucket).createSignedUrl(path,3600);
  if(error||!data)throw new ApiError(503,"SHORTFORM_SIGN_FAILED","제작 파일을 열지 못했습니다.");
  return data.signedUrl;
}
export async function claimShortformRender(service:Service=createServiceSupabase(),layoutVersion:2|3|4=2){
  const {data:rows,error}=await service.from("os_records").select("*").eq("record_type","ai_job").eq("metadata->>kind",SHORTFORM_RENDER_KIND)
    .in("status",["backlog","in_progress"]).is("archived_at",null).order("created_at").limit(30);
  if(error)throw new ApiError(503,"SHORTFORM_QUEUE_FAILED","제작 대기열을 읽지 못했습니다.");
  for(const row of (rows??[]) as OsRecord[]){
    let run:Run;try{run=verifyShortformRun(row);}catch{continue;}
    // A worker older than an ad size (1:1 from layoutVersion 3, 4:5 from 4) gets only the sizes it draws.
    if(run.plan.aspect&&layoutVersion<AD_LAYOUT[run.plan.aspect])continue;
    if(run.lease&&Date.parse(run.lease.expiresAt)>Date.now())continue;
    if(run.attempts>=3){await save(service,row,"blocked","failed",run);continue;}
    try{await currentInput(service,row,run);}catch{await save(service,row,"blocked","failed",{...run,error:"SHORTFORM_INPUT_CHANGED"});continue;}
    const lease={token:randomUUID(),expiresAt:new Date(Date.now()+LEASE_MS).toISOString()};
    const outputPath=`automation/${row.owner_id}/shorts/${randomUUID()}.mp4`;
    const claimed=await save(service,row,"in_progress","rendering",{...run,lease,outputPath,attempts:run.attempts+1,error:undefined}).catch(()=>null);
    if(!claimed)continue;
    try{
      const {data:upload,error:uploadError}=await service.storage.from(BUCKET).createSignedUploadUrl(outputPath);
      if(uploadError||!upload)throw new Error("sign");
      const scenes=[];
      const source=run.plan.source?await readShortformLongform({supabase:service},run.plan.source.id,run.plan.source.key,()=>service):null;
      for(const cut of run.plan.cuts)scenes.push({start:cut.start,end:cut.end,text:cut.text,hasVoice:Boolean(cut.voice.trim()),
        ...(cut.assetPath?{imageUrl:await sign(service,BUCKET,cut.assetPath)}:{})});
      return {renderId:row.id,lease:lease.token,mode:run.plan.mode,aspect:run.plan.aspect??"9:16",duration:run.plan.duration,scenes,
        sourceUrl:source?.videoUrl,uploadUrl:upload.signedUrl};
    }catch{
      await save(service,claimed,"blocked","failed",{...verifyShortformRun(claimed),error:"SHORTFORM_FILES_UNAVAILABLE",lease:undefined});
    }
  }
  return {idle:true as const};
}
async function leased(service:Service,id:string,token:string){
  const {data}=await service.from("os_records").select("*").eq("id",id).eq("record_type","ai_job").is("archived_at",null).maybeSingle();
  if(!data)throw new ApiError(404,"SHORTFORM_RUN_MISSING","제작 요청이 없습니다.");
  const row=data as OsRecord,run=verifyShortformRun(row);
  if(run.lease?.token!==token||Date.parse(run.lease.expiresAt)<Date.now()||!["in_progress","done"].includes(row.status))
    throw new ApiError(409,"SHORTFORM_LEASE_LOST","제작 처리 시간이 만료됐습니다.");
  return {row,run};
}
export async function shortformVoice(input:{renderId:string;lease:string;index:number},service:Service=createServiceSupabase()){
  const {row,run}=await leased(service,input.renderId,input.lease);
  if(row.status!=="in_progress")throw new ApiError(409,"SHORTFORM_FINISHED","완료된 작업입니다.");
  await currentInput(service,row,run);
  const cut=run.plan.cuts[input.index];
  if(!cut?.voice.trim()||!run.plan.voice||!run.voiceApproved)throw new ApiError(422,"SHORTFORM_VOICE_APPROVAL","승인된 내레이션이 없습니다.");
  // Keyed by the voice and the words, so the 9:16 and the ad-size renders of the same scenes pay for the narration once.
  const path=`${row.owner_id}/${run.itemId}/voice-${renderDigest([run.plan.voice,cut.voice]).slice(0,32)}.mp3`;
  const folder=path.slice(0,path.lastIndexOf("/")),name=path.slice(path.lastIndexOf("/")+1);
  const {data,error}=await service.storage.from(VOICE_BUCKET).list(folder,{search:name,limit:30});
  if(error)throw new ApiError(503,"SHORTFORM_VOICE_READ","기존 음성을 확인하지 못했습니다.");
  if(!data?.some(file=>file.name===name)){
    if(run.voiceLock)throw new ApiError(409,"SHORTFORM_VOICE_UNCERTAIN","진행 중이던 음성의 저장 결과를 먼저 확인해 주세요.");
    // Claim the paid call with the same optimistic version used by render leases.
    const locked=await save(service,row,"in_progress","rendering",{...run,voiceLock:{index:input.index,at:new Date().toISOString()}});
    const audio=await synthesizeFishSegment(cut.voice,{apiKey:process.env.FISH_API_KEY??"",referenceId:process.env.FISH_VOICE_REFERENCE_ID??"",
      model:run.plan.voice.model,settings:run.plan.voice.settings,signal:AbortSignal.timeout(100_000)});
    const stored=await service.storage.from(VOICE_BUCKET).upload(path,new Uint8Array(audio.bytes),{contentType:"audio/mpeg",upsert:false});
    // The other render of the same scenes may have stored the same narration a moment earlier.
    if(stored.error&&!/exist|duplicate/i.test(stored.error.message))throw new ApiError(503,"SHORTFORM_VOICE_SAVE","음성을 보관하지 못했습니다.");
    await save(service,locked,"in_progress","rendering",{...run,voiceLock:undefined});
  }
  return {url:await sign(service,VOICE_BUCKET,path)};
}
export async function completeShortformRender(input:{renderId:string;lease:string;bytes:number;sha256:string;duration:number},service:Service=createServiceSupabase()){
  const {row,run}=await leased(service,input.renderId,input.lease);
  if(row.status==="done")return {renderId:row.id,stage:"render_ready"};
  const item=await currentInput(service,row,run);
  if(!run.outputPath||!new RegExp(`^automation/${row.owner_id}/shorts/[0-9a-f-]{36}\\.mp4$`).test(run.outputPath)
    ||input.bytes>50_000_000||Math.abs(input.duration-run.plan.duration)>0.2)
    throw new ApiError(422,"SHORTFORM_OUTPUT_INVALID","완성 영상 크기·길이를 확인해 주세요.");
  const folder=run.outputPath.slice(0,run.outputPath.lastIndexOf("/")),name=run.outputPath.slice(run.outputPath.lastIndexOf("/")+1);
  const listed=await service.storage.from(BUCKET).list(folder,{search:name,limit:2});
  if(listed.error||!listed.data?.some(file=>file.name===name&&Number(file.metadata?.size)===input.bytes))
    throw new ApiError(409,"SHORTFORM_OUTPUT_MISSING","완성 영상 업로드를 확인해 주세요.");
  const {data:blob,error}=await service.storage.from(BUCKET).download(run.outputPath);
  if(error||!blob||blob.size!==input.bytes||blob.size>50_000_000)throw new ApiError(409,"SHORTFORM_OUTPUT_MISSING","완성 영상 업로드를 확인해 주세요.");
  const bytes=Buffer.from(await blob.arrayBuffer());
  if(bytes.subarray(4,8).toString()!=="ftyp"||createHash("sha256").update(bytes).digest("hex")!==input.sha256)
    throw new ApiError(409,"SHORTFORM_OUTPUT_INVALID","완성 영상 검증에 실패했습니다.");
  // The card keeps the 9:16 video (Shorts · Reels and the earlier screens); an ad size is read from its render.
  if(!run.plan.aspect)await attachVideo(service,item,row.id,run);
  const completed={...run,bytes:input.bytes,sha256:input.sha256};
  await save(service,row,"done","render_ready",{...completed,completedSignature:completedSignature(String(row.owner_id),completed)});
  return {renderId:row.id,stage:"render_ready"};
}
async function attachVideo(service:Service,item:OsRecord,id:string,run:Run){
  const {data:attached,error:attachError}=await service.from("os_records").update({
    metadata:{...item.metadata,mp4Path:run.outputPath,mp4Source:run.plan.mode==="reuse"?"OS 롱폼 완성본에서 제작":"확인한 내 이미지와 내레이션으로 제작",
      shortformRenderId:id,bgmSource:"배경음악 없음",needsRecheck:true},updated_by:item.owner_id,
  }).eq("id",item.id).eq("version",item.version).in("status",["draft","blocked"]).is("archived_at",null).select("id").maybeSingle();
  if(attachError||!attached)throw new ApiError(409,"SHORTFORM_INPUT_CHANGED","콘텐츠가 변경되어 완성본을 자동 연결하지 않았습니다.");
}
export async function failShortformRender(input:{renderId:string;lease:string;code:string},service:Service=createServiceSupabase()){
  const {row,run}=await leased(service,input.renderId,input.lease);
  if(row.status==="done")return {renderId:row.id,stage:"render_ready"};
  await save(service,row,"blocked","failed",{...run,lease:undefined,error:input.code.replace(/[^A-Z0-9_]/g,"").slice(0,80)});
  return {renderId:row.id,stage:"failed"};
}
export async function shortformRenderStatus(actor:RequestActor,itemId:string){
  const owner=assertHumanOwner(actor);await getPersonalRecord(actor,itemId,"content_publish");
  const {data,error}=await createServiceSupabase().from("os_records").select("*")
    .eq("record_type","ai_job").eq("owner_id",owner).eq("metadata->>kind",SHORTFORM_RENDER_KIND).eq("metadata->>itemId",itemId)
    .is("archived_at",null).order("created_at",{ascending:false}).limit(1);
  if(error)throw new ApiError(503,"SHORTFORM_QUEUE_FAILED","제작 상태를 확인하지 못했습니다.");
  const row=data?.[0];if(row)verifyShortformRun(row as OsRecord);
  return {run:row?{id:row.id,status:row.status,stage:row.stage,error:row.metadata?.error??null}:null};
}
