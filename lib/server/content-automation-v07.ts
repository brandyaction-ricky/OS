import { assertShortformJobCurrent,shortformJobInput,shortformInputKey } from "./shortform-production";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ApiError } from "@/lib/http";
import type { OsRecord, RecordType } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";

export const AUTOMATION_PROCS = ["topic","brief","card-fill","card-caption","image","shorts-cut","shorts-desc","threads","review","reply"] as const;
export type AutomationProc = typeof AUTOMATION_PROCS[number];
export const AUTOMATION_CHANNELS = ["card","shorts","threads"] as const;
export const PERSONAL_TYPES = ["content_topic","content_publish","ai_job","skill","content_package","content_asset"] as const;
export const DEFAULT_RUN_RULES = {
  enabled: true, days: "daily", times: ["09:00","13:00","17:00"],
  per_run: 3, daily_max: 15, order_by: "due", long_only_now: true,
  grace_minutes: 15, lease_minutes: 120, notify: true,
  defaults: {channels:["card","shorts","threads"],templateId:null,sendMode:"queue",leadMinutes:30,expiryDays:[7,3],minImageShortSide:1080},
} as const;

export function assertHumanOwner(actor: RequestActor) {
  if (actor.type !== "user") throw new ApiError(403,"USER_SESSION_REQUIRED","직원 로그인으로 열어 주세요.");
  return actor.ownerId;
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new ApiError(403,"ORIGIN_FORBIDDEN","같은 사이트에서 요청해 주세요.");
}
export function personalRecord(record: Pick<OsRecord,"owner_id"|"metadata">,ownerId:string) {
  return record.owner_id===ownerId && record.metadata?.space==="personal";
}
export async function getPersonalRecord(actor: RequestActor,id:string,type?:RecordType) {
  const ownerId=assertHumanOwner(actor);
  let query=createServiceSupabase().from("os_records").select("*").eq("id",id)
    .eq("owner_id",ownerId).eq("metadata->>space","personal").is("archived_at",null);
  if(type)query=query.eq("record_type",type);
  const {data,error}=await query.maybeSingle();
  if(error)throw new ApiError(503,"AUTOMATION_READ_FAILED","내 기록을 확인하지 못했습니다.");
  if(!data)throw new ApiError(404,"AUTOMATION_NOT_FOUND","내 기록을 찾을 수 없습니다.");
  return data as OsRecord;
}
export async function listPersonalRecords(actor:RequestActor,type:RecordType,limit=100) {
  const ownerId=assertHumanOwner(actor);
  const {data,error}=await createServiceSupabase().from("os_records").select("*")
    .eq("owner_id",ownerId).eq("metadata->>space","personal").eq("record_type",type)
    .is("archived_at",null).order("updated_at",{ascending:false}).limit(limit);
  if(error)throw new ApiError(503,"AUTOMATION_LIST_FAILED","내 기록을 불러오지 못했습니다.");
  return (data??[]) as OsRecord[];
}
export async function createPersonalRecord(actor:RequestActor,type:RecordType,input:{
  title:string;description?:string;status?:string;stage?:string;brand?:string;
  parentId?:string|null;dueDate?:string|null;metadata?:Record<string,unknown>;
}) {
  const ownerId=assertHumanOwner(actor);
  if(!PERSONAL_TYPES.includes(type as typeof PERSONAL_TYPES[number]))throw new ApiError(400,"INVALID_PERSONAL_TYPE","개인 자동화 기록 유형을 확인해 주세요.");
  if(input.parentId)await getPersonalRecord(actor,input.parentId);
  const {data,error}=await createServiceSupabase().from("os_records").insert({
    record_type:type,title:input.title.trim(),description:input.description??"",
    status:input.status??"draft",stage:input.stage??"",brand:input.brand??"",
    parent_id:input.parentId??null,due_date:input.dueDate??null,
    owner_id:ownerId,created_by:ownerId,updated_by:ownerId,
    metadata:{...input.metadata,space:"personal"},
  }).select("*").single();
  if(error?.code==="23505"&&type==="content_publish"&&input.parentId&&typeof input.metadata?.channel==="string"){
    const existing=await createServiceSupabase().from("os_records").select("*")
      .eq("record_type","content_publish").eq("owner_id",ownerId).eq("parent_id",input.parentId)
      .eq("metadata->>space","personal").eq("metadata->>channel",input.metadata.channel)
      .is("archived_at",null).maybeSingle();
    if(existing.data)return existing.data as OsRecord;
  }
  if(error?.code==="23505"&&type==="content_topic"&&input.metadata?.source==="comment"&&typeof input.metadata.sourceRef==="string"){
    const existing=await createServiceSupabase().from("os_records").select("*")
      .eq("record_type","content_topic").eq("owner_id",ownerId).eq("metadata->>space","personal")
      .eq("metadata->>source","comment").eq("metadata->>sourceRef",input.metadata.sourceRef)
      .is("archived_at",null).maybeSingle();
    if(existing.data)return existing.data as OsRecord;
  }
  if(error?.code==="23505"&&type==="content_topic"&&typeof input.metadata?.requestId==="string"){
    const existing=await createServiceSupabase().from("os_records").select("*")
      .eq("record_type","content_topic").eq("owner_id",ownerId).eq("metadata->>space","personal")
      .eq("metadata->>requestId",input.metadata.requestId).is("archived_at",null).maybeSingle();
    if(existing.data)return existing.data as OsRecord;
  }
  if(error||!data)throw new ApiError(503,"AUTOMATION_SAVE_FAILED","내 기록을 저장하지 못했습니다.");
  return data as OsRecord;
}
// team: the caller already checked the actor may edit this shared draft (or its AI job).
// The row keeps its owner; updated_by records who changed it.
export async function updatePersonalRecord(actor:RequestActor,current:OsRecord,changes:Record<string,unknown>,{team=false}:{team?:boolean}={}) {
  const ownerId=assertHumanOwner(actor);
  if(!(team?current.metadata?.space==="personal":personalRecord(current,ownerId)))throw new ApiError(404,"AUTOMATION_NOT_FOUND","내 기록을 찾을 수 없습니다.");
  const {data,error}=await createServiceSupabase().from("os_records")
    .update({...changes,updated_by:ownerId}).eq("id",current.id).eq("owner_id",current.owner_id)
    .eq("metadata->>space","personal").eq("version",current.version).is("archived_at",null)
    .select("*").maybeSingle();
  if(error)throw new ApiError(503,"AUTOMATION_SAVE_FAILED","내 기록을 저장하지 못했습니다.");
  if(!data)throw new ApiError(409,"AUTOMATION_CHANGED","다른 작업이 먼저 수정했습니다. 다시 불러와 주세요.");
  return data as OsRecord;
}

// Team review inbox. Only a Threads draft its owner shared carries metadata.shared="team";
// everything else stays owner-only. Reviewers are the named people in os_content_reviewers.
export const TEAM_FIELDS=["shared","sharedAt","sharedBy"] as const;
export function isTeamShared(record:Pick<OsRecord,"record_type"|"metadata">) {
  return record.record_type==="content_publish"&&record.metadata?.space==="personal"&&record.metadata?.shared==="team";
}
export async function isContentReviewer(userId:string) {
  const {data,error}=await createServiceSupabase().rpc("os_is_content_reviewer",{p_actor:userId});
  if(error)throw new ApiError(503,"REVIEWER_CHECK_FAILED","검수 권한을 확인하지 못했습니다.");
  return data===true;
}
export type ContentAccess={record:OsRecord;own:boolean;team:boolean;canEdit:boolean;canReview:boolean};
export async function getContentRecord(actor:RequestActor,id:string,type?:RecordType):Promise<ContentAccess> {
  const ownerId=assertHumanOwner(actor);
  let query=createServiceSupabase().from("os_records").select("*").eq("id",id)
    .eq("metadata->>space","personal").is("archived_at",null);
  if(type)query=query.eq("record_type",type);
  const {data,error}=await query.maybeSingle();
  if(error)throw new ApiError(503,"AUTOMATION_READ_FAILED","기록을 확인하지 못했습니다.");
  const record=data as OsRecord|null,team=Boolean(record&&isTeamShared(record));
  if(!record||record.owner_id!==ownerId&&!team)throw new ApiError(404,"AUTOMATION_NOT_FOUND","기록을 찾을 수 없습니다.");
  const own=record.owner_id===ownerId,reviewer=team?await isContentReviewer(ownerId):false;
  return {record,own,team,canEdit:own||reviewer,canReview:team?reviewer:own};
}
export function assertCanEdit(access:ContentAccess) {
  if(!access.canEdit)throw new ApiError(403,"TEAM_EDIT_FORBIDDEN","팀 원고는 작성자와 지정 검수자만 고칠 수 있습니다. 의견으로 남겨 주세요.");
  return access.record;
}
// The AI job behind a draft: the owner's own job, or for a shared draft the owner's job that targets it.
export async function getItemJob(actor:RequestActor,access:ContentAccess,jobId:string) {
  if(access.own)return getPersonalRecord(actor,jobId,"ai_job");
  const {data,error}=await createServiceSupabase().from("os_records").select("*").eq("id",jobId)
    .eq("record_type","ai_job").eq("owner_id",access.record.owner_id).eq("metadata->>space","personal")
    .eq("metadata->>targetId",access.record.id).is("archived_at",null).maybeSingle();
  if(error)throw new ApiError(503,"AUTOMATION_READ_FAILED","AI 결과를 확인하지 못했습니다.");
  if(!data)throw new ApiError(404,"AUTOMATION_NOT_FOUND","AI 결과를 찾을 수 없습니다.");
  return data as OsRecord;
}
export async function listTeamItems(limit=200) {
  const {data,error}=await createServiceSupabase().from("os_records").select("*")
    .eq("record_type","content_publish").eq("metadata->>space","personal").eq("metadata->>shared","team")
    .is("archived_at",null).order("updated_at",{ascending:false}).limit(limit);
  if(error)throw new ApiError(503,"AUTOMATION_LIST_FAILED","팀 검수함을 불러오지 못했습니다.");
  return (data??[]) as OsRecord[];
}
export async function memberNames(ids:Iterable<string|null|undefined>) {
  const unique=[...new Set(ids)].filter((id):id is string=>Boolean(id));
  if(!unique.length)return new Map<string,string>();
  const {data,error}=await createServiceSupabase().from("os_profiles").select("id,display_name").in("id",unique);
  if(error)throw new ApiError(503,"MEMBER_NAMES_FAILED","구성원 이름을 확인하지 못했습니다.");
  return new Map((data??[]).map(row=>[row.id as string,String(row.display_name??"구성원")]));
}

export function validateRunRules(input:Record<string,unknown>) {
  const days=["daily","weekdays","monday"];
  const counts=[1,3,5],daily=[10,15,30],graces=[15,30,60],orders=["due","made","proc"];
  const times=input.times;
  const defaults=input.defaults;
  if(defaults!==undefined&&(typeof defaults!=="object"||defaults===null||Array.isArray(defaults)
    ||JSON.stringify(defaults).length>5000))
    throw new ApiError(422,"INVALID_RUN_DEFAULTS","기본값을 확인해 주세요.");
  if(defaults&&typeof defaults==="object"&&!Array.isArray(defaults)){
    const value=defaults as Record<string,unknown>;
    if(Object.keys(value).some(key=>!["channels","templateId","sendMode","leadMinutes","expiryDays","minImageShortSide"].includes(key))
      ||(value.channels!==undefined&&(!Array.isArray(value.channels)||value.channels.some(channel=>!AUTOMATION_CHANNELS.includes(channel))))
      ||(value.templateId!==undefined&&value.templateId!==null&&typeof value.templateId!=="string")
      ||(value.sendMode!==undefined&&! ["queue","ask","copy"].includes(String(value.sendMode)))
      ||(value.leadMinutes!==undefined&&(!Number.isInteger(value.leadMinutes)||Number(value.leadMinutes)<0||Number(value.leadMinutes)>10080))
      ||(value.expiryDays!==undefined&&(!Array.isArray(value.expiryDays)||value.expiryDays.some(day=>!Number.isInteger(day)||day<1||day>365)))
      ||(value.minImageShortSide!==undefined&&(!Number.isInteger(value.minImageShortSide)||Number(value.minImageShortSide)<1||Number(value.minImageShortSide)>10000)))
      throw new ApiError(422,"INVALID_RUN_DEFAULTS","기본값을 확인해 주세요.");
  }
  if(typeof input.enabled!=="boolean"||!days.includes(String(input.days))
    || !Array.isArray(times)||times.length<1||times.length>6
    || times.some(value=>typeof value!=="string"||!/^([01][0-9]|2[0-2]):(00|30)$/.test(value)||value<"06:00"||value>"22:00")
    ||new Set(times).size!==times.length||!counts.includes(Number(input.per_run))
    ||!daily.includes(Number(input.daily_max))||!orders.includes(String(input.order_by))
    ||typeof input.long_only_now!=="boolean"||!graces.includes(Number(input.grace_minutes))
    ||!Number.isInteger(input.lease_minutes)||Number(input.lease_minutes)<15||Number(input.lease_minutes)>240
    ||typeof input.notify!=="boolean")throw new ApiError(422,"INVALID_RUN_RULES","실행 규칙의 요일·시각·횟수 범위를 확인해 주세요.");
  return input;
}
export async function getRunRules(ownerId:string) {
  const {data,error}=await createServiceSupabase().from("os_ai_run_rules").select("*").eq("owner_id",ownerId).maybeSingle();
  if(error)throw new ApiError(503,"RUN_RULES_UNAVAILABLE","실행 규칙을 불러오지 못했습니다.");
  return data??{...DEFAULT_RUN_RULES,owner_id:ownerId};
}
export function browserCookieKey(request:Request) {
  return request.headers.get("cookie")?.split(";").map(part=>part.trim()).find(part=>part.startsWith("ca_browser="))?.slice("ca_browser=".length)??"";
}
export function hashBrowserKey(key:string) {
  return createHash("sha256").update(key).digest("hex");
}
export async function getRegisteredBrowser(actor:RequestActor,request:Request) {
  const ownerId=assertHumanOwner(actor);
  const key=browserCookieKey(request);
  if(!/^[0-9a-f]{64}$/.test(key))throw new ApiError(401,"BROWSER_NOT_REGISTERED","등록되지 않은 브라우저입니다.");
  const {data,error}=await createServiceSupabase().from("os_ai_browsers").select("*")
    .eq("key_hash",hashBrowserKey(key)).eq("owner_id",ownerId).is("removed_at",null).maybeSingle();
  if(error)throw new ApiError(503,"BROWSER_CHECK_FAILED","브라우저 등록을 확인하지 못했습니다.");
  if(!data)throw new ApiError(401,"BROWSER_NOT_REGISTERED","등록되지 않은 브라우저입니다.");
  return data;
}
export async function registerBrowser(actor:RequestActor,name:string,userAgent:string,request:Request) {
  const ownerId=assertHumanOwner(actor);
  const existingKey=browserCookieKey(request);
  if(existingKey){
    let existing:Awaited<ReturnType<typeof getRegisteredBrowser>>|null=null;
    try{existing=await getRegisteredBrowser(actor,request);}
    catch(error){if(!(error instanceof ApiError&&error.status===401))throw error;}
    if(existing){
      const {data,error}=await createServiceSupabase().from("os_ai_browsers")
        .update({name:name.trim()}).eq("id",existing.id).eq("owner_id",ownerId).is("removed_at",null)
        .select("*").single();
      if(error||!data)throw new ApiError(503,"BROWSER_REGISTER_FAILED","브라우저 이름을 저장하지 못했습니다.");
      return {browser:data,key:existingKey};
    }
  }
  const key=randomBytes(32).toString("hex");
  const {data,error}=await createServiceSupabase().rpc("os_ai_register_browser",{
    p_owner:ownerId,p_name:name.trim(),
    p_os:/Windows/i.test(userAgent)?"Windows":/Mac OS/i.test(userAgent)?"macOS":"기타",
    p_key_hash:hashBrowserKey(key),
  });
  if(error||!data)throw new ApiError(503,"BROWSER_REGISTER_FAILED","브라우저를 등록하지 못했습니다.");
  return {browser:data,key};
}
export function makeBrowserCookie(key:string,maxAge=31_536_000) {
  return `ca_browser=${key}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
export function jobKey(ownerId:string,proc:string,targetId:string|null,sub:string) {
  return [ownerId,proc,targetId??"",sub].join(":");
}
export async function createJob(actor:RequestActor,input:{
  proc:AutomationProc;targetId?:string|null;sub?:string;fix?:string;rush?:boolean;
}) {
  const ownerId=assertHumanOwner(actor),db=createServiceSupabase();
  if(!AUTOMATION_PROCS.includes(input.proc))throw new ApiError(422,"INVALID_PROCESS","공정을 확인해 주세요.");
  const target=input.targetId?await getPersonalRecord(actor,input.targetId):null;
  const sub=input.sub??"";
  const shortformInput=target?shortformJobInput(target,input.proc,sub):null;
  if(!target&&["shorts-cut","shorts-desc"].includes(input.proc))throw new ApiError(422,"SHORTFORM_TARGET_REQUIRED","숏폼 카드를 먼저 선택해 주세요.");
  let open=db.from("os_records").select("*").eq("record_type","ai_job").eq("owner_id",ownerId)
    .eq("metadata->>space","personal").eq("metadata->>proc",input.proc)
    .eq("metadata->>sub",sub).in("status",["backlog","active"]).is("archived_at",null);
  open=input.targetId?open.eq("metadata->>targetId",input.targetId):open.is("metadata->>targetId",null);
  const {data:existing,error:readError}=await open.limit(1).maybeSingle();
  if(readError)throw new ApiError(503,"JOB_CHECK_FAILED","기존 작업을 확인하지 못했습니다.");
  if(existing){if(target)assertShortformJobCurrent(target,existing as OsRecord);return {job:existing as OsRecord,reused:true};}
  const {data:skill,error:skillError}=await db.from("os_records").select("id,version")
    .eq("record_type","skill").eq("owner_id",ownerId).eq("metadata->>space","personal")
    .eq("metadata->>process",input.proc).eq("metadata->>active","true")
    .is("archived_at",null).limit(1).maybeSingle();
  if(skillError)throw new ApiError(503,"SKILL_CHECK_FAILED","내 스킬을 확인하지 못했습니다.");
  const title=`${target?.title??"새 주제"} · ${input.proc}`.slice(0,240);
  const {data,error}=await db.from("os_records").insert({
    id:randomUUID(),record_type:"ai_job",title,description:"내 Chrome의 Claude in Chrome에서 처리할 초안 작업입니다.",
    status:"backlog",stage:"queued",priority:"normal",brand:target?.brand??"",parent_id:target?.id??null,
    due_date:target?.due_date??null,
    owner_id:ownerId,created_by:ownerId,updated_by:ownerId,
    metadata:{space:"personal",proc:input.proc,targetId:input.targetId??null,sub,
      fix:input.fix??"",rush:input.rush===true,attempt:0,
      skillId:skill?.id??null,skillVersion:skill?.version??null,
      createdVia:"automation-v07",...(shortformInput?{shortformInput,shortformInputKey:shortformInputKey(shortformInput)}:{})},
  }).select("*").single();
  if(error?.code==="23505") {
    let retryQuery=db.from("os_records").select("*").eq("record_type","ai_job").eq("owner_id",ownerId)
      .eq("metadata->>space","personal").eq("metadata->>proc",input.proc)
      .eq("metadata->>sub",sub).in("status",["backlog","active"]).is("archived_at",null);
    retryQuery=input.targetId?retryQuery.eq("metadata->>targetId",input.targetId):retryQuery.is("metadata->>targetId",null);
    const retry=await retryQuery.limit(1).maybeSingle();
    if(retry.data){if(target)assertShortformJobCurrent(target,retry.data as OsRecord);return {job:retry.data as OsRecord,reused:true};}
  }
  if(error||!data)throw new ApiError(503,"JOB_CREATE_FAILED","AI 작업을 대기열에 넣지 못했습니다.");
  return {job:data as OsRecord,reused:false};
}
export function orderedJobs(jobs:OsRecord[],rules:{order_by:string;long_only_now:boolean},via:"sched"|"now") {
  const order=AUTOMATION_PROCS as readonly string[];
  return jobs.filter(job=>via==="now"||!rules.long_only_now||!["shorts-cut","image"].includes(String(job.metadata.proc)))
    .sort((a,b)=>{
      const rush=Number(b.metadata.rush===true)-Number(a.metadata.rush===true);
      if(rush)return rush;
      if(rules.order_by==="due") {
        const due=(a.due_date??"9999-12-31").localeCompare(b.due_date??"9999-12-31");
        if(due)return due;
      }
      if(rules.order_by==="proc") {
        const proc=order.indexOf(String(a.metadata.proc))-order.indexOf(String(b.metadata.proc));
        if(proc)return proc;
      }
      return Number(a.metadata.jobNo??0)-Number(b.metadata.jobNo??0);
    });
}
