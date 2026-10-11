import { ApiError } from "@/lib/http";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import { parseAutomationResult,RESULT_EXAMPLES } from "@/lib/content-automation-results";
import { enqueueAutomationNotification } from "@/lib/server/content-automation-notifications";
import type { RequestActor } from "./auth";
import {
  assertHumanOwner,AUTOMATION_PROCS,getPersonalRecord,getRegisteredBrowser,
  getRunRules,listPersonalRecords,orderedJobs,updatePersonalRecord,
} from "./content-automation-v07";

export type WorkerVia="sched"|"now";
const db=()=>createServiceSupabase();
const stamp=()=>new Date().toISOString();
function kstDayStart(){
  const today=new Date(Date.now()+9*3_600_000).toISOString().slice(0,10);
  return new Date(`${today}T00:00:00+09:00`).toISOString();
}
function nearestSlot(times:string[]){
  const hhmm=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Seoul",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date());
  const minutes=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3,5));
  return [...times].sort((a,b)=>Math.abs(minutes(a)-minutes(hhmm))-Math.abs(minutes(b)-minutes(hhmm)))[0]??null;
}
async function activeRun(ownerId:string,browserId:string,runId:string){
  const {data,error}=await db().from("os_ai_runs").select("*").eq("id",runId).eq("owner_id",ownerId)
    .eq("browser_id",browserId).eq("status","running").maybeSingle();
  if(error)throw new ApiError(503,"RUN_READ_FAILED","실행 기록을 확인하지 못했습니다.");
  if(!data)throw new ApiError(409,"RUN_NOT_ACTIVE","현재 실행을 찾을 수 없습니다.");
  return data;
}
async function startRun(ownerId:string,browserId:string,via:WorkerVia,slot:string|null){
  const now=stamp(),store=db();
  const {error:abandonError}=await store.from("os_ai_runs").update({status:"abandoned",ended_at:now})
    .eq("owner_id",ownerId).eq("browser_id",browserId).eq("status","running");
  if(abandonError)throw new ApiError(503,"RUN_START_FAILED","이전 실행을 닫지 못했습니다.");
  const {data,error}=await store.from("os_ai_runs").insert({
    owner_id:ownerId,browser_id:browserId,via,slot,started_at:now,status:"running",
  }).select("*").single();
  if(error||!data)throw new ApiError(503,"RUN_START_FAILED","실행을 시작하지 못했습니다.");
  await store.from("os_ai_browsers").update({last_run_at:now}).eq("id",browserId).eq("owner_id",ownerId);
  return data;
}
async function dailyTaken(ownerId:string){
  const {data,error}=await db().from("os_ai_runs").select("job_ids").eq("owner_id",ownerId)
    .gte("started_at",kstDayStart()).limit(100);
  if(error)throw new ApiError(503,"RUN_COUNT_FAILED","오늘 실행량을 확인하지 못했습니다.");
  return (data??[]).reduce((total,row)=>total+(row.job_ids?.length??0),0);
}
async function pendingCount(actor:RequestActor,via:WorkerVia){
  const jobs=(await listPersonalRecords(actor,"ai_job",500)).filter(row=>row.status==="backlog"&&row.stage==="queued");
  const rules=await getRunRules(actor.ownerId);
  return orderedJobs(jobs,rules,via).length;
}
export async function workerState(actor:RequestActor,request:Request,via:WorkerVia|null){
  const ownerId=assertHumanOwner(actor),browser=await getRegisteredBrowser(actor,request);
  const rules=await getRunRules(ownerId);
  if(via==="sched"&&(!browser.is_main||!rules.enabled))
    throw new ApiError(403,"SCHEDULED_BROWSER_UNAVAILABLE","예약 실행은 켜진 메인 컴퓨터에서만 가능합니다.");
  const run=via==="sched"?await startRun(ownerId,browser.id,via,nearestSlot(rules.times)):null;
  return {browser:{id:browser.id,name:browser.name,registeredAt:browser.registered_at,isMain:browser.is_main},
    rules,run,pending:await pendingCount(actor,via??"now"),todayTaken:await dailyTaken(ownerId)};
}
export async function reclaimExpiredJobs(actor:RequestActor){
  const jobs=(await listPersonalRecords(actor,"ai_job",500)).filter(row=>row.status==="active"&&row.stage==="running"
    &&row.metadata.via!=="copy"&&typeof row.metadata.leaseExpiresAt==="string"
    &&Date.parse(row.metadata.leaseExpiresAt)<Date.now());
  for(const job of jobs){
    const attempt=Number(job.metadata.attempt??0)+1;
    const blocked=attempt>Number(job.metadata.retryLimit??2);
    try{await updatePersonalRecord(actor,job,{status:blocked?"blocked":"backlog",stage:blocked?"failed":"queued",
      metadata:{...job.metadata,attempt,rush:false,runId:null,browserId:null,claimedAt:null,
        leaseExpiresAt:null,...(blocked?{failureCode:"lease_expired",failureReason:"처리 시간 초과"}:{}),space:"personal"}});}
    catch(error){if(!(error instanceof ApiError&&error.status===409))throw error;}
  }
}
async function jobInstructions(actor:RequestActor,job:OsRecord){
  const proc=String(job.metadata.proc);
  const targetId=typeof job.metadata.targetId==="string"?job.metadata.targetId:null;
  let target:OsRecord|null=null;
  if(targetId){try{target=await getPersonalRecord(actor,targetId);}catch{target=null;}}
  let skill:{id:string;version:number;title:string;slug:string;body:string}|null=null;
  const skillId=typeof job.metadata.skillId==="string"?job.metadata.skillId:null;
  const skillVersion=Number(job.metadata.skillVersion);
  if(skillId&&Number.isInteger(skillVersion)){
    const {data,error}=await db().from("os_record_events").select("snapshot")
      .eq("record_id",skillId).eq("snapshot->>version",String(skillVersion))
      .order("id",{ascending:false}).limit(1).maybeSingle();
    if(error)throw new ApiError(503,"SKILL_VERSION_FAILED","작업에 붙은 스킬 버전을 확인하지 못했습니다.");
    const snapshot=data?.snapshot as {title?:string;description?:string;owner_id?:string;metadata?:Record<string,unknown>}|undefined;
    if(snapshot?.owner_id===actor.ownerId)skill={id:skillId,version:skillVersion,
      title:snapshot.title??"내 스킬",slug:String(snapshot.metadata?.slug??""),body:snapshot.description??""};
  }
  return {target:target?{id:target.id,title:target.title,version:target.version,
    brand:target.brand,dueDate:target.due_date,brief:target.metadata.brief??null,
    channel:target.metadata.channel??null,pages:target.metadata.pages??null}:null,
    instructions:`내 작업만 처리합니다. 공정: ${proc}. ${target?.title??"주제 후보"} · 고칠 점: ${String(job.metadata.fix??"없음")}. 승인·예약·게시·삭제하지 마세요.`,
    skill:skill??{id:"",version:0,title:"기본 절차",slug:"",body:"근거를 확인하고 결과 형식에 맞는 초안을 작성합니다."},
    resultFormat:RESULT_EXAMPLES[proc as keyof typeof RESULT_EXAMPLES]??"{}"};
}
export async function workerNext(actor:RequestActor,request:Request,input:{via:WorkerVia;runId?:string}){
  const ownerId=assertHumanOwner(actor),browser=await getRegisteredBrowser(actor,request),rules=await getRunRules(ownerId);
  if(input.via==="sched"&&(!browser.is_main||!rules.enabled))
    throw new ApiError(403,"SCHEDULED_BROWSER_UNAVAILABLE","예약 실행은 켜진 메인 컴퓨터에서만 가능합니다.");
  await reclaimExpiredJobs(actor);
  let run=input.runId?await activeRun(ownerId,browser.id,input.runId):null;
  if(!run&&input.via==="now")run=await startRun(ownerId,browser.id,"now",null);
  if(!run)throw new ApiError(409,"RUN_NOT_ACTIVE","예약 실행 화면을 다시 열어 주세요.");
  if(run.via!==input.via)throw new ApiError(409,"RUN_VIA_CHANGED","실행 방법이 일치하지 않습니다.");
  if(run.job_ids.length>=rules.per_run)return {end:true,reason:"per_run",runId:run.id,remaining:await pendingCount(actor,input.via)};
  if(await dailyTaken(ownerId)>=rules.daily_max)return {end:true,reason:"daily_max",runId:run.id,remaining:await pendingCount(actor,input.via)};
  const candidates=orderedJobs((await listPersonalRecords(actor,"ai_job",500))
    .filter(row=>row.status==="backlog"&&row.stage==="queued"),rules,input.via);
  for(const candidate of candidates){
    const {data,error}=await db().rpc("os_ai_claim_job",{
      p_owner:ownerId,p_browser:browser.id,p_run:run.id,p_job:candidate.id,
      p_expected_version:candidate.version,p_via:input.via,
    });
    if(error?.code==="PT409"&&error.message==="PER_RUN_LIMIT")
      return {end:true,reason:"per_run",runId:run.id,remaining:await pendingCount(actor,input.via)};
    if(error?.code==="PT409"&&error.message==="DAILY_LIMIT")
      return {end:true,reason:"daily_max",runId:run.id,remaining:await pendingCount(actor,input.via)};
    if(error)throw new ApiError(503,"JOB_CLAIM_FAILED","작업을 가져오지 못했습니다.");
    if(!data)continue;
    return {end:false,runId:run.id,job:data as OsRecord,...await jobInstructions(actor,data as OsRecord),
      remaining:Math.max(candidates.length-1,0),todayTaken:await dailyTaken(ownerId)};
  }
  return {end:true,reason:"empty",runId:run.id,remaining:0};
}
export async function workerCompleteJob(actor:RequestActor,request:Request,input:{
  runId:string;jobId:string;result?:unknown;reason?:string;failed:boolean;
}){
  const ownerId=assertHumanOwner(actor),browser=await getRegisteredBrowser(actor,request);
  const run=await activeRun(ownerId,browser.id,input.runId);
  if(!run.job_ids.includes(input.jobId))throw new ApiError(409,"JOB_RUN_MISMATCH","이번 실행의 작업이 아닙니다.");
  const job=await getPersonalRecord(actor,input.jobId,"ai_job");
  if(job.status!=="active"||job.stage!=="running"||job.metadata.runId!==run.id||job.metadata.browserId!==browser.id)
    throw new ApiError(409,"JOB_RUN_MISMATCH","이 브라우저가 가져간 작업이 아닙니다.");
  const proc=String(job.metadata.proc);
  if(!AUTOMATION_PROCS.includes(proc as typeof AUTOMATION_PROCS[number]))
    throw new ApiError(422,"JOB_PROCESS_INVALID","작업 공정을 확인해 주세요.");
  if(input.failed&&!String(input.reason??"").trim())throw new ApiError(422,"JOB_REASON_REQUIRED","못 한 이유를 입력해 주세요.");
  const result=input.failed?null:parseAutomationResult(proc as typeof AUTOMATION_PROCS[number],input.result);
  const {data,error}=await db().rpc("os_ai_complete_job",{
    p_owner:ownerId,p_browser:browser.id,p_run:run.id,p_job:job.id,
    p_expected_version:job.version,p_failed:input.failed,p_result:result,p_reason:input.reason??null,
  });
  if(error?.code==="PT409")throw new ApiError(409,"JOB_RUN_MISMATCH","현재 작업이 변경됐습니다. 새로 불러와 주세요.");
  if(error||!data)throw new ApiError(503,"JOB_COMPLETE_FAILED","작업 결과를 저장하지 못했습니다.");
  if(!input.failed)try{
    const rules=await getRunRules(ownerId);
    if(rules.notify){
      await enqueueAutomationNotification({ownerId,sourceType:"record",sourceId:job.id,
        reason:"ai_result",dedupeKey:`result:${job.id}:${data.version}`});
    }
  }catch{/* The completed draft must remain a success if notification delivery is unavailable. */}
  return data as OsRecord;
}
export async function workerFinish(actor:RequestActor,request:Request,runId:string){
  const ownerId=assertHumanOwner(actor),browser=await getRegisteredBrowser(actor,request);
  const run=await activeRun(ownerId,browser.id,runId);
  const {count,error:activeError}=await db().from("os_records").select("id",{count:"exact",head:true})
    .eq("record_type","ai_job").eq("owner_id",ownerId).eq("metadata->>space","personal")
    .eq("metadata->>runId",run.id).eq("status","active").is("archived_at",null);
  if(activeError)throw new ApiError(503,"RUN_CHECK_FAILED","처리 중 작업을 확인하지 못했습니다.");
  if(count)throw new ApiError(409,"RUN_JOB_ACTIVE","처리 중인 작업을 제출하거나 못 함으로 남긴 뒤 끝내 주세요.");
  const {data,error}=await db().from("os_ai_runs").update({
    status:run.job_ids.length?"done":"empty",ended_at:stamp(),
  }).eq("id",run.id).eq("owner_id",ownerId).eq("browser_id",browser.id).eq("status","running").select("*").maybeSingle();
  if(error||!data)throw new ApiError(503,"RUN_FINISH_FAILED","실행을 끝내지 못했습니다.");
  return data;
}
