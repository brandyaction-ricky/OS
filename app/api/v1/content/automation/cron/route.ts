import { NextResponse } from "next/server";
import { ApiError,apiErrorResponse } from "@/lib/http";
import { safeSecretMatch } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { kstScheduleDate,silentScheduleSlot } from "@/lib/content-automation-schedule";
import { enqueueAutomationNotification } from "@/lib/server/content-automation-notifications";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;

export async function GET(request:Request){
  try{
    const expected=process.env.CRON_SECRET??"";
    const received=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"";
    if(!expected||!safeSecretMatch(received,expected))
      throw new ApiError(401,"INVALID_CRON_SECRET","예약 작업 인증에 실패했습니다.");
    const service=createServiceSupabase(),now=new Date();
    const old=new Date(now.getTime()-3*3_600_000).toISOString();
    const abandoned=await service.from("os_ai_runs").update({status:"abandoned",ended_at:now.toISOString()})
      .eq("status","running").lt("started_at",old);
    if(abandoned.error)throw new ApiError(503,"AUTOMATION_CRON_FAILED","오래 열린 실행을 확인하지 못했습니다.");
    const {data:rules,error:rulesError}=await service.from("os_ai_run_rules")
      .select("owner_id,enabled,days,times,grace_minutes,notify,defaults").limit(1000);
    if(rulesError||!rules)throw new ApiError(503,"AUTOMATION_CRON_FAILED","실행 규칙을 확인하지 못했습니다.");
    if(rules.length===1000)throw new ApiError(503,"AUTOMATION_CRON_PAGE_REQUIRED","실행 규칙이 한 페이지를 넘어 처리하지 못했습니다.");
    const {data:due,error:dueError}=await service.from("os_records")
      .select("id,owner_id,starts_at")
      .eq("record_type","content_publish").eq("metadata->>space","personal")
      .eq("status","scheduled").is("archived_at",null)
      .gte("starts_at",new Date(now.getTime()-7*86400000).toISOString())
      .lte("starts_at",new Date(now.getTime()+7*86400000).toISOString()).limit(1000);
    if(dueError||!due||due.length===1000)throw new ApiError(503,"AUTOMATION_CRON_FAILED","게시 예정 기록을 확인하지 못했습니다.");
    let publishNotified=0;
    for(const post of due){
      if(!post.owner_id||!post.starts_at)continue;
      const rule=rules.find(row=>row.owner_id===post.owner_id);
      if(rule?.notify===false)continue;
      const value=Number((rule?.defaults as {leadMinutes?:number}|null)?.leadMinutes??30);
      const lead=Number.isFinite(value)?Math.max(0,Math.min(value,10080)):30;
      const starts=Date.parse(post.starts_at),phase=starts<=now.getTime()?"at":lead>0&&starts<=now.getTime()+lead*60000?"lead":null;
      if(!phase)continue;
      await enqueueAutomationNotification({ownerId:post.owner_id,sourceType:"record",sourceId:post.id,
        reason:"publish_due",dedupeKey:`publish:${post.id}:${post.starts_at}:${phase}`});
      publishNotified++;
    }
    if(!rules.length)return NextResponse.json({ok:true,checked:0,silent:0,notified:publishNotified});
    const owners=rules.filter(row=>row.enabled).map(row=>row.owner_id);
    if(!owners.length)return NextResponse.json({ok:true,checked:rules.length,silent:0,notified:publishNotified});
    const dayStart=new Date(`${kstScheduleDate(now)}T00:00:00+09:00`).toISOString();
    const [browserResult,runResult]=await Promise.all([
      service.from("os_ai_browsers").select("id,owner_id").in("owner_id",owners)
        .eq("is_main",true).is("removed_at",null),
      service.from("os_ai_runs").select("owner_id,browser_id,via,slot,started_at")
        .in("owner_id",owners).gte("started_at",dayStart).order("started_at",{ascending:false}).limit(10000),
    ]);
    if(browserResult.error||runResult.error||!browserResult.data||!runResult.data||runResult.data.length===10000)
      throw new ApiError(503,"AUTOMATION_CRON_FAILED","컴퓨터 실행 기록을 확인하지 못했습니다.");
    let silent=0,notified=publishNotified;
    for(const rule of rules){
      if(!rule.enabled)continue;
      const browser=browserResult.data.find(row=>row.owner_id===rule.owner_id);
      if(!browser)continue;
      const slot=silentScheduleSlot(rule,runResult.data.filter(row=>row.owner_id===rule.owner_id),browser.id,now);
      if(!slot)continue;
      silent+=1;
      if(!rule.notify)continue;
      await enqueueAutomationNotification({ownerId:rule.owner_id,sourceType:"browser",sourceId:browser.id,
        reason:"computer_silent",dedupeKey:`silent:${kstScheduleDate(now)}:${slot.slot}`});
      notified+=1;
    }
    return NextResponse.json({ok:true,checked:rules.length,silent,notified});
  }catch(error){return apiErrorResponse(error);}
}
