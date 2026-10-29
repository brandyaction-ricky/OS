import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { validatePersonalAsset,validatePersonalTemplate } from "@/lib/server/content-automation-validators";
import { kstScheduleDate,missedScheduleSlots,silentScheduleSlot,upcomingScheduleSlots } from "@/lib/content-automation-schedule";
import { automationCsv,automationExportRange,formatKstCsvDate,type AutomationExportPeriod } from "@/lib/content-automation-csv";
import { assertThreadsReferencesReady,parseThreadsReferences,threadsReferenceItemsSchema,THREADS_REFERENCE_KIND,THREADS_REFERENCE_WORKFLOW,validateThreadsTopicMetadata } from "@/lib/threads-reference";
import { getThreadsJobInput,threadsCollectionContext,threadsReferenceRequestId,assertThreadsEditorialReady } from "@/lib/server/threads-reference";
import {
  assertHumanOwner,assertSameOrigin,AUTOMATION_CHANNELS,AUTOMATION_PROCS,
  createJob,createPersonalRecord,getPersonalRecord,getRunRules,isContentReviewer,listPersonalRecords,
  listTeamItems,memberNames,orderedJobs,validateRunRules,
} from "@/lib/server/content-automation-v07";

import { THREADS_EDITORIAL_WORKFLOW, THREADS_EDITORIAL_CANON_MIN_VERSION, threadsEditorialRouteSchema, threadsEditorialMaterialSchema, parseThreadsEditorialMetadata } from "@/lib/threads-editorial";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Params={params:Promise<{resource:string}>};
const uuid=z.string().uuid();
const topicSchema=z.object({
  title:z.string().trim().min(1).max(240),brand:z.string().trim().max(120).default(""),
  source:z.enum(["longform","comment","reference","ai","direct"]).default("direct"),
  sourceRef:z.string().max(2000).optional(),
  kind:z.literal(THREADS_REFERENCE_KIND).optional(),
  editorial_workflow:z.enum([THREADS_REFERENCE_WORKFLOW,THREADS_EDITORIAL_WORKFLOW]).optional(),
  editorial_route:threadsEditorialRouteSchema.optional(),editorial_material:threadsEditorialMaterialSchema.optional(),
  reference_items:threadsReferenceItemsSchema.optional(),
  referenceIds:z.array(uuid).min(1).max(20).optional(),
  sourceJobId:uuid.optional(),candidateIndex:z.number().int().min(0).max(9).optional(),
  // Same value on a retry (double click, slow response, an automation run re-sending a candidate) returns the same topic.
  requestId:z.string().regex(/^[A-Za-z0-9:_-]{8,200}$/).optional(),
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
const EXPORT_BATCH=500,EXPORT_MAX=5000;
function exportParams(url:URL){
  const period=url.searchParams.get("period")??"month";
  if(!["today","week","month","last","all"].includes(period))
    throw new ApiError(400,"INVALID_EXPORT_PERIOD","내려받을 기간을 확인해 주세요.");
  return automationExportRange(period as AutomationExportPeriod);
}
function csvResponse(filename:string,headers:readonly string[],rows:readonly (readonly unknown[])[]){
  return new Response(automationCsv(headers,rows),{headers:{
    "Content-Type":"text/csv; charset=utf-8",
    "Content-Disposition":`attachment; filename="${filename}"`,
    "Cache-Control":"private, no-store",
    "X-Content-Type-Options":"nosniff",
  }});
}
async function exportRuns(ownerId:string,url:URL){
  const range=exportParams(url),db=createServiceSupabase(),runs:Record<string,unknown>[]=[];
  const method=url.searchParams.get("method")??"all";
  if(!["all","sched","now","missing"].includes(method))
    throw new ApiError(400,"INVALID_EXPORT_FILTER","실행 방법을 확인해 주세요.");
  for(let offset=0;method!=="missing"&&offset<=EXPORT_MAX;offset+=EXPORT_BATCH){
    let query=db.from("os_ai_runs").select("*").eq("owner_id",ownerId)
      .order("started_at",{ascending:false}).range(offset,offset+EXPORT_BATCH-1);
    if(method==="sched"||method==="now")query=query.eq("via",method);
    if(range.start)query=query.gte("started_at",range.start);
    if(range.end)query=query.lt("started_at",range.end);
    const {data,error}=await query;
    if(error)throw new ApiError(503,"RUNS_EXPORT_FAILED","실행 기록을 내려받지 못했습니다.");
    runs.push(...(data??[]));
    if(runs.length>EXPORT_MAX)throw new ApiError(413,"EXPORT_TOO_LARGE","내려받을 기록이 많습니다. 기간을 좁혀 주세요.");
    if((data??[]).length<EXPORT_BATCH)break;
  }
  const {data:browsers,error:browserError}=await db.from("os_ai_browsers")
    .select("id,name,is_main,removed_at").eq("owner_id",ownerId);
  if(browserError)throw new ApiError(503,"RUNS_EXPORT_FAILED","컴퓨터 이름을 확인하지 못했습니다.");
  const names=new Map((browsers??[]).map(browser=>[browser.id,browser.name]));
  const today=kstScheduleDate(new Date()),todayStart=new Date(`${today}T00:00:00+09:00`).toISOString();
  const main=(browsers??[]).find(browser=>browser.is_main&&!browser.removed_at);
  if((method==="all"||method==="missing")&&(!range.end||range.end>todayStart)&&main){
    const {data:todayRuns,error}=await db.from("os_ai_runs")
      .select("via,slot,started_at,browser_id").eq("owner_id",ownerId)
      .gte("started_at",todayStart).order("started_at",{ascending:false}).limit(1000);
    if(error||todayRuns?.length===1000)throw new ApiError(503,"RUNS_EXPORT_FAILED","오늘 예약 실행을 확인하지 못했습니다.");
    const rules=await getRunRules(ownerId);
    for(const missing of missedScheduleSlots(rules,todayRuns??[],main.id,new Date())){
      const started_at=missing.at.toISOString();
      if((!range.start||started_at>=range.start)&&(!range.end||started_at<range.end))
        runs.push({started_at,ended_at:null,via:"sched",slot:missing.slot,browser_id:main.id,
          job_ids:[],done_count:0,blocked_count:0,status:"missing"});
    }
  }
  runs.sort((a,b)=>String(b.started_at).localeCompare(String(a.started_at)));
  return csvResponse("ai-runs.csv",["시작","끝","실행방법","예약시각","컴퓨터","가져간작업수","끝남","못함","상태"],
    runs.map(row=>[
      formatKstCsvDate(row.started_at),formatKstCsvDate(row.ended_at),
      row.via==="sched"?"예약 실행":"지금 실행",row.slot??"",
      names.get(String(row.browser_id))??"",
      Array.isArray(row.job_ids)?row.job_ids.length:0,row.done_count??0,row.blocked_count??0,
      row.status==="missing"?"기록 없음":row.status??"",
    ]));
}
async function exportPublications(ownerId:string,url:URL){
  const range=exportParams(url),db=createServiceSupabase(),rows:Record<string,unknown>[]=[];
  const channel=url.searchParams.get("channel")??"all",platform=url.searchParams.get("platform")??"all";
  const status=url.searchParams.get("status")??"all",search=(url.searchParams.get("q")??"").trim().toLocaleLowerCase();
  if(channel!=="all"&&!AUTOMATION_CHANNELS.includes(channel as typeof AUTOMATION_CHANNELS[number])
    ||platform!=="all"&&! ["instagram","threads","youtube"].includes(platform)
    ||status!=="all"&&! ["published","nourl","failed","deleted"].includes(status)
    ||search.length>200)throw new ApiError(400,"INVALID_EXPORT_FILTER","내려받을 필터를 확인해 주세요.");
  for(let offset=0;offset<=EXPORT_MAX;offset+=EXPORT_BATCH){
    let query=db.from("os_publication_log_v").select("*").eq("owner_id",ownerId)
      .order("at",{ascending:false}).range(offset,offset+EXPORT_BATCH-1);
    if(range.start)query=query.gte("at",range.start);
    if(range.end)query=query.lt("at",range.end);
    if(channel!=="all")query=query.eq("channel",channel);
    if(platform!=="all")query=query.eq("platform",platform);
    if(status!=="all")query=query.eq("status",status);
    const {data,error}=await query;
    if(error)throw new ApiError(503,"PUBLICATIONS_EXPORT_FAILED","발행 기록을 내려받지 못했습니다.");
    rows.push(...(data??[]));
    if(rows.length>EXPORT_MAX)throw new ApiError(413,"EXPORT_TOO_LARGE","내려받을 기록이 많습니다. 기간을 좁혀 주세요.");
    if((data??[]).length<EXPORT_BATCH)break;
  }
  const filtered=search?rows.filter(row=>String(row.content_title??"").toLocaleLowerCase().includes(search)
    ||String(row.publish_record_id??"").toLocaleLowerCase().includes(search)):rows;
  const reviews=new Map<string,{content_version:number;created_by:string;created_at:string}[]>();
  const ids=[...new Set(filtered.map(row=>String(row.publish_record_id)))];
  for(let offset=0;offset<ids.length;offset+=100){
    const {data,error}=await db.from("os_content_review_log")
      .select("publish_record_id,content_version,result,created_by,created_at")
      .eq("owner_id",ownerId).eq("result","ready").in("publish_record_id",ids.slice(offset,offset+100))
      .order("created_at",{ascending:false}).limit(1000);
    if(error||data?.length===1000)throw new ApiError(503,"PUBLICATIONS_EXPORT_FAILED","최종 확인 기록을 확인하지 못했습니다.");
    for(const review of data??[])reviews.set(review.publish_record_id,
      [...(reviews.get(review.publish_record_id)??[]),review]);
  }
  return csvResponse("publications.csv",["게시시각","콘텐츠번호","제목","채널","플랫폼","형식","계정","게시방법","게시한사람","확인자","확인시각","확인본버전","URL","외부ID","상태","오류"],
    filtered.map(row=>{
      const review=reviews.get(String(row.publish_record_id))?.find(candidate=>
        candidate.content_version<=Number(row.content_version??0));
      return [formatKstCsvDate(row.at),row.publish_record_id,row.content_title,row.channel,row.platform,row.format,
        row.account_handle,row.method,row.posted_by,review?.created_by??"",formatKstCsvDate(review?.created_at),
        row.content_version,row.permalink,row.external_id,row.status,row.error?JSON.stringify(row.error):""];
    }));
}
async function withReviewerNames<T extends {created_by:string}>(rows:T[]){
  const names=await memberNames(rows.map(row=>row.created_by));
  return rows.map(row=>({...row,reviewer_name:names.get(row.created_by)??"구성원"}));
}
// Team review inbox: shared Threads drafts of any owner, with their topic (brief and
// evidence), the AI jobs that target them and their review history. Read-only lists;
// who may edit or approve is decided per draft by the item routes.
async function teamList(resource:string,limit:number){
  if(!["items","topics","jobs","review-log"].includes(resource))throw new ApiError(400,"INVALID_SCOPE","팀 검수함에서 볼 수 없는 목록입니다.");
  const items=await listTeamItems(limit),db=createServiceSupabase();
  if(resource==="items"){
    const names=await memberNames(items.flatMap(row=>[row.owner_id,row.updated_by]));
    return NextResponse.json({items:items.map(row=>({...row,owner_name:names.get(String(row.owner_id))??"구성원",
      updated_by_name:names.get(String(row.updated_by))??"구성원"}))});
  }
  if(!items.length)return NextResponse.json(resource==="topics"?{topics:[]}:resource==="jobs"?{jobs:[]}:{reviews:[]});
  const ids=items.map(row=>row.id),owners=new Map(items.map(row=>[row.id,row.owner_id]));
  if(resource==="topics"){
    const parents=[...new Set(items.map(row=>row.parent_id).filter((id):id is string=>Boolean(id)))];
    const {data,error}=await db.from("os_records").select("*").in("id",parents).eq("record_type","content_topic")
      .eq("metadata->>space","personal").is("archived_at",null);
    if(error)throw new ApiError(503,"AUTOMATION_LIST_FAILED","팀 원고의 주제를 불러오지 못했습니다.");
    return NextResponse.json({topics:(data??[]).filter(topic=>items.some(item=>item.parent_id===topic.id&&item.owner_id===topic.owner_id))});
  }
  if(resource==="jobs"){
    const {data,error}=await db.from("os_records").select("*").eq("record_type","ai_job").eq("metadata->>space","personal")
      .in("metadata->>targetId",ids).is("archived_at",null).order("updated_at",{ascending:false}).limit(500);
    if(error)throw new ApiError(503,"AUTOMATION_LIST_FAILED","팀 원고의 AI 작업을 불러오지 못했습니다.");
    return NextResponse.json({jobs:(data??[]).filter(job=>owners.get(String(job.metadata?.targetId))===job.owner_id).map(job=>{
      // Sharing a draft grants review access, not access to its source documents.
      const {threadsInput:privateInput,...metadata}=job.metadata;
      void privateInput;
      return {...job,metadata};
    })});
  }
  const {data,error}=await db.from("os_content_review_log").select("*").in("publish_record_id",ids)
    .order("created_at",{ascending:false}).limit(500);
  if(error)throw new ApiError(503,"REVIEW_LOG_FAILED","팀 원고의 검수 기록을 불러오지 못했습니다.");
  return NextResponse.json({reviews:await withReviewerNames(data??[])});
}
export async function GET(request:Request,{params}:Params) {
  try {
    const actor=await authenticateRequest(request),ownerId=assertHumanOwner(actor);
    const {resource}=await params,url=new URL(request.url),limit=limitFrom(request),db=createServiceSupabase();
    if(resource==="runs.csv")return exportRuns(ownerId,url);
    if(resource==="publications.csv")return exportPublications(ownerId,url);
    if(url.searchParams.get("scope")==="team")return await teamList(resource,limit);
    if(resource==="reviewers"){
      const {data,error}=await db.from("os_content_reviewers").select("user_id,created_at").order("created_at");
      if(error)throw new ApiError(503,"REVIEWERS_FAILED","검수자 명단을 불러오지 못했습니다.");
      const names=await memberNames((data??[]).map(row=>row.user_id));
      return NextResponse.json({reviewers:(data??[]).map(row=>({id:row.user_id,name:names.get(row.user_id)??"구성원"})),
        canReview:await isContentReviewer(ownerId),canManage:actor.role==="admin"});
    }
    if(resource==="topics"||resource==="references"){
      const rows=await listPersonalRecords(actor,"content_topic",limit,resource);
      return NextResponse.json(resource==="references"?{references:rows,collectionContext:await threadsCollectionContext(actor)}:{topics:rows,collectionContext:await threadsCollectionContext(actor,THREADS_EDITORIAL_CANON_MIN_VERSION)});
    }
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
      const queue=orderedJobs(filtered.filter(job=>job.status==="backlog"&&job.stage==="queued"),rules,"now");
      const scheduled=orderedJobs(queue,rules,"sched"),slots=upcomingScheduleSlots(rules);
      const queueInfo=new Map(queue.map((job,index)=>{
        const scheduledIndex=scheduled.findIndex(candidate=>candidate.id===job.id);
        const slot=scheduledIndex>=0?slots[Math.floor(scheduledIndex/rules.per_run)]:null;
        const due=job.due_date?Date.parse(`${job.due_date}T23:59:59+09:00`):NaN;
        return [job.id,{position:index+1,slotLabel:scheduledIndex<0?"지금 실행에서만":
          slot?slot.at.toLocaleString("ko-KR",{timeZone:"Asia/Seoul",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}):"예정 미정",
          runIndex:scheduledIndex<0?null:scheduledIndex%rules.per_run+1,
          late:slot&&Number.isFinite(due)?slot.at.getTime()>due:false,nowOnly:scheduledIndex<0}] as const;
      }));
      return NextResponse.json({jobs:[...queue,...filtered.filter(job=>!queueInfo.has(job.id))]
        .map(job=>({...job,queueInfo:queueInfo.get(job.id)??null}))});
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
      return NextResponse.json({reviews:await withReviewerNames(data??[])});
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
      const editorial=parseThreadsEditorialMetadata(Object.fromEntries(Object.entries(input).filter(([,value])=>value!==undefined)));
      if(editorial){
        if(input.sourceJobId||input.candidateIndex!==undefined||input.referenceIds||input.reference_items||input.kind)
          throw new ApiError(422,"THREADS_EDITORIAL_INPUT_INVALID","레퍼런스 선택과 인사이트·인물 후보 등록을 따로 진행해 주세요.");
        await assertThreadsEditorialReady(actor,editorial);
        const topic=await createPersonalRecord(actor,"content_topic",{title:input.title,brand:input.brand,status:"draft",stage:"candidate",
          metadata:{source:"direct",sourceRef:editorial.editorial_material.sources.map(source=>source.url).join("\n"),brief:{},channels:[],
            ...editorial,...(input.requestId?{requestId:input.requestId}:{})}});
        const {_reused,...responseTopic}=topic as typeof topic&{_reused?:boolean};
        return NextResponse.json({topic:responseTopic,reused:_reused===true},{status:201});
      }
      if(input.kind&&input.referenceIds)throw new ApiError(422,"THREADS_REFERENCE_INPUT_INVALID","원문 저장과 주제 선택을 따로 진행해 주세요.");
      if(Boolean(input.sourceJobId)!==(input.candidateIndex!==undefined)
        ||input.sourceJobId&&(input.referenceIds||input.reference_items||input.kind))
        throw new ApiError(422,"THREADS_REFERENCE_INPUT_INVALID","AI 후보 선택과 원문 선택을 따로 진행해 주세요.");
      let referenceItems=input.reference_items;
      let sourceRef=input.sourceRef??"";
      let title=input.title,source=input.source,sourceWorkflow=false;
      if(input.sourceJobId){
        const job=await getPersonalRecord(actor,input.sourceJobId,"ai_job");
        const result=job.metadata.result as {candidates?:{title?:unknown;source?:unknown}[]}|undefined;
        const candidate=result?.candidates?.[input.candidateIndex!];
        if(job.stage!=="completed"||job.metadata.proc!=="topic"||!candidate
          ||typeof candidate.title!=="string"||!candidate.title.trim()||typeof candidate.source!=="string")
          throw new ApiError(409,"JOB_RESULT_UNAVAILABLE","내가 받은 주제 후보를 다시 확인해 주세요.");
        title=candidate.title.trim().slice(0,240);source="ai";sourceRef=candidate.source.slice(0,2000);
        const snapshot=getThreadsJobInput(job);
        if(snapshot?.workflow===THREADS_EDITORIAL_WORKFLOW)throw new ApiError(422,"THREADS_EDITORIAL_INPUT_INVALID","인사이트·인물 후보는 해당 경로의 후보 등록을 사용해 주세요.");
        if(snapshot){referenceItems=parseThreadsReferences(snapshot.topic.reference_items);sourceWorkflow=true;}
      }
      if(input.referenceIds){
        if(input.reference_items)throw new ApiError(422,"THREADS_REFERENCE_INPUT_INVALID","선택한 원문은 서버에 저장된 기록으로 읽습니다.");
        const ids=[...new Set(input.referenceIds)];
        const references=await Promise.all(ids.map(id=>getPersonalRecord(actor,id,"content_topic")));
        if(references.some(row=>row.metadata.kind!==THREADS_REFERENCE_KIND))
          throw new ApiError(422,"THREADS_REFERENCE_REQUIRED","내 레퍼런스에서 원문을 선택해 주세요.");
        referenceItems=parseThreadsReferences(references.flatMap(row=>parseThreadsReferences(row.metadata.reference_items)));
        sourceRef=referenceItems.map(item=>item.url).join("\n").slice(0,2000);
      }
      const workflow=sourceWorkflow||input.editorial_workflow||input.kind||input.referenceIds||input.reference_items?THREADS_REFERENCE_WORKFLOW:undefined;
      if(workflow&&input.kind!==THREADS_REFERENCE_KIND)assertThreadsReferencesReady(referenceItems??[]);
      const metadata=validateThreadsTopicMetadata({source:input.referenceIds?"reference":source,sourceRef,brief:{},channels:[],
        ...(workflow?{editorial_workflow:workflow,reference_items:referenceItems??[]}:{ }),
        ...(input.kind?{kind:input.kind}:{}),...(input.referenceIds?{sourceReferenceIds:[...new Set(input.referenceIds)]}:{}),
        ...(input.requestId?{requestId:input.requestId}:{}),
        ...(input.sourceJobId?{sourceJobId:input.sourceJobId,sourceCandidateIndex:input.candidateIndex,requestId:`job:${input.sourceJobId}:${input.candidateIndex}`}:{})});
      if(input.kind===THREADS_REFERENCE_KIND&&referenceItems?.[0]){
        metadata.sourceRef=referenceItems[0].url;
        metadata.requestId=threadsReferenceRequestId(referenceItems[0].url);
      }
      const topic=await createPersonalRecord(actor,"content_topic",{
        title,brand:input.brand,status:"draft",stage:"candidate",
        metadata,
      });
      const {_reused,...responseTopic}=topic as typeof topic&{_reused?:boolean};
      return NextResponse.json({topic:responseTopic,reused:_reused===true},{status:201});
    }
    if(resource==="reviewers"){
      const ownerId=assertHumanOwner(actor);
      if(actor.role!=="admin")throw new ApiError(403,"REVIEWERS_ADMIN_ONLY","관리자만 검수자를 바꿀 수 있습니다.");
      const input=z.object({action:z.enum(["add","remove"]),userId:uuid}).strict().parse(raw);
      const db=createServiceSupabase();
      if(input.action==="add"){
        const {data:member}=await db.from("os_profiles").select("id").eq("id",input.userId).eq("is_active",true).maybeSingle();
        if(!member)throw new ApiError(422,"REVIEWER_INVALID","활성 구성원을 선택해 주세요.");
        const {error}=await db.from("os_content_reviewers").upsert({user_id:input.userId,created_by:ownerId},{onConflict:"user_id",ignoreDuplicates:true});
        if(error)throw new ApiError(503,"REVIEWERS_SAVE_FAILED","검수자를 저장하지 못했습니다.");
      }else{
        const {error}=await db.from("os_content_reviewers").delete().eq("user_id",input.userId);
        if(error)throw new ApiError(503,"REVIEWERS_SAVE_FAILED","검수자를 저장하지 못했습니다.");
      }
      return NextResponse.json({saved:true});
    }
    if(resource==="items"){
      const input=itemSchema.parse(raw);
      const topic=await getPersonalRecord(actor,input.topicId,"content_topic");
      if(topic.metadata.kind===THREADS_REFERENCE_KIND)
        throw new ApiError(409,"THREADS_HUMAN_SELECTION_REQUIRED","원문은 레퍼런스 화면에서 주제로 선택한 뒤 제작해 주세요.");
      const editorial=await assertThreadsEditorialReady(actor,topic.metadata);
      if(editorial&&(input.channel!=="threads"||topic.stage!=="confirmed"))
        throw new ApiError(409,"THREADS_HUMAN_SELECTION_REQUIRED","주제 화면에서 사람이 후보를 선택한 뒤 쓰레드 제작을 시작해 주세요.");
      const ownerId=assertHumanOwner(actor);
      const db=createServiceSupabase();
      const existing=await db.from("os_records").select("*").eq("record_type","content_publish")
        .eq("owner_id",ownerId).eq("parent_id",input.topicId).eq("metadata->>space","personal")
        .eq("metadata->>channel",input.channel).is("archived_at",null).limit(1).maybeSingle();
      if(existing.error)throw new ApiError(503,"ITEM_CHECK_FAILED","기존 채널 콘텐츠를 확인하지 못했습니다.");
      if(existing.data)return NextResponse.json({item:existing.data,reused:true});
      if(input.channel==="threads"&&topic.metadata.editorial_workflow===THREADS_REFERENCE_WORKFLOW)
        assertThreadsReferencesReady(parseThreadsReferences(topic.metadata.reference_items??[]));
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
