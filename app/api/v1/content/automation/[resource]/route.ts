import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { validatePersonalAsset,validatePersonalTemplate } from "@/lib/server/content-automation-validators";
import { kstScheduleDate,missedScheduleSlots,silentScheduleSlot } from "@/lib/content-automation-schedule";
import {
  assertHumanOwner,assertSameOrigin,AUTOMATION_CHANNELS,AUTOMATION_PROCS,
  createJob,createPersonalRecord,getPersonalRecord,getRunRules,listPersonalRecords,
  orderedJobs,validateRunRules,
} from "@/lib/server/content-automation-v07";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Params={params:Promise<{resource:string}>};
const uuid=z.string().uuid();
const topicSchema=z.object({
  title:z.string().trim().min(1).max(240),brand:z.string().trim().max(120).default(""),
  source:z.enum(["longform","comment","reference","ai","direct"]).default("direct"),
  sourceRef:z.string().max(2000).optional(),
}).strict();
const itemSchema=z.object({
  title:z.string().trim().min(1).max(240),channel:z.enum(AUTOMATION_CHANNELS),
  topicId:uuid,brand:z.string().trim().max(120).default(""),dueDate:z.string().date().optional(),
}).strict();
const jobSchema=z.object({
  proc:z.enum(AUTOMATION_PROCS),targetId:uuid.optional(),sub:z.string().trim().max(80).optional(),
  fix:z.string().trim().max(3000).optional(),rush:z.boolean().optional(),
}).strict();
const namedSchema=z.object({
  title:z.string().trim().min(1).max(240),description:z.string().max(20_000).default(""),
  metadata:z.record(z.unknown()).default({}),brand:z.string().trim().max(120).default(""),
}).strict();

function limitFrom(request:Request) {
  const limit=Number(new URL(request.url).searchParams.get("limit")??100);
  return Number.isFinite(limit)?Math.min(Math.max(Math.trunc(limit),1),500):100;
}
export async function GET(request:Request,{params}:Params) {
  try {
    const actor=await authenticateRequest(request),ownerId=assertHumanOwner(actor);
    const {resource}=await params,url=new URL(request.url),limit=limitFrom(request),db=createServiceSupabase();
    if(resource==="topics")return NextResponse.json({topics:await listPersonalRecords(actor,"content_topic",limit)});
    if(resource==="items"){
      const channel=url.searchParams.get("channel");
      if(channel&&!AUTOMATION_CHANNELS.includes(channel as typeof AUTOMATION_CHANNELS[number]))throw new ApiError(400,"INVALID_CHANNEL","채널을 확인해 주세요.");
      const items=await listPersonalRecords(actor,"content_publish",limit);
      return NextResponse.json({items:channel?items.filter(row=>row.metadata.channel===channel):items});
    }
    if(resource==="jobs"){
      const jobs=await listPersonalRecords(actor,"ai_job",limit);
      const rules=await getRunRules(ownerId);
      const status=url.searchParams.get("status");
      const filtered=status?jobs.filter(job=>job.status===status||job.stage===status):jobs;
      return NextResponse.json({jobs:orderedJobs(filtered,rules,"now")});
    }
    if(resource==="run-rules")return NextResponse.json({rules:await getRunRules(ownerId)});
    if(resource==="browsers"){
      const {data,error}=await db.from("os_ai_browsers").select("id,name,os,is_main,registered_at,last_run_at,login_expired_at,removed_at")
        .eq("owner_id",ownerId).is("removed_at",null).order("registered_at",{ascending:false});
      if(error)throw new ApiError(503,"BROWSERS_FAILED","등록한 컴퓨터를 확인하지 못했습니다.");
      return NextResponse.json({browsers:data??[]});
    }
    if(resource==="runs"){
      const {data,error}=await db.from("os_ai_runs").select("*").eq("owner_id",ownerId)
        .order("started_at",{ascending:false}).limit(limit);
      if(error)throw new ApiError(503,"RUNS_FAILED","실행 기록을 불러오지 못했습니다.");
      const now=new Date(),dayStart=new Date(`${kstScheduleDate(now)}T00:00:00+09:00`).toISOString();
      const [main,today]=await Promise.all([
        db.from("os_ai_browsers").select("id").eq("owner_id",ownerId).eq("is_main",true).is("removed_at",null).maybeSingle(),
        db.from("os_ai_runs").select("via,slot,started_at,browser_id").eq("owner_id",ownerId)
          .gte("started_at",dayStart).order("started_at",{ascending:false}).limit(1000),
      ]);
      if(main.error||today.error||today.data?.length===1000)throw new ApiError(503,"RUNS_FAILED","오늘 실행 기록을 확인하지 못했습니다.");
      const rules=await getRunRules(ownerId);
      const rows=today.data??[],missed=main.data?missedScheduleSlots(rules,rows,main.data.id,now):[];
      const synthetic=missed.map(({slot,at})=>({id:`missing:${kstScheduleDate(now)}:${slot}`,
        owner_id:ownerId,browser_id:main.data?.id??"",via:"sched",slot,started_at:at.toISOString(),
        ended_at:null,status:"missing",job_ids:[],done_count:0,blocked_count:0}));
      return NextResponse.json({runs:[...(data??[]),...synthetic].sort((a,b)=>b.started_at.localeCompare(a.started_at)).slice(0,limit),
        silent:main.data?Boolean(silentScheduleSlot(rules,rows,main.data.id,now)):false});
    }
    if(resource==="publications"){
      const {data,error}=await db.from("os_publication_log_v").select("*").eq("owner_id",ownerId)
        .order("at",{ascending:false}).limit(limit);
      if(error)throw new ApiError(503,"PUBLICATIONS_FAILED","발행 기록을 불러오지 못했습니다.");
      return NextResponse.json({publications:data??[]});
    }
    if(resource==="review-log"){
      const {data,error}=await db.from("os_content_review_log").select("*").eq("owner_id",ownerId)
        .order("created_at",{ascending:false}).limit(limit);
      if(error)throw new ApiError(503,"REVIEW_LOG_FAILED","확인 기록을 불러오지 못했습니다.");
      return NextResponse.json({reviews:data??[]});
    }
    if(resource==="comments"||resource==="metrics"){
      const items=await listPersonalRecords(actor,"content_publish",500);
      const ids=items.map(item=>item.id);
      if(!ids.length)return NextResponse.json({records:[]});
      const type=resource==="comments"?"content_comment":"content_metric";
      const {data,error}=await db.from("os_records").select("*").eq("record_type",type)
        .eq("owner_id",ownerId).eq("metadata->>space","personal").in("parent_id",ids).is("archived_at",null)
        .order("created_at",{ascending:false}).limit(limit);
      if(error)throw new ApiError(503,"AUTOMATION_LIST_FAILED","내 기록을 불러오지 못했습니다.");
      return NextResponse.json({records:data??[]});
    }
    const types={skills:"skill",templates:"content_package",assets:"content_asset"} as const;
    if(resource in types){
      const type=types[resource as keyof typeof types];
      const records=await listPersonalRecords(actor,type,limit);
      return NextResponse.json({records:type==="content_package"?records.filter(row=>row.metadata.packageKind==="cardnews_template_v2"):records});
    }
    throw new ApiError(404,"AUTOMATION_ROUTE_NOT_FOUND","찾을 수 없는 화면입니다.");
  }catch(error){return apiErrorResponse(error);}
}
export async function POST(request:Request,{params}:Params) {
  try {
    assertSameOrigin(request);
    const actor=await authenticateRequest(request);
    const {resource}=await params;
    const raw=await parseJson(request,250_000);
    if(resource==="topics"){
      const input=topicSchema.parse(raw);
      const topic=await createPersonalRecord(actor,"content_topic",{
        title:input.title,brand:input.brand,status:"draft",stage:"candidate",
        metadata:{source:input.source,sourceRef:input.sourceRef??"",brief:{},channels:[]},
      });
      return NextResponse.json({topic},{status:201});
    }
    if(resource==="items"){
      const input=itemSchema.parse(raw);
      await getPersonalRecord(actor,input.topicId,"content_topic");
      const ownerId=assertHumanOwner(actor);
      const db=createServiceSupabase();
      const existing=await db.from("os_records").select("*").eq("record_type","content_publish")
        .eq("owner_id",ownerId).eq("parent_id",input.topicId).eq("metadata->>space","personal")
        .eq("metadata->>channel",input.channel).is("archived_at",null).limit(1).maybeSingle();
      if(existing.error)throw new ApiError(503,"ITEM_CHECK_FAILED","기존 채널 콘텐츠를 확인하지 못했습니다.");
      if(existing.data)return NextResponse.json({item:existing.data,reused:true});
      const item=await createPersonalRecord(actor,"content_publish",{
        title:input.title,brand:input.brand,parentId:input.topicId,dueDate:input.dueDate,
        status:"draft",stage:"making",metadata:{channel:input.channel,step:0,pages:[],cuts:[],posts:[]},
      });
      return NextResponse.json({item,reused:false},{status:201});
    }
    if(resource==="jobs"){
      const input=jobSchema.parse(raw);
      const {job,reused}=await createJob(actor,input);
      return NextResponse.json({job,reused},{status:reused?200:201});
    }
    const types={skills:"skill",templates:"content_package",assets:"content_asset"} as const;
    if(resource in types){
      const type=types[resource as keyof typeof types],input=namedSchema.parse(raw);
      const metadata={...input.metadata};
      if(type==="skill"){
        if(!AUTOMATION_PROCS.includes(metadata.process as typeof AUTOMATION_PROCS[number])
          ||typeof metadata.slug!=="string"||!/^([a-z0-9]+)(-[a-z0-9]+)*$/.test(metadata.slug))
          throw new ApiError(422,"SKILL_FIELDS_INVALID","공정과 영문 소문자 스킬 이름을 확인해 주세요.");
        metadata.active=false;
      }
      if(type==="content_package")metadata.packageKind="cardnews_template_v2";
      if(type==="content_asset")validatePersonalAsset(metadata,assertHumanOwner(actor));
      if(type==="content_package")validatePersonalTemplate(metadata,assertHumanOwner(actor));
      const record=await createPersonalRecord(actor,type,{title:input.title,description:input.description,
        brand:input.brand,metadata,status:type==="skill"?"draft":"ready"});
      return NextResponse.json({record},{status:201});
    }
    throw new ApiError(404,"AUTOMATION_ROUTE_NOT_FOUND","찾을 수 없는 화면입니다.");
  }catch(error){
    if(error instanceof ZodError)return apiErrorResponse(new ApiError(422,"AUTOMATION_INPUT_INVALID","입력값을 확인해 주세요.",error.flatten()));
    return apiErrorResponse(error);
  }
}
export async function PUT(request:Request,{params}:Params) {
  try {
    assertSameOrigin(request);
    const actor=await authenticateRequest(request),ownerId=assertHumanOwner(actor);
    const {resource}=await params;
    if(resource!=="run-rules")throw new ApiError(405,"METHOD_NOT_ALLOWED","이 화면에서는 저장할 수 없습니다.");
    const raw=await parseJson(request,30_000);
    const input=validateRunRules(z.record(z.unknown()).parse(raw));
    const allowed=["enabled","days","times","per_run","daily_max","order_by","long_only_now",
      "grace_minutes","lease_minutes","notify","defaults"] as const;
    if(Object.keys(input).some(key=>!allowed.includes(key as typeof allowed[number])))
      throw new ApiError(422,"INVALID_RUN_RULES","실행 규칙에 알 수 없는 값이 있습니다.");
    const rules={...Object.fromEntries(allowed.filter(key=>key in input).map(key=>[key,input[key]])),
      owner_id:ownerId,updated_at:new Date().toISOString()};
    const {data,error}=await createServiceSupabase().from("os_ai_run_rules").upsert(rules,{onConflict:"owner_id"}).select("*").single();
    if(error||!data)throw new ApiError(503,"RUN_RULES_SAVE_FAILED","실행 규칙을 저장하지 못했습니다.");
    return NextResponse.json({rules:data});
  }catch(error){
    if(error instanceof ZodError)return apiErrorResponse(new ApiError(422,"AUTOMATION_INPUT_INVALID","입력값을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
