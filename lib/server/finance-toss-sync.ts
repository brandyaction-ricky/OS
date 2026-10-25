import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { date,uuid } from "@/lib/finance/schema";
import { tossProvider,tossSyncIdentity,tossConnection } from "@/lib/finance/toss/provider";
import { collectTossSyncPage,publicSyncRun,type TossSyncRun } from "@/lib/finance/toss/sync";
import { createServiceSupabase } from "@/lib/supabase/server";
import { SUPABASE_URL } from "@/lib/config";
import { financeActor,financeDbError,financeJson } from "./finance";

const begin=z.object({action:z.literal("begin"),from:date,to:date}).strict().refine(v=>{
  const days=(Date.parse(v.to)-Date.parse(v.from))/86400000;
  return days>=0&&days<=30&&v.to<=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"});
},"수집 기간은 오늘까지 최대 31일로 설정해 주세요.");
const command=z.union([begin,z.object({action:z.enum(["step","abandon"]),runId:uuid}).strict()]);
const statusColumns="id,date_from,date_to,mode,state,phase,page_count,transaction_count,payment_count,cancel_count,settlement_count,skipped_count,updated_at,completed_at,last_error_code";
function enabled(){return process.env.FINANCE_TOSS_SYNC_ENABLED==="true";}
function checkDatabaseTarget(){
  // Activation must name the approved database, rather than silently inheriting
  // a Preview/Production misconfiguration. Never return project refs or URLs.
  const ref=process.env.FINANCE_TOSS_SYNC_PROJECT_REF;
  let actual="";try{actual=new URL(SUPABASE_URL).hostname;}catch{}
  if(!ref||!(/^[a-z]{20}$/).test(ref)||actual!==`${ref}.supabase.co`)
    throw new ApiError(409,"TOSS_SYNC_DATABASE_TARGET","승인된 원장 데이터베이스 설정을 확인해 주세요. 수집하지 않았습니다.");
}
function syncError(error:{code?:string;message?:string}):never{
  const code=error.message??"";
  if(code.includes("FINANCE_FORBIDDEN"))throw new ApiError(403,"FINANCE_FORBIDDEN","현재 재무관리 권한이 없습니다.");
  if(code.includes("TOSS_SYNC_BINDING"))throw new ApiError(409,"TOSS_SYNC_BINDING","기존 원장과 상점·실행 환경이 달라 수집을 중단했습니다. 관리자 확인이 필요합니다.");
  if(code.includes("TOSS_SYNC_ACTIVE"))throw new ApiError(409,"TOSS_SYNC_ACTIVE","진행 중인 기간을 먼저 완료하거나 수집을 종료해 주세요.");
  if(code.includes("TOSS_SYNC_BUSY")||code.includes("TOSS_SYNC_LEASE"))throw new ApiError(409,"TOSS_SYNC_BUSY","다른 수집 요청이 처리 중입니다. 잠시 후 상태를 확인해 주세요.");
  if(code.includes("TOSS_SYNC_STALE"))throw new ApiError(409,"TOSS_SYNC_STALE","기존 거래와 다른 응답을 받아 저장하지 않았습니다. 관리자 확인이 필요합니다.");
  if(code.includes("TOSS_SYNC_NOT_FOUND")||code.includes("TOSS_SYNC_FINISHED"))throw new ApiError(409,"TOSS_SYNC_FINISHED","수집 상태가 변경되었습니다. 상태를 새로 확인해 주세요.");
  financeDbError(error);
}
export async function readTossSync(request:Request){
  await financeActor(request);
  if(new URL(request.url).search)throw new ApiError(400,"TOSS_SYNC_INVALID","지원하지 않는 조회 조건입니다.");
  const connection=tossConnection("edu");
  if(!enabled())return {enabled:false,connection,run:null};
  tossSyncIdentity("edu"); // Enforce environment gate before creating a privileged client.
  checkDatabaseTarget();
  const {data,error}=await createServiceSupabase().from("os_fin_toss_sync_runs").select(statusColumns).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error)syncError(error);
  return {enabled:true,connection,run:data?publicSyncRun(data as TossSyncRun):null};
}
export async function writeTossSync(request:Request){
  const actor=await financeActor(request);
  if(!enabled())throw new ApiError(409,"TOSS_SYNC_DISABLED","원장 수집은 아직 활성화되지 않았습니다. 환경별 검수·승인 후 사용해 주세요.");
  const input=command.parse(await financeJson(request));
  const identity=tossSyncIdentity("edu");
  checkDatabaseTarget();
  const db=createServiceSupabase();
  const rpc=async(action:string,args:Record<string,unknown>={})=>{
    const {data,error}=await db.rpc("os_fin_toss_sync",{p_action:action,p_actor:actor.id,p_mode:identity.mode,p_binding:identity.binding,...args});
    if(error)syncError(error);
    if(!data)throw new ApiError(502,"TOSS_SYNC_NO_STATE","수집 상태를 확인하지 못했습니다. 상태를 새로 확인해 주세요.");
    return data as TossSyncRun;
  };
  if(input.action==="begin")return {run:publicSyncRun(await rpc("begin",{p_from:input.from,p_to:input.to})),persisted:false};
  if(input.action==="abandon")return {run:publicSyncRun(await rpc("abandon",{p_run:input.runId})),persisted:false};
  const lease=randomUUID();
  const run=await rpc("claim",{p_run:input.runId,p_lease:lease});
  try{
    // Overall deadline leaves room to commit/fail before the 120s route / 150s lease.
    const provider=tossProvider("edu",process.env,fetch,AbortSignal.timeout(90000));
    const payload=await collectTossSyncPage(run,provider);
    return {run:publicSyncRun(await rpc("commit",{p_run:run.id,p_lease:lease,p_payload:payload})),persisted:true};
  }catch(error){
    // A failed page never advances its cursor. If commit succeeded but its response
    // was lost, lease CAS makes this cleanup a no-op rather than undoing that commit.
    try{await rpc("fail",{p_run:run.id,p_lease:lease});}catch{console.error("finance toss sync page cleanup incomplete");}
    throw error;
  }
}

// Daily automatic collection for each business store, run by the cron route. It reuses the
// same database steps as the manual 원장 수집 (begin → claim → collect one page → commit),
// resumes an unfinished run, and stops before the deadline so the next run continues.
type Biz="edu"|"myin";
const kstDay=(offsetDays=0)=>new Date(Date.now()+offsetDays*86_400_000).toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"});
const addDays=(day:string,days:number)=>new Date(Date.parse(`${day}T00:00:00Z`)+days*86_400_000).toISOString().slice(0,10);
export async function dailyTossSync(biz:Biz,deadline:number){
  if(!enabled())return {biz,skipped:"sync_disabled"};
  if(!tossConnection(biz).configured)return {biz,skipped:"not_configured"};
  const identity=tossSyncIdentity(biz);
  checkDatabaseTarget();
  const db=createServiceSupabase();
  const {data:store}=await db.from("os_fin_stores").select("id,created_by,settlement_cursor").eq("biz",biz).maybeSingle();
  // The database accepts only an active admin or finance member as the actor: the person who
  // set up this store when still allowed, otherwise the first such member.
  const {data:people,error:peopleError}=await db.from("os_profiles").select("id,role,finance_access,is_active").eq("is_active",true).order("id");
  if(peopleError)financeDbError(peopleError);
  const allowed=(people??[]).filter(p=>p.role==="admin"||p.finance_access);
  const actor=allowed.find(p=>p.id===store?.created_by)??allowed[0];
  if(!actor)return {biz,skipped:"no_finance_actor"};
  const rpc=async(action:string,args:Record<string,unknown>={})=>{
    const {data,error}=await db.rpc("os_fin_toss_sync",{p_action:action,p_actor:actor.id,p_mode:identity.mode,p_binding:identity.binding,p_biz:biz,...args});
    if(error)syncError(error);
    return data as TossSyncRun;
  };
  const yesterday=kstDay(-1);
  let run:TossSyncRun|null=null;
  if(store){
    const {data}=await db.from("os_fin_toss_sync_runs").select("*").eq("store_id",store.id).eq("state","running").maybeSingle();
    run=data as TossSyncRun|null;
  }
  if(!run){
    // Resume after the last fully collected day (both phases), re-reading the three days before
    // it for late cancellations; a new store starts at the first of this month. At most 31 days.
    const done=(store?.settlement_cursor as {to?:string}|null)?.to;
    const from=done?addDays(done,-2):`${yesterday.slice(0,7)}-01`;
    const to=[yesterday,addDays(from,30)].sort()[0];
    if(from>to)return {biz,skipped:"up_to_date"};
    run=await rpc("begin",{p_from:from,p_to:to});
  }
  const provider=tossProvider(biz,process.env,fetch,AbortSignal.timeout(Math.max(5_000,deadline-Date.now())));
  let pages=0;
  while(run.state==="running"&&Date.now()<deadline-15_000){
    const lease=randomUUID();
    run=await rpc("claim",{p_run:run.id,p_lease:lease});
    try{run=await rpc("commit",{p_run:run.id,p_lease:lease,p_payload:await collectTossSyncPage(run,provider)});pages++;}
    catch(error){try{await rpc("fail",{p_run:run.id,p_lease:lease});}catch{console.error("finance toss daily sync cleanup incomplete");}throw error;}
  }
  return {biz,run:publicSyncRun(run),pages};
}
