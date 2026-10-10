"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter,useSearchParams } from "next/navigation";
import { FormEvent,useCallback,useEffect,useMemo,useRef,useState,type ReactNode } from "react";
import { apiRequest } from "@/lib/api-client";
import { CHANNEL_LABELS,CONTENT_STATUS_LABELS,JOB_STATUS_LABELS,PROC_LABELS } from "@/lib/content-automation-labels";
import { PAGE_GUIDES } from "@/lib/page-guides";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";
import "./content-automation-v07.css";

const DemoCommentsWorkspace=dynamic(()=>import("./content-comments-workspace").then(module=>module.ContentCommentsWorkspace));

export type AutomationPage="dashboard"|"topics"|"cardnews"|"shorts"|"threads"|"review"|"calendar"|"performance"|"requests"|"settings";
type BrowserRow={id:string;name:string;os:string;is_main:boolean;registered_at:string;last_run_at:string|null};
type RunRow={id:string;via:string;slot:string|null;status:string;started_at:string;ended_at:string|null;job_ids:string[];done_count:number;blocked_count:number};
type PublicationRow={publish_record_id:string;platform:string;at:string;status:string;content_title:string;permalink:string|null;format:string|null;channel:string|null;method:string|null;posted_by:string|null;content_version:number|null;account_handle:string|null;external_id:string|null;error:Record<string,unknown>|null};
type ReviewRow={id:string;publish_record_id:string;content_version:number;result:string;checks:{key:string;ok:boolean;by:string}[];created_at:string};
type RunRules={enabled:boolean;days:string;times:string[];per_run:number;daily_max:number;order_by:string;long_only_now:boolean;grace_minutes:number;lease_minutes:number;notify:boolean;defaults?:Record<string,unknown>};
type Data={topics:OsRecord[];items:OsRecord[];jobs:OsRecord[];browsers:BrowserRow[];runs:RunRow[];publications:PublicationRow[];reviews:ReviewRow[];
  skills:OsRecord[];templates:OsRecord[];assets:OsRecord[];comments:OsRecord[];metrics:OsRecord[];rules:RunRules|null;accounts:Record<string,unknown>[];silent:boolean};
const EMPTY:Data={topics:[],items:[],jobs:[],browsers:[],runs:[],publications:[],reviews:[],
  skills:[],templates:[],assets:[],comments:[],metrics:[],rules:null,accounts:[],silent:false};
const PAGE_INFO:Record<AutomationPage,{title:string;description:string;next:string}>={
  dashboard:{title:"자동화 현황",description:"내가 만든 콘텐츠·AI 작업·내 채널 계정만 봅니다.",next:"/automation/topics"},
  topics:{title:"① 주제 기획",description:"주제 후보를 모으고 브리프와 제작 채널을 정합니다.",next:"/automation/cardnews"},
  cardnews:{title:"② 카드뉴스",description:"템플릿의 칸 이름에 맞춰 글과 이미지를 준비합니다.",next:"/automation/review"},
  shorts:{title:"③ 쇼츠",description:"컷 구성·MP4·커버와 설명을 준비합니다.",next:"/automation/review"},
  threads:{title:"④ 쓰레드",description:"글타래를 다듬고 확인으로 보냅니다.",next:"/automation/review"},
  review:{title:"⑤ 최종 확인",description:"게시 전에 직접 확인하고 기록을 남깁니다.",next:"/automation/calendar"},
  calendar:{title:"⑥ 발행",description:"일정을 정하고 사람이 게시한 결과를 기록합니다.",next:"/automation/performance"},
  performance:{title:"⑦ 반응·성과",description:"댓글과 같은 기간의 성과를 확인합니다.",next:"/automation/dashboard"},
  requests:{title:"AI 작업함",description:"내 Chrome의 Claude in Chrome이 처리할 작업을 관리합니다.",next:"/automation/settings"},
  settings:{title:"자동화 설정",description:"내 실행 규칙·스킬·템플릿·이미지를 관리합니다.",next:"/automation/dashboard"},
};
const SOURCES:Record<string,string>={longform:"롱폼",comment:"댓글 질문",reference:"레퍼런스",ai:"AI 후보",direct:"직접"};
const DIRECT_CHECKS=[
  ["numbers","숫자·사실은 출처와 기준일을 확인함"],
  ["message","1개 핵심 메시지"],
  ["ending","위계에 맞는 마무리"],
  ["forbidden","금지 표현 없음"],
  ["ads","광고·협찬 표시가 필요하면 넣음"],
] as const;
const CHANNELS=["card","shorts","threads"] as const;
const DEFAULT_RUN_RULES:RunRules={enabled:true,days:"daily",times:["09:00","13:00","17:00"],per_run:3,daily_max:15,order_by:"due",long_only_now:true,grace_minutes:15,lease_minutes:120,notify:true,
  defaults:{channels:["card","shorts","threads"],templateId:null,sendMode:"queue",leadMinutes:30,expiryDays:[7,3],minImageShortSide:1080}};
const DATE=(value:string|null|undefined)=>value?new Date(value).toLocaleString("ko-KR"):"—";
const str=(value:unknown)=>typeof value==="string"?value:"";
function workerInstruction(via:"sched"|"now",name="내 컴퓨터"){
  const label=via==="sched"?"예약 실행":"지금 실행";
  return `[브랜디 OS · AI 작업 · ${label} · ${name}]\n1) 새 탭에서 브랜디 OS의 AI 작업 화면을 연다: ${location.origin}/automation/worker?via=${via}\n2) 화면 맨 위 ‘Claude에게’ 규칙을 그대로 따른다.\n3) [다음 작업 가져오기] → 지시·스킬·결과 형식을 읽고 결과 칸에 쓴다 → [결과 제출]. 못 하면 [못 함] → 이유 → [못 함으로 남기기].\n4) ‘이번 실행 끝’이 나오면 [실행 끝내기]를 누르고 마친다.\n5) 이 화면 밖으로 이동하지 않는다. 승인·예약·게시·삭제를 하지 않는다. 로그인 화면이 나오면 아무것도 입력하지 않고, 비밀번호 관리자·로그인 요청도 하지 않고 마친다.`;
}

function PageHead({page,name}:{page:AutomationPage;name:string}){
  const info=PAGE_INFO[page],guide=PAGE_GUIDES[`/automation/${page}`];
  const process=info.title.match(/^([①-⑦])\s/),title=process?info.title.slice(2):info.title;
  return <><header className="ca-v07-head"><div><span className="ca-v07-eyebrow">콘텐츠 자동화 · {name}의 작업 공간 · 나만 보임</span><div className="ca-v07-title">{process?<span className="ca-v07-process" aria-hidden="true">{process[1]}</span>:null}<h1>{title}</h1></div><p>{info.description}</p></div></header>
    <div className="ca-v07-guide"><strong>이 화면에서 할 일</strong><span>{guide.steps.map((step,i)=><span key={step}>{i+1}. {step}</span>)}</span><Link href={info.next}>다음 단계 →</Link></div></>;
}
function Tabs({base,tabs,active}:{base:string;tabs:{id:string;label:string}[];active:string}){
  return <div className="ca-v07-tabs" role="tablist">{tabs.map(tab=><Link key={tab.id} role="tab" aria-selected={active===tab.id} className={active===tab.id?"active":""} href={`${base}?tab=${tab.id}`}>{tab.label}</Link>)}</div>;
}
function Status({value,job=false}:{value:string;job?:boolean}){
  return <span className="ca-v07-status" data-status={value}>{job?JOB_STATUS_LABELS[value]??value:CONTENT_STATUS_LABELS[value]??value}</span>;
}
function queueLabel(job:OsRecord){
  const info=(job as OsRecord & {queueInfo?:{position:number;slotLabel:string;runIndex:number|null;late:boolean;nowOnly:boolean}|null}).queueInfo;
  if(!info)return "";
  return ` · 대기 ${info.position}번째 · ${info.slotLabel}${info.runIndex?` (${info.runIndex}번째)`:""}${info.late?" · 마감 늦음":""}`;
}
function Empty({text}:{text:string}){return <div className="ca-v07-empty">{text}</div>;}
function Modal({label,onClose,children}:{label:string;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const trigger=document.activeElement;
    ref.current?.querySelector<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea:not(:disabled)")?.focus();
    return()=>{if(trigger instanceof HTMLElement)trigger.focus();};},[]);
  const onKeyDown=(event:React.KeyboardEvent<HTMLDivElement>)=>{
    if(event.key==="Escape"){event.preventDefault();onClose();return;}
    if(event.key!=="Tab"||!ref.current)return;
    const nodes=[...ref.current.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]")];
    if(!nodes.length)return;
    if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1)?.focus();}
    else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus();}
  };
  return <div className="ca-v07-backdrop"><div ref={ref} role="dialog" aria-modal="true" aria-label={label} className="ca-v07-dialog" onKeyDown={onKeyDown}>{children}</div></div>;
}
function JobPrompt({proc,targetId,onClose,onSubmit}:{proc:string;targetId?:string;onClose:()=>void;onSubmit:(rush:boolean)=>Promise<void>}){
  const first=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLDivElement>(null),[busy,setBusy]=useState(false);
  useEffect(()=>{const trigger=document.activeElement;first.current?.focus();return()=>{if(trigger instanceof HTMLElement)trigger.focus();};},[]);
  const handleKey=(event:React.KeyboardEvent<HTMLDivElement>)=>{
    if(event.key==="Escape"){onClose();return;}
    if(event.key!=="Tab"||!dialog.current)return;
    const nodes=[...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    if(!nodes.length)return;
    if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1)?.focus();}
    else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus();}
  };
  return <div className="ca-v07-backdrop"><div ref={dialog} role="dialog" aria-modal="true" aria-label="내 AI로 보내기" className="ca-v07-dialog" onKeyDown={handleKey}>
    <h2>내 AI로 보내기</h2><p>{PROC_LABELS[proc]??proc} · {targetId?"현재 콘텐츠":"새 주제"}</p>
    <p>아직 대기열에 넣지 않았습니다. 이 창을 닫으면 작업은 생기지 않습니다.</p>
    <div className="ca-v07-actions"><button ref={first} type="button" onClick={onClose}>취소</button>
      <button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{await onSubmit(false);}finally{setBusy(false);}}}>대기열에 두기</button>
      <button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{await onSubmit(true);}finally{setBusy(false);}}}>맨 앞에 넣고 복사</button></div>
  </div></div>;
}
const RESOURCES:Record<AutomationPage,string[]>={
  dashboard:["topics","items","jobs","browsers","runs","publications","accounts"],
  topics:["topics","items","jobs"],cardnews:["items","topics","templates","assets","jobs"],shorts:["items","topics","assets","jobs"],
  threads:["items","topics","jobs"],review:["items","review-log","jobs"],calendar:["items","publications","review-log"],
  performance:["comments","metrics","publications"],requests:["jobs","browsers","runs"],
  settings:["run-rules","skills","templates","assets"],
};
export function ContentAutomationV07({page}:{page:AutomationPage}){
  const {accessToken,demo,profile,loading:sessionLoading}=useSession();
  const [data,setData]=useState<Data>(EMPTY),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const load=useCallback(async()=>{
    if(sessionLoading)return;
    if(demo){setData(EMPTY);setLoading(false);return;}
    if(!accessToken)return;
    setLoading(true);setError("");
    try{
      const entries=await Promise.all(RESOURCES[page].map(async resource=>{
        const path=resource==="accounts"?"/api/v1/channels?scope=mine":`/api/v1/content/automation/${resource}?limit=500`;
        return [resource,await apiRequest<Record<string,unknown>>(path,{token:accessToken})] as const;
      }));
      const next={...EMPTY};
      for(const [resource,response] of entries){
        if(resource==="run-rules")next.rules=response.rules as RunRules;
        else if(resource==="review-log")next.reviews=response.reviews as ReviewRow[];
        else if(resource==="accounts")next.accounts=response.connections as Record<string,unknown>[];
        else if(resource==="topics")next.topics=response.topics as OsRecord[];
        else if(resource==="items")next.items=response.items as OsRecord[];
        else if(resource==="jobs")next.jobs=response.jobs as OsRecord[];
        else if(resource==="browsers")next.browsers=response.browsers as BrowserRow[];
        else if(resource==="runs"){next.runs=response.runs as RunRow[];next.silent=response.silent===true;}
        else if(resource==="publications")next.publications=response.publications as PublicationRow[];
        else if(resource==="comments")next.comments=response.records as OsRecord[];
        else if(resource==="metrics")next.metrics=response.records as OsRecord[];
        else if(resource==="skills")next.skills=response.records as OsRecord[];
        else if(resource==="templates")next.templates=response.records as OsRecord[];
        else if(resource==="assets")next.assets=response.records as OsRecord[];
      }
      setData(next);
    }catch(issue){setError(issue instanceof Error?issue.message:"화면을 불러오지 못했습니다.");}
    finally{setLoading(false);}
  },[accessToken,demo,page,sessionLoading]);
  useEffect(()=>{void load();},[load]);
  const mutate=useCallback(async(path:string,method:"POST"|"PATCH"|"PUT",body:unknown)=>{
    if(demo)throw new Error("데모 모드에서는 저장할 수 없습니다.");
    if(!accessToken)throw new Error("로그인이 필요합니다.");
    const response=await apiRequest<Record<string,unknown>>(path,{method,token:accessToken,body:JSON.stringify(body)});
    await load();setNotice("저장했습니다.");
    return response;
  },[accessToken,demo,load]);
  return <section className="ca-v07 ui-v2 screen-automation-v07">
    <PageHead page={page} name={profile?.displayName??"나"} />
    {notice?<p className="ca-v07-notice" role="status">{notice}</p>:null}
    {loading?<div className="ca-v07-loading" role="status">내 콘텐츠를 불러오는 중입니다…</div>
      :error?<div className="ca-v07-error" role="alert"><strong>—</strong> 불러오지 못했습니다 · 저장된 데이터는 바뀌지 않았습니다. <button type="button" onClick={()=>void load()}>다시 시도</button><p>{error}</p></div>
      :page==="dashboard"?<DashboardView data={data} />
      :page==="topics"?<TopicsView data={data} mutate={mutate} />
      :["cardnews","shorts","threads"].includes(page)?<ItemsView page={page} data={data} mutate={mutate} />
      :page==="review"?<ReviewView data={data} mutate={mutate} />
      :page==="calendar"?<CalendarView data={data} mutate={mutate} />
      :page==="performance"?<PerformanceView data={data} mutate={mutate} />
      :page==="requests"?<RequestsView data={data} mutate={mutate} />
      :<SettingsView data={data} mutate={mutate} />}
  </section>;
}
type ViewProps={data:Data;mutate:(path:string,method:"POST"|"PATCH"|"PUT",body:unknown)=>Promise<Record<string,unknown>>};
function DashboardView({data}:Pick<ViewProps,"data">){
  const search=useSearchParams(),tab=search.get("tab")==="accounts"?"accounts":"today";
  const topics=data.topics.filter(row=>row.stage!=="published");
  const making=data.items.filter(row=>["draft","blocked"].includes(row.status));
  const review=data.items.filter(row=>row.status==="review");
  const publishing=data.items.filter(row=>["ready","scheduled"].includes(row.status));
  const published=data.publications.filter(row=>["published","nourl"].includes(row.status));
  const cards=[["① 주제 기획",topics.length,"/automation/topics"],["②③④ 제작 중",making.length,"/automation/cardnews"],
    ["⑤ 최종 확인",review.length,"/automation/review"],["⑥ 게시 대기",publishing.length,"/automation/calendar"],
    ["⑥ 발행 기록",published.length,"/automation/calendar?tab=history"]] as const;
  return <><Tabs base="/automation/dashboard" active={tab} tabs={[{id:"today",label:"오늘"},{id:"accounts",label:"내 채널 계정"}]}/>
    {search.has("missing")?<p className="ca-v07-note" role="status">찾을 수 없는 화면입니다. 자동화 현황에서 다시 선택해 주세요.</p>:null}
    {data.silent?<div className="ca-v07-error" role="status">내 컴퓨터 응답 없음 · Chrome과 OS 로그인을 확인한 뒤 지금 실행해 주세요. <Link href="/automation/requests?tab=browsers">확인하기 →</Link></div>:null}
    {tab==="accounts"?<section className="ca-v07-card"><h2>내 채널 계정</h2>{data.accounts.length?data.accounts.map((row,index)=><div className="ca-v07-row" key={index}><strong>{String(row.accountName??row.platform??"채널")}</strong><small>{String(row.platform??"")} · {String(row.status??"연결 상태 확인")}</small></div>):<Empty text="내 명의로 연결된 채널 계정이 없습니다."/>}<Link href="/settings/account">계정 연결 확인 →</Link></section>:<>
    <div className="ca-v07-stat-grid">{cards.map(([label,count,href])=><Link key={label} href={href} className="ca-v07-stat"><small>{label}</small><strong>{count}</strong></Link>)}</div>
    <section className="ca-v07-card"><h2>오늘 할 일</h2>{[
      ...data.jobs.filter(row=>row.status==="blocked").map(row=>({label:`막힌 작업 · ${row.title}`,href:"/automation/requests?tab=jobs"})),
      ...data.items.filter(row=>row.status==="blocked").map(row=>({label:`고칠 것 · ${row.title}`,href:`/automation/${row.metadata.channel==="card"?"cardnews":row.metadata.channel}?sel=${row.id}`})),
      ...review.map(row=>({label:`최종 확인 · ${row.title}`,href:`/automation/review?sel=${row.id}`})),
      ...publishing.map(row=>({label:`게시 준비 · ${row.title}`,href:`/automation/calendar?pub=${row.id}`})),
    ].slice(0,12).map(item=><Link key={item.href+item.label} href={item.href} className="ca-v07-row">{item.label}<span>열기 →</span></Link>)}
    {!data.jobs.some(row=>row.status==="blocked")&&!review.length&&!publishing.length&&!making.some(row=>row.status==="blocked")?<Empty text="오늘 바로 처리할 항목이 없습니다."/>:null}</section>
    <div className="ca-v07-grid-two"><section className="ca-v07-card"><h2>AI 작업함</h2><p>내 Chrome의 Claude in Chrome이 처리합니다.</p><div className="ca-v07-mini-stats"><span>대기 {data.jobs.filter(row=>row.status==="backlog").length}</span><span>처리 중 {data.jobs.filter(row=>row.status==="active").length}</span><span>결과 도착 {data.jobs.filter(row=>row.stage==="completed").length}</span><span>막힘 {data.jobs.filter(row=>row.status==="blocked").length}</span></div><Link href="/automation/requests">AI 작업함 열기 →</Link></section>
      <section className="ca-v07-card"><h2>내 채널 계정</h2><p>연결된 계정 {data.accounts.length}개 · 게시와 답글은 본인이 확인합니다.</p><Link href="/settings/account">계정 확인 →</Link></section></div></>}</>;
}
function TopicsView({data,mutate}:ViewProps){
  const search=useSearchParams(),router=useRouter(),[query,setQuery]=useState(""),[source,setSource]=useState("all");
  const [newOpen,setNewOpen]=useState(search.has("new")),[newTitle,setNewTitle]=useState(""),[newSource,setNewSource]=useState("direct"),[newNote,setNewNote]=useState("");
  const selected=data.topics.find(row=>row.id===search.get("sel"))??null;
  const missing=search.has("sel")&&!selected;
  const [brief,setBrief]=useState({one:"",who:"",message:"",sources:"",warn:""}),[channels,setChannels]=useState<string[]>([]);
  const [dues,setDues]=useState<Record<string,string>>({}),[jobOpen,setJobOpen]=useState<string|null>(null),[localError,setLocalError]=useState("");
  useEffect(()=>{const value=selected?.metadata.brief as Record<string,unknown>|undefined;setBrief({
    one:str(value?.one),who:str(value?.who),message:str(value?.message),sources:str(value?.sources),warn:str(value?.warn)});
    setChannels(Array.isArray(selected?.metadata.channels)?selected.metadata.channels as string[]:[]);
    setDues((selected?.metadata.dues as Record<string,string>)??{});
  },[selected]);
  const filtered=data.topics.filter(row=>(source==="all"||row.metadata.source===source)&&row.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const column=(topic:OsRecord)=>{
    const count=data.items.filter(item=>item.parent_id===topic.id).length;
    return count?"제작 중":topic.stage==="confirmed"?"확정 · 제작 대기":
      topic.stage==="brief"?"브리프 작성":"후보";
  };
  const create=async(event:FormEvent)=>{
    event.preventDefault();setLocalError("");
    try{const response=await mutate("/api/v1/content/automation/topics","POST",{title:newTitle,source:newSource,sourceRef:newNote});
      setNewOpen(false);setNewTitle("");setNewNote("");router.replace(`/automation/topics?sel=${(response.topic as OsRecord).id}`);}
    catch(issue){setLocalError(issue instanceof Error?issue.message:"주제를 추가하지 못했습니다.");}
  };
  const save=async(start:boolean)=>{
    if(!selected)return;
    if(start&&!channels.length){setLocalError("만들 채널을 하나 이상 선택해 주세요.");return;}
    setLocalError("");
    try{
      await mutate(`/api/v1/content/automation/topics/${selected.id}`,"PATCH",{
        expectedVersion:selected.version,stage:start?"confirmed":"brief",
        metadata:{brief,channels,dues}});
      if(start)for(const channel of channels){
        await mutate("/api/v1/content/automation/items","POST",{
          title:selected.title,topicId:selected.id,brand:selected.brand,channel,
          ...(dues[channel]?{dueDate:dues[channel]}:{})});
      }
    }catch(issue){setLocalError(issue instanceof Error?issue.message:"주제를 저장하지 못했습니다.");}
  };
  const createJob=async(rush:boolean)=>{
    try{await mutate("/api/v1/content/automation/jobs","POST",{proc:jobOpen,targetId:selected?.id,rush});
      setJobOpen(null);if(rush)await navigator.clipboard.writeText(workerInstruction("now"));}
    catch(issue){setLocalError(issue instanceof Error?issue.message:"AI 작업을 만들지 못했습니다.");}
  };
  return <><div className="ca-v07-toolbar"><input aria-label="주제 검색" placeholder="주제·출처 검색" value={query} onChange={event=>setQuery(event.target.value)}/>
    <select aria-label="출처" value={source} onChange={event=>setSource(event.target.value)}><option value="all">전체 출처</option>{Object.entries(SOURCES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
    <button type="button" onClick={()=>setJobOpen("topic")}>AI로 후보 받기</button><button type="button" className="primary" onClick={()=>setNewOpen(true)}>+ 주제 추가</button></div>
    {newOpen?<form className="ca-v07-card ca-v07-form" onSubmit={event=>void create(event)}><h2>주제 추가</h2><label>출처<select value={newSource} onChange={event=>setNewSource(event.target.value)}>{Object.entries(SOURCES).filter(([key])=>key!=="ai").map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>제목<input required value={newTitle} onChange={event=>setNewTitle(event.target.value)}/></label><label>출처·메모<input value={newNote} onChange={event=>setNewNote(event.target.value)}/></label><div className="ca-v07-actions"><button type="button" onClick={()=>setNewOpen(false)}>취소</button><button className="primary">후보에 추가</button></div></form>:null}
    <div className="ca-v07-board">{["후보","브리프 작성","확정 · 제작 대기","제작 중"].map(name=><section className="ca-v07-card" key={name}><h2>{name} <small>{filtered.filter(row=>column(row)===name).length}</small></h2>{filtered.filter(row=>column(row)===name).map(row=><button className="ca-v07-topic" key={row.id} onClick={()=>router.replace(`/automation/topics?sel=${row.id}`)}><small>{SOURCES[str(row.metadata.source)]??"직접"} · {DATE(row.updated_at)}</small><strong>{row.title}</strong><span>{data.items.filter(item=>item.parent_id===row.id).map(item=>CHANNEL_LABELS[str(item.metadata.channel)]).join(" · ")}</span></button>)}</section>)}</div>
    {data.jobs.filter(job=>job.metadata.proc==="topic"&&job.stage==="completed").map(job=><section className="ca-v07-card" key={job.id}><h2>AI 주제 후보 도착</h2>{Array.isArray((job.metadata.result as Record<string,unknown>|undefined)?.candidates)?((job.metadata.result as Record<string,unknown>).candidates as {title:string;why:string;source:string}[]).map((candidate,index)=><div className="ca-v07-row" key={index}><span><strong>{candidate.title}</strong><small>{candidate.why} · {candidate.source}</small></span><button onClick={()=>void mutate("/api/v1/content/automation/topics","POST",{title:candidate.title,source:"ai",sourceRef:candidate.source})}>후보에 추가</button></div>):null}</section>)}
    {missing?<div className="ca-v07-note" role="status">찾을 수 없는 주제입니다. <Link href="/automation/dashboard">자동화 현황으로 →</Link></div>:null}
    {selected?<section className="ca-v07-card ca-v07-detail"><div className="ca-v07-detail-head"><h2>{selected.title}</h2><button onClick={()=>router.replace("/automation/topics")}>닫기</button></div>
      <p>{SOURCES[str(selected.metadata.source)]??"직접"} · {selected.brand||"브랜드 미선택"} · v{selected.version}</p>
      {data.items.some(item=>item.parent_id===selected.id)?<div className="ca-v07-note">제작이 시작된 주제입니다. 연결된 채널 콘텐츠에서 작업을 이어가세요.</div>:<>
      <div className="ca-v07-form-grid">{([["one","한 줄 주제"],["who","누구에게"],["message","핵심 메시지"],["sources","근거·자료"],["warn","주의할 표현"]] as const).map(([key,label])=><label key={key}>{label}<textarea value={brief[key]} onChange={event=>setBrief({...brief,[key]:event.target.value})}/></label>)}</div>
      <h3>만들 채널</h3><div className="ca-v07-channel-picks">{CHANNELS.map(channel=><div key={channel}><label><input type="checkbox" checked={channels.includes(channel)} onChange={event=>setChannels(event.target.checked?[...channels,channel]:channels.filter(value=>value!==channel))}/>{CHANNEL_LABELS[channel]}</label>{channels.includes(channel)?<input type="date" aria-label={`${CHANNEL_LABELS[channel]} 마감`} value={dues[channel]??""} onChange={event=>setDues({...dues,[channel]:event.target.value})}/>:null}</div>)}</div>
      <div className="ca-v07-actions"><button onClick={()=>setJobOpen("brief")}>내 AI로 브리프 초안</button><button onClick={()=>void save(false)}>저장</button><button className="primary" onClick={()=>void save(true)}>확정하고 제작 시작</button></div>
      {data.jobs.filter(job=>job.metadata.targetId===selected.id&&job.metadata.proc==="brief"&&job.stage==="completed").map(job=><div className="ca-v07-note" key={job.id}><strong>AI 브리프 도착</strong><pre>{JSON.stringify(job.metadata.result,null,2)}</pre><button onClick={()=>void mutate("/api/v1/content/automation/topics/"+selected.id+"/adopt","POST",{jobId:job.id,version:selected.version})}>브리프 채택</button><button onClick={()=>void mutate("/api/v1/content/automation/topics/"+selected.id+"/reject","POST",{jobId:job.id,version:selected.version})}>채택 안 함</button></div>)}</>}</section>:null}
    {localError?<p role="alert" className="ca-v07-error">{localError}</p>:null}
    {jobOpen?<JobPrompt proc={jobOpen} targetId={selected?.id} onClose={()=>setJobOpen(null)} onSubmit={createJob}/>:null}</>;
}

function ItemsView({page,data,mutate}:ViewProps&{page:AutomationPage}){
  const router=useRouter(),search=useSearchParams(),channel=page==="cardnews"?"card":page;
  const {accessToken}=useSession();
  const items=data.items.filter(row=>row.metadata.channel===channel);
  const selected=items.find(row=>row.id===search.get("sel"))??null;
  const missing=search.has("sel")&&!selected;
  const locked=Boolean(selected&&["review","ready","scheduled","published"].includes(selected.status));
  const [tab,setTab]=useState("all"),[title,setTitle]=useState(""),[body,setBody]=useState("");
  const [meta,setMeta]=useState<Record<string,unknown>>({}),[cutsText,setCutsText]=useState("[]");
  const [jobOpen,setJobOpen]=useState<string|null>(null),[error,setError]=useState(""),[videoFile,setVideoFile]=useState<File|null>(null),[uploading,setUploading]=useState(false);
  useEffect(()=>{setTitle(selected?.title??"");setBody(selected?.description??"");setMeta(selected?.metadata??{});
    setCutsText(JSON.stringify(selected?.metadata.cuts??[],null,2));},[selected]);
  const filtered=items.filter(row=>tab==="all"||tab==="making"&&["draft","blocked"].includes(row.status)
    ||tab==="review"&&row.status==="review"||tab==="ready"&&["ready","scheduled"].includes(row.status)
    ||tab==="published"&&row.status==="published");
  const save=async()=>{
    if(!selected)return false;
    try{
      const nextMeta={...meta};
      if(channel==="shorts")nextMeta.cuts=JSON.parse(cutsText);
      await mutate("/api/v1/content/automation/items/"+selected.id,"PATCH",{
        expectedVersion:selected.version,title,description:body,metadata:nextMeta});setError("");return true;}
    catch(issue){setError(issue instanceof Error?issue.message:"저장하지 못했습니다.");return false;}
  };
  const send=async()=>{
    if(!selected||!accessToken)return;
    try{if(!await save())return;const latest=await apiRequest<{record:OsRecord}>("/api/v1/content/automation/items/"+selected.id,{token:accessToken});
      await mutate("/api/v1/content/automation/items/"+selected.id+"/send-to-review","POST",{version:latest.record.version});
      router.push("/automation/review?sel="+selected.id);}
    catch(issue){setError(issue instanceof Error?issue.message:"최종 확인으로 보내지 못했습니다.");}
  };
  const createJob=async(rush:boolean)=>{
    try{await mutate("/api/v1/content/automation/jobs","POST",{proc:jobOpen,targetId:selected?.id,rush});
      setJobOpen(null);if(rush)await navigator.clipboard.writeText(workerInstruction("now"));}
    catch(issue){setError(issue instanceof Error?issue.message:"AI 작업을 만들지 못했습니다.");}
  };
  const uploadVideo=async()=>{
    if(!videoFile||!accessToken)return;
    setUploading(true);setError("");
    try{
      const upload=await apiRequest<{path:string;token:string}>("/api/v1/content/automation/uploads",{
        method:"POST",token:accessToken,body:JSON.stringify({kind:"shorts",mime:videoFile.type,size:videoFile.size})});
      const client=getBrowserSupabase();if(!client)throw new Error("미디어 저장소를 사용할 수 없습니다.");
      const saved=await client.storage.from("os-content-media").uploadToSignedUrl(upload.path,upload.token,videoFile,{contentType:videoFile.type});
      if(saved.error)throw new Error("MP4를 올리지 못했습니다. 다시 시도해 주세요.");
      setMeta(previous=>({...previous,mp4Path:upload.path,mp4Source:"직접 업로드"}));setVideoFile(null);
    }catch(issue){setError(issue instanceof Error?issue.message:"MP4를 올리지 못했습니다.");}
    finally{setUploading(false);}
  };
  const tabs=[["all","전체"],["making","만드는 중"],["review","확인 대기"],["ready","발행 준비"],["published","게시됨"]];
  return <><div className="ca-v07-toolbar"><span>확정한 주제에서 채널별 콘텐츠를 만듭니다.</span><Link href="/automation/topics">+ 확정한 주제에서 만들기</Link></div>
    <div className="ca-v07-tabs">{tabs.map(([key,label])=><button type="button" role="tab" aria-selected={tab===key} className={tab===key?"active":""} key={key} onClick={()=>setTab(key)}>{label} {items.filter(row=>key==="all"||key==="making"&&["draft","blocked"].includes(row.status)||key===row.status||key==="ready"&&row.status==="scheduled").length}</button>)}</div>
    <div className="ca-v07-split"><section className="ca-v07-card"><h2>{PAGE_INFO[page].title} 목록</h2>{filtered.length?filtered.map(row=><button key={row.id} className="ca-v07-row" onClick={()=>router.replace("/automation/"+page+"?sel="+row.id)}><span><strong>{row.title}</strong><small>v{row.version} · 마감 {row.due_date??"없음"}</small></span><Status value={row.status}/></button>):<Empty text="이 상태의 내 콘텐츠가 없습니다."/>}</section>
      {selected?<section className="ca-v07-card ca-v07-edit"><div className="ca-v07-detail-head"><h2>{CHANNEL_LABELS[channel]} · v{selected.version}</h2><button onClick={()=>router.replace("/automation/"+page)}>닫기</button></div>
        <p><Status value={selected.status}/> · {data.topics.find(row=>row.id===selected.parent_id)?.title??"주제 없음"}</p>
        {locked?<div className="ca-v07-note">확인 중이거나 확인된 버전입니다. 내용을 바꾸면 다시 최종 확인을 거쳐야 합니다. {selected.status!=="published"?<button onClick={()=>void mutate("/api/v1/content/automation/items/"+selected.id+"/reopen","POST",{})}>다시 고치기</button>:null}</div>:null}
        <fieldset disabled={locked} className="ca-v07-fields"><label>제목<input value={title} onChange={event=>setTitle(event.target.value)}/></label>
        {channel==="card"?<><CardDetail meta={meta} setMeta={setMeta} templates={data.templates} assets={data.assets}/>
          <label>캡션<textarea rows={4} value={str(meta.caption)} onChange={event=>setMeta({...meta,caption:event.target.value})}/></label>
          <button onClick={()=>setJobOpen("card-fill")}>내 AI로 글 받기</button><button onClick={()=>setJobOpen("card-caption")}>내 AI로 캡션 받기</button></>
          :channel==="shorts"?<><label>원본 영상·구성 메모<textarea rows={3} value={body} onChange={event=>setBody(event.target.value)}/></label>
            <label>컷 구성(JSON)<textarea rows={6} value={cutsText} onChange={event=>setCutsText(event.target.value)}/></label>
            <label>MP4 올리기<input type="file" accept="video/mp4" onChange={event=>setVideoFile(event.target.files?.[0]??null)}/></label><button onClick={()=>void uploadVideo()} disabled={!videoFile||uploading}>{uploading?"올리는 중…":"MP4 파일 올리기"}</button>
            <label>MP4 파일 주소<input value={str(meta.mp4Path)} readOnly/></label>
            <label>MP4 출처<input value={str(meta.mp4Source)} onChange={event=>setMeta({...meta,mp4Source:event.target.value})}/></label>
            <label>커버 이미지<select value={str(meta.coverAssetId)} onChange={event=>{const asset=data.assets.find(row=>row.id===event.target.value);setMeta({...meta,coverAssetId:asset?.id??"",coverPath:asset?.metadata.storagePath??"",coverLicense:asset?.metadata.license??{source:"unknown"},coverConsent:asset?.metadata.consent??{}});}}><option value="">내 이미지에서 선택</option>{data.assets.map(row=><option key={row.id} value={row.id}>{row.title} · {str((row.metadata.license as Record<string,unknown>|undefined)?.source)||"불명"}</option>)}</select></label>
            <label>음원 출처<input value={str(meta.bgmSource)} onChange={event=>setMeta({...meta,bgmSource:event.target.value})}/></label>
            <button onClick={()=>setJobOpen("shorts-cut")}>내 AI로 컷 구성 받기</button><button onClick={()=>setJobOpen("shorts-desc")}>내 AI로 설명 받기</button></>
          :<><label>글타래 · 한 줄에 한 글<textarea rows={10} value={Array.isArray(meta.posts)?meta.posts.join("\n"):body} onChange={event=>setMeta({...meta,posts:event.target.value.split("\n")})}/></label>
            {(Array.isArray(meta.posts)?meta.posts:[]).map((post,i)=><small key={i} className={String(post).length>500?"ca-v07-error":""}>{i+1}번 글 {String(post).length}/500자</small>)}
            <button onClick={()=>setJobOpen("threads")}>내 AI로 초안 받기</button></>}</fieldset>
        {data.jobs.filter(job=>job.metadata.targetId===selected.id&&job.stage==="completed").map(job=><div className="ca-v07-note" key={job.id}><strong>AI 결과 도착 · {PROC_LABELS[str(job.metadata.proc)]}</strong><pre>{JSON.stringify(job.metadata.result,null,2)}</pre><button onClick={()=>void mutate("/api/v1/content/automation/items/"+selected.id+"/adopt","POST",{jobId:job.id,version:selected.version})}>이 결과 채택</button><button onClick={()=>void mutate("/api/v1/content/automation/items/"+selected.id+"/reject","POST",{jobId:job.id,version:selected.version})}>채택 안 함</button></div>)}
        <div className="ca-v07-actions"><button onClick={()=>void save()} disabled={locked}>저장</button>
          <button className="primary" onClick={()=>void send()} disabled={locked}>최종 확인으로 보내기</button></div></section>
      :missing?<div className="ca-v07-note" role="status">찾을 수 없는 콘텐츠입니다. <Link href="/automation/dashboard">자동화 현황으로 →</Link></div>:<Empty text="목록에서 콘텐츠를 선택해 주세요."/>}</div>
    {error?<p role="alert" className="ca-v07-error">{error}</p>:null}
    {jobOpen?<JobPrompt proc={jobOpen} targetId={selected?.id} onClose={()=>setJobOpen(null)} onSubmit={createJob}/>:null}</>;
}

type CardSlot={name:string;type:string;x:number;y:number;w:number;h:number;size:number;color:string;weight:number;align:string;lines:number;fit:string};
type CardPage={type:string;slots:Record<string,unknown>};
const DEFAULT_CARD_SLOTS:CardSlot[]=[
  {name:"제목",type:"text",x:8,y:38,w:84,h:22,size:56,color:"#ffffff",weight:700,align:"left",lines:3,fit:"warn"},
  {name:"본문",type:"text",x:8,y:64,w:84,h:18,size:28,color:"#ffffff",weight:400,align:"left",lines:4,fit:"warn"},
];
function CardDetail({meta,setMeta,templates,assets}:{meta:Record<string,unknown>;setMeta:(value:Record<string,unknown>)=>void;templates:OsRecord[];assets:OsRecord[]}){
  const [pageIndex,setPageIndex]=useState(0),[slotName,setSlotName]=useState(""),[overflows,setOverflows]=useState<string[]>([]);
  const [mediaUrls,setMediaUrls]=useState<Record<string,string>>({}),{accessToken}=useSession();
  const canvas=useRef<HTMLDivElement>(null);
  const template=templates.find(row=>row.id===meta.templateId);
  const pages=Array.isArray(meta.pages)?meta.pages as CardPage[]:[];
  const page=pages[pageIndex]??{type:"cover",slots:{}};
  const design=useMemo(()=>{
    const templatePages=Array.isArray(template?.metadata.pages)?template.metadata.pages as Record<string,unknown>[]:[];
    return templatePages[Math.min(pageIndex,templatePages.length-1)]??{};
  },[template,pageIndex]);
  const slotDefs=useMemo(()=>Array.isArray(design.slots)?design.slots as CardSlot[]:DEFAULT_CARD_SLOTS,[design]);
  const selected=slotDefs.find(slot=>slot.name===slotName)??slotDefs[0];
  useEffect(()=>{
    if(!accessToken)return;
    const paths=[str(design.bgPath),...Object.values(page.slots).flatMap(value=>{
      if(typeof value!=="object"||value===null||!("ref" in value))return [];
      return [str(assets.find(row=>row.id===(value as {ref:string}).ref)?.metadata.storagePath)];
    })].filter(path=>path.startsWith("automation/")&&!(path in mediaUrls));
    if(!paths.length)return;
    let active=true;
    void Promise.all(paths.map(async path=>{
      try{const response=await apiRequest<{url:string}>("/api/v1/content/automation/uploads?path="+encodeURIComponent(path),{token:accessToken});
        return [path,response.url] as const;}catch{return [path,""] as const;}
    })).then(entries=>{if(active)setMediaUrls(previous=>({...previous,...Object.fromEntries(entries)}));});
    return()=>{active=false;};
  },[accessToken,assets,design,page.slots,mediaUrls]);
  useEffect(()=>{if(!slotDefs.some(slot=>slot.name===slotName))setSlotName(slotDefs[0]?.name??"");},[slotDefs,slotName]);
  useEffect(()=>{
    let active=true;
    const measure=()=>{if(!active||!canvas.current)return;setOverflows([...canvas.current.querySelectorAll<HTMLElement>("[data-ca-slot-kind=text]")].filter(element=>element.scrollHeight>element.clientHeight+2||element.scrollWidth>element.clientWidth+2).map(element=>element.dataset.slotName??""));};
    void document.fonts.ready.then(()=>requestAnimationFrame(measure));
    return()=>{active=false;};
  },[pageIndex,page.slots,template]);
  const updatePage=(next:CardPage)=>{
    const nextPages=[...pages];nextPages[pageIndex]=next;
    const unknown=nextPages.flatMap(item=>Object.values(item.slots)).filter(value=>{
      if(typeof value!=="object"||value===null||!("ref" in value))return false;
      const license=(value as {license?:{source?:string}}).license;
      return !license||license.source==="unknown";
    }).length;
    setMeta({...meta,pages:nextPages,licenseSummary:{unknown}});
  };
  const updateSlot=(value:unknown)=>{if(!selected)return;updatePage({...page,slots:{...page.slots,[selected.name]:value}});};
  const applyTemplate=(id:string)=>{
    const nextTemplate=templates.find(row=>row.id===id);
    const source=Array.isArray(nextTemplate?.metadata.pages)?nextTemplate.metadata.pages as Record<string,unknown>[]:[];
    const nextPages=source.length?source.map((item,index)=>({
      type:str(item.type)||"body",slots:{...(pages[index]?.slots??{})},
    })):pages;
    setMeta({...meta,templateId:id,pages:nextPages});
    setPageIndex(0);
  };
  const addPage=()=>{setMeta({...meta,pages:[...pages,{type:"body",slots:{}}]});setPageIndex(pages.length);};
  const value=selected?page.slots[selected.name]:null;
  const picture=typeof value==="object"&&value!==null&&"ref" in value?value as {ref:string;alt?:string;license?:{source?:string}}:null;
  const background=str(design.bgPath).startsWith("https://")?str(design.bgPath):mediaUrls[str(design.bgPath)]??"";
  return <div className="ca-v07-card-editor"><div className="ca-v07-toolbar"><label>템플릿<select value={str(meta.templateId)} onChange={event=>applyTemplate(event.target.value)}><option value="">기본 틀</option>{templates.map(row=><option value={row.id} key={row.id}>{row.title}</option>)}</select></label><span>{pages.length}장 · 넘침 {overflows.length}칸(현재 장)</span></div>
    <div className="ca-v07-card-layout"><div className="ca-v07-page-list"><h3>페이지</h3>{pages.map((item,index)=><button key={index} className={index===pageIndex?"active":""} onClick={()=>setPageIndex(index)}>{index+1} · {item.type==="cover"?"표지":item.type==="end"?"마무리":"본문"}<small>{Object.keys(item.slots??{}).length}칸 입력</small></button>)}<button onClick={addPage}>+ 본문 장 추가</button></div>
      <div className="ca-v07-canvas-wrap"><div className="ca-v07-canvas" ref={canvas} style={background?{backgroundImage:"url("+background+")"}:undefined}>{slotDefs.map(slot=>{
        const raw=page.slots[slot.name],isImage=slot.type==="image",asset=isImage&&typeof raw==="object"&&raw!==null&&"ref" in raw?assets.find(row=>row.id===(raw as {ref:string}).ref):null;
        const src=asset?str(asset.metadata.storagePath).startsWith("https://")?str(asset.metadata.storagePath):mediaUrls[str(asset.metadata.storagePath)]??"":"";
        return <button type="button" key={slot.name} data-ca-slot-kind={isImage?"image":"text"} data-slot-name={slot.name} className={"ca-v07-canvas-slot"+(selected?.name===slot.name?" active":"")+(overflows.includes(slot.name)?" over":"")}
          style={{left:slot.x+"%",top:slot.y+"%",width:slot.w+"%",height:slot.h+"%",fontSize:"max(11px,"+(slot.size/10.8)+"cqw)",fontWeight:slot.weight,color:slot.color,textAlign:slot.align as "left"|"center"|"right"}}
          onClick={()=>setSlotName(slot.name)}><span className="ca-v07-slot-tag">{slot.name}</span>{isImage?(src?<span className="ca-v07-canvas-image" role="img" aria-label={picture?.alt??slot.name} style={{backgroundImage:"url("+src+")"}}/>:<span>이미지 칸</span>):<span>{typeof raw==="string"?raw:"글 입력"}</span>}</button>;
      })}</div><small>1080×1350 비율 미리보기 · 넘침은 화면에 그린 결과로 확인합니다.</small></div>
      <div className="ca-v07-slot-editor"><h3>{pageIndex+1}장 · {selected?.name??"칸 선택"}</h3>{selected?.type==="image"?<><p>라이선스: {picture?.license?.source&&picture.license.source!=="unknown"?"확인됨":"불명 · 발행 준비 불가"}</p><label>내 이미지<select value={picture?.ref??""} onChange={event=>{const asset=assets.find(row=>row.id===event.target.value);if(asset)updateSlot({ref:asset.id,license:asset.metadata.license??{source:"unknown"},alt:picture?.alt??str(asset.metadata.alt),consent:asset.metadata.consent??{}});}}><option value="">이미지 고르기</option>{assets.map(row=><option key={row.id} value={row.id}>{row.title} · {str((row.metadata.license as Record<string,unknown>|undefined)?.source)||"불명"}</option>)}</select></label><label>대체 텍스트<input value={picture?.alt??""} onChange={event=>updateSlot({...picture,alt:event.target.value})}/></label><Link href="/automation/settings?tab=templates">이미지 라이선스 기록 →</Link></>
        :<><label>칸 내용<textarea rows={6} value={typeof value==="string"?value:""} onChange={event=>updateSlot(event.target.value)}/></label><small>{typeof value==="string"?value.length:0}자 · 예상 최대는 참고용, 화면에서 넘침을 확인하세요.</small>{overflows.includes(selected?.name??"")?<p className="ca-v07-error">그려진 글이 칸을 넘습니다.</p>:null}</>}
        <p>위치 {selected?.x??0}×{selected?.y??0}% · 크기 {selected?.w??0}×{selected?.h??0}%</p></div></div></div>;
}

function ReviewView({data,mutate}:ViewProps){
  const search=useSearchParams(),router=useRouter(),[tab,setTab]=useState(search.get("tab")??"review"),[channel,setChannel]=useState("all");
  const [checked,setChecked]=useState<string[]>([]),[note,setNote]=useState(""),[error,setError]=useState(""),[jobOpen,setJobOpen]=useState(false);
  const rows=data.items.filter(row=>channel==="all"||row.metadata.channel===channel);
  const selected=rows.find(row=>row.id===search.get("sel"))??null;
  useEffect(()=>{if(selected){setChecked([]);setNote("");setTab(selected.status==="blocked"?"blocked":["ready","scheduled"].includes(selected.status)?"ready":"review");}},[selected]);
  const shown=rows.filter(row=>tab==="ready"?["ready","scheduled"].includes(row.status):row.status===tab);
  const unknown=Number((selected?.metadata.licenseSummary as Record<string,unknown>|undefined)?.unknown??0);
  const shortsBlocked=selected?.metadata.channel==="shorts"&&(
    !selected.metadata.mp4Path||!selected.metadata.mp4Source||!selected.metadata.coverPath
    ||!selected.metadata.bgmSource||!selected.metadata.coverLicense
    ||(selected.metadata.coverLicense as Record<string,unknown>).source==="unknown");
  const review=async(result:"ready"|"changes")=>{
    if(!selected)return;
    try{await mutate("/api/v1/content/automation/items/"+selected.id+"/review","POST",{
      result,version:selected.version,note:result==="changes"?note:undefined,
      checks:DIRECT_CHECKS.map(([key])=>({key,ok:checked.includes(key),by:"me"}))});
      setError("");if(result==="ready")router.push("/automation/calendar?pub="+selected.id);}
    catch(issue){setError(issue instanceof Error?issue.message:"확인을 저장하지 못했습니다.");}
  };
  return <><Tabs base="/automation/review" active={tab} tabs={[{id:"review",label:"확인 대기 "+rows.filter(row=>row.status==="review").length},
    {id:"blocked",label:"고칠 것 "+rows.filter(row=>row.status==="blocked").length},
    {id:"ready",label:"발행 준비·게시 예정 "+rows.filter(row=>["ready","scheduled"].includes(row.status)).length}]}/>
    <div className="ca-v07-toolbar"><select value={channel} onChange={event=>setChannel(event.target.value)} aria-label="채널 선택"><option value="all">전체 채널</option>{CHANNELS.map(value=><option key={value} value={value}>{CHANNEL_LABELS[value]}</option>)}</select></div>
    <div className="ca-v07-split"><section className="ca-v07-card"><h2>내 콘텐츠</h2>{shown.length?shown.map(row=><button className="ca-v07-row" key={row.id} onClick={()=>router.replace("/automation/review?tab="+tab+"&sel="+row.id)}><span><strong>{row.title}</strong><small>{CHANNEL_LABELS[str(row.metadata.channel)]} · v{row.version} · {row.due_date??"마감 없음"}</small></span><Status value={row.status}/></button>):<Empty text="이 상태의 내 콘텐츠가 없습니다."/>}</section>
      {selected?<section className="ca-v07-card"><h2>{selected.title}</h2><p><Status value={selected.status}/> · v{selected.version} · <Link href={"/automation/"+(selected.metadata.channel==="card"?"cardnews":selected.metadata.channel)+"?sel="+selected.id}>편집 화면 →</Link></p>
        <div className="ca-v07-preview">{selected.metadata.channel==="threads"?String((selected.metadata.posts as string[]|undefined)?.join("\n\n")??selected.description):selected.metadata.channel==="shorts"?"쇼츠 MP4 · 커버: "+(selected.metadata.coverPath?"준비됨":"없음"):String(selected.metadata.caption??selected.description??"미리보기 없음")}</div>
        <h3>자동 검사</h3><div className="ca-v07-note">이미지 라이선스 불명 {unknown}곳 · 넘침 {Number(selected.metadata.overflowSlots??0)}곳 {selected.metadata.channel==="shorts"?"· MP4 "+(selected.metadata.mp4Path?"준비됨":"없음")+" · 커버 "+(selected.metadata.coverPath?"준비됨":"없음"):""} {shortsBlocked?"· 쇼츠 출처·라이선스를 확인해 주세요.":""}</div>
        <h3>AI 자가검수</h3>{data.jobs.filter(job=>job.metadata.targetId===selected.id&&job.metadata.proc==="review"&&job.stage==="completed").map(job=><div className="ca-v07-note" key={job.id}><strong>자가검수 결과</strong><pre>{JSON.stringify(job.metadata.result,null,2)}</pre></div>)}<button onClick={()=>setJobOpen(true)}>자가검수 다시 받기</button>
        <h3>직접 확인 5개</h3>{DIRECT_CHECKS.map(([key,label])=><label className="ca-v07-check" key={key}><input type="checkbox" checked={checked.includes(key)} onChange={event=>setChecked(event.target.checked?[...checked,key]:checked.filter(value=>value!==key))}/>{label}</label>)}
        <label>고칠 점<textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="고칠 것으로 표시할 때 이유를 남겨 주세요."/></label>
        {data.reviews.filter(row=>row.publish_record_id===selected.id).map(row=><p className="ca-v07-note" key={row.id}>확인 기록 · {DATE(row.created_at)} · v{row.content_version} · {row.result}</p>)}
        {selected.status==="review"?<div className="ca-v07-actions"><button onClick={()=>void review("changes")} disabled={!note.trim()}>고칠 것으로 표시</button><button className="primary" onClick={()=>void review("ready")} disabled={checked.length!==5||unknown>0||Boolean(shortsBlocked)}>발행 준비로</button></div>:null}</section>
      :<Empty text="확인할 콘텐츠를 선택해 주세요."/>}</div>
    {jobOpen?<JobPrompt proc="review" targetId={selected?.id} onClose={()=>setJobOpen(false)} onSubmit={async rush=>{if(!selected)return;try{await mutate("/api/v1/content/automation/jobs","POST",{proc:"review",targetId:selected.id,rush});setJobOpen(false);}catch(issue){setError(issue instanceof Error?issue.message:"AI 작업을 만들지 못했습니다.");}}}/>:null}
    {error?<p role="alert" className="ca-v07-error">{error}</p>:null}</>;
}

function CalendarView({data,mutate}:ViewProps){
  const search=useSearchParams(),router=useRouter(),tab=search.get("tab")==="history"?"history":"schedule";
  const selected=data.items.find(row=>row.id===search.get("pub"))??null;
  const [date,setDate]=useState(""),[time,setTime]=useState("09:00"),[url,setUrl]=useState(""),[platform,setPlatform]=useState("instagram"),[error,setError]=useState("");
  const postedPlatforms=(id:string)=>new Set(data.publications.filter(row=>row.publish_record_id===id).map(row=>row.platform));
  const availablePlatforms=(row:OsRecord)=>{
    const choices=row.metadata.channel==="shorts"?["instagram","youtube"]:
      row.metadata.channel==="threads"?["threads"]:["instagram"];
    const posted=postedPlatforms(row.id);
    return choices.filter(value=>!posted.has(value));
  };
  useEffect(()=>{
    setDate(selected?.due_date??"");setTime(str(selected?.metadata.publishTime)||"09:00");
    if(selected){
      const posted=new Set(data.publications.filter(row=>row.publish_record_id===selected.id).map(row=>row.platform));
      const choices=selected.metadata.channel==="shorts"?["instagram","youtube"]:
        selected.metadata.channel==="threads"?["threads"]:["instagram"];
      setPlatform(choices.find(value=>!posted.has(value))??"instagram");
    }
  },[selected,data.publications]);
  const schedule=data.items.filter(row=>["ready","scheduled"].includes(row.status)||
    row.status==="published"&&row.metadata.channel==="shorts"&&availablePlatforms(row).length>0);
  const [period,setPeriod]=useState("month"),[status,setStatus]=useState("all"),[channelFilter,setChannelFilter]=useState("all"),[platformFilter,setPlatformFilter]=useState("all"),[query,setQuery]=useState("");
  const periodStart=period==="all"?0:period==="week"?Date.now()-7*86400000:period==="last"?new Date(new Date().getFullYear(),new Date().getMonth()-1,1).getTime():new Date(new Date().getFullYear(),new Date().getMonth(),1).getTime();
  const periodEnd=period==="last"?new Date(new Date().getFullYear(),new Date().getMonth(),1).getTime():Infinity;
  const history=data.publications.filter(row=>Date.parse(row.at)>=periodStart&&Date.parse(row.at)<periodEnd
    &&(status==="all"||row.status===status)&&(channelFilter==="all"||row.channel===channelFilter)
    &&(platformFilter==="all"||row.platform===platformFilter)&&row.content_title.toLowerCase().includes(query.toLowerCase()));
  const exportCsv=()=>{const csv=["게시시각,제목,채널,플랫폼,형식,계정,게시방법,게시한사람,확인본버전,URL,외부ID,상태,오류",...history.map(row=>[
    row.at,row.content_title,row.channel??"",row.platform,row.format??"",row.account_handle??"",row.method??"",row.posted_by??"",row.content_version??"",row.permalink??"",row.external_id??"",row.status,JSON.stringify(row.error??""),
  ].map(value=>'"'+String(value).replaceAll('"','""')+'"').join(","))].join("\r\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}),link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="발행기록.csv";link.click();URL.revokeObjectURL(link.href);};
  const reserve=async()=>{
    if(!selected||!date)return;
    try{await mutate("/api/v1/content/automation/items/"+selected.id+"/schedule","POST",{
      version:selected.version,startsAt:new Date(date+"T"+time+":00+09:00").toISOString(),confirm:true});
      setError("");router.replace("/automation/calendar?tab=schedule");}
    catch(issue){setError(issue instanceof Error?issue.message:"일정을 저장하지 못했습니다.");}
  };
  const manualDone=async()=>{
    if(!selected)return;
    try{await mutate("/api/v1/content/automation/items/"+selected.id+"/manual-done","POST",{
      version:selected.version,platform,permalink:url||undefined,confirm:true});
      setError("");router.replace("/automation/calendar?tab=history");}
    catch(issue){setError(issue instanceof Error?issue.message:"발행 기록을 남기지 못했습니다.");}
  };
  return <><Tabs base="/automation/calendar" active={tab} tabs={[{id:"schedule",label:"발행 일정 "+schedule.length},{id:"history",label:"발행 기록 "+data.publications.length}]}/>
    {tab==="schedule"?<><div className="ca-v07-card"><h2>발행 준비</h2><p>게시 시각에 알림을 받고 직접 게시합니다. 자동 게시는 없습니다.</p>{schedule.length?schedule.map(row=><button className="ca-v07-row" key={row.id} onClick={()=>router.replace("/automation/calendar?tab=schedule&pub="+row.id)}><strong>{row.title}</strong><span>{row.due_date??"날짜 미정"} · <Status value={row.status}/></span></button>):<Empty text="발행을 기다리는 내 콘텐츠가 없습니다."/>}</div>
      {selected?<section className="ca-v07-card ca-v07-detail"><h2>{selected.title}</h2><p>확인된 버전 v{selected.version} · 게시하는 사람: 나</p>{selected.status!=="published"?<><label>게시 날짜<input type="date" value={date} onChange={event=>setDate(event.target.value)}/></label><label>시각<input type="time" value={time} onChange={event=>setTime(event.target.value)}/></label><button onClick={()=>void reserve()} disabled={!date}>알림 예약</button></>:null}
        <h3>앱에서 직접 게시했나요?</h3><p>실제로 게시한 뒤 기록해 주세요. URL이 없으면 성과 수집에 필요한 게시물 식별자를 확인할 수 없습니다. 연결된 계정과 게시물 식별자까지 확인되어야 자동 수집됩니다.</p><label>플랫폼<select value={platform} onChange={event=>setPlatform(event.target.value)}>{availablePlatforms(selected).map(value=><option key={value} value={value}>{value==="instagram"?"인스타그램":value==="youtube"?"YouTube":"Threads"}</option>)}</select></label><label>게시물 URL<input type="url" value={url} onChange={event=>setUrl(event.target.value)} placeholder="선택 입력"/></label><div className="ca-v07-actions"><button onClick={()=>router.replace("/automation/calendar?tab=schedule")}>닫기</button><button className="primary" disabled={!availablePlatforms(selected).length} onClick={()=>{if(window.confirm("앱에 실제로 게시했습니까? 해당 플랫폼의 게시 기록을 남깁니다."))void manualDone();}}>앱에서 직접 게시함</button></div></section>:null}</>
    :<><div className="ca-v07-toolbar"><select value={period} onChange={event=>setPeriod(event.target.value)} aria-label="기간"><option value="month">이번 달</option><option value="week">최근 7일</option><option value="last">지난달</option><option value="all">전체</option></select><select value={channelFilter} onChange={event=>setChannelFilter(event.target.value)} aria-label="채널"><option value="all">전체 채널</option>{CHANNELS.map(value=><option key={value} value={value}>{CHANNEL_LABELS[value]}</option>)}</select><select value={platformFilter} onChange={event=>setPlatformFilter(event.target.value)} aria-label="플랫폼"><option value="all">전체 플랫폼</option><option value="instagram">인스타그램</option><option value="threads">Threads</option><option value="youtube">YouTube</option></select><select value={status} onChange={event=>setStatus(event.target.value)} aria-label="상태"><option value="all">전체 상태</option><option value="published">게시됨</option><option value="nourl">URL 없음</option><option value="failed">게시 실패</option><option value="deleted">삭제됨</option></select><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="제목 찾기" aria-label="발행 제목 찾기"/><button onClick={exportCsv}>CSV 내려받기</button></div>
      <div className="ca-v07-stat-grid"><div className="ca-v07-stat">게시 <strong>{history.filter(row=>["published","nourl"].includes(row.status)).length}</strong></div><div className="ca-v07-stat">URL 없음 <strong>{history.filter(row=>row.status==="nourl").length}</strong></div><div className="ca-v07-stat">게시 실패 <strong>{history.filter(row=>row.status==="failed").length}</strong></div></div>
      <section className="ca-v07-card"><h2>발행 기록</h2>{history.length?history.map(row=><div className="ca-v07-row" key={row.publish_record_id+row.platform+row.at}><span><strong>{row.content_title}</strong><small>{DATE(row.at)} · {row.platform}</small></span><Status value={row.status}/>{row.permalink?<a href={row.permalink} target="_blank" rel="noopener noreferrer">게시물 ↗</a>:null}
        {["nourl","failed"].includes(row.status)?<button onClick={()=>{const value=window.prompt("실제로 올라간 게시물 URL을 입력해 주세요.");if(value)void mutate("/api/v1/content/automation/publications/"+row.publish_record_id+"/url","POST",{platform:row.platform,permalink:value});}}>URL 기록</button>:null}
        {row.status==="published"?<button onClick={()=>{if(window.confirm("앱에서 삭제했음을 기록할까요?"))void mutate("/api/v1/content/automation/publications/"+row.publish_record_id+"/mark-deleted","POST",{platform:row.platform});}}>지웠음 표시</button>:null}</div>):<Empty text="선택한 기간의 발행 기록이 없습니다."/>}</section></>}
    {error?<p role="alert" className="ca-v07-error">{error}</p>:null}</>;
}

function PerformanceView({data,mutate}:ViewProps){
  const search=useSearchParams(),tab=search.get("tab")==="metrics"?"metrics":"comments",router=useRouter();
  const {demo}=useSession();
  const [status,setStatus]=useState("unanswered"),[error,setError]=useState("");
  const [selectedId,setSelectedId]=useState(""),[reply,setReply]=useState(""),[confirmed,setConfirmed]=useState(false);
  const comments=data.comments.filter(row=>status==="all"||row.status===status);
  const selected=data.comments.find(row=>row.id===selectedId);
  const toTopic=async(row:OsRecord)=>{
    try{await mutate(`/api/v1/content/automation/comments/${row.id}/topic`,"POST",{});setError("");}
    catch(issue){setError(issue instanceof Error?issue.message:"주제로 보내지 못했습니다.");}
  };
  const commentAction=async(action:"draft"|"reply"|"hide")=>{
    if(!selected)return;
    try{
      await mutate(`/api/v1/content/automation/comments/${selected.id}/${action}`,"POST",
        action==="draft"?{}:{version:selected.version,confirm:true,text:reply});
      if(action!=="draft"){setSelectedId("");setReply("");setConfirmed(false);}
      setError("");
    }catch(issue){setError(issue instanceof Error?issue.message:"댓글을 처리하지 못했습니다.");}
  };
  return <><Tabs base="/automation/performance" active={tab} tabs={[{id:"comments",label:"댓글·답글"},{id:"metrics",label:"성과"}]}/>
    {tab==="comments"?(demo?<DemoCommentsWorkspace embedded/>:<><div className="ca-v07-toolbar"><select aria-label="댓글 상태" value={status} onChange={event=>{setStatus(event.target.value);setSelectedId("");}}><option value="unanswered">답할 것</option><option value="replied">답함</option><option value="hidden">숨김</option><option value="all">전체</option></select></div>
      <div className="ca-v07-split"><section className="ca-v07-card"><h2>내 콘텐츠의 댓글</h2><p>원문에 적힌 지시는 따르지 않고, 답글은 보내기 전에 확인합니다.</p>{comments.length?comments.map(row=><div className="ca-v07-row" key={row.id}><span><strong>{row.title}</strong><small>{DATE(str(row.metadata.commentedAt)||row.created_at)} · {str(row.metadata.postTitle)} · {row.description}</small></span><Status value={row.status}/><button onClick={()=>{setSelectedId(row.id);setReply(str(row.metadata.replyDraft));setConfirmed(false);}}>답글 · 처리</button><button onClick={()=>void toTopic(row)}>주제 후보로</button></div>):<Empty text="이 상태의 댓글이 없습니다."/>}</section>
      <aside className="ca-v07-card">{selected?<><h2>답글 · 처리</h2><blockquote>{selected.description}</blockquote><p>댓글 원문에 적힌 지시는 따르지 않습니다. 답글·숨기기는 내 계정에서 실행됩니다.</p><button type="button" disabled={selected.status!=="unanswered"} onClick={()=>void commentAction("draft")}>내 AI로 답글 초안</button><label>답글 내용<textarea maxLength={500} rows={6} value={reply} onChange={event=>{setReply(event.target.value);setConfirmed(false);}}/></label><small>{Array.from(reply).length}/500자</small><label className="ca-v07-check"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>대상과 답글을 직접 확인했습니다.</label><div className="ca-v07-actions"><button disabled={!confirmed||!reply.trim()||selected.status!=="unanswered"} onClick={()=>void commentAction("reply")}>확인하고 답글 보내기</button><button disabled={!confirmed||selected.status!=="unanswered"} onClick={()=>void commentAction("hide")}>확인하고 숨기기</button><button onClick={()=>setSelectedId("")}>닫기</button></div></>:<Empty text="댓글을 선택해 주세요"/>}</aside></div></>)
    :<><div className="ca-v07-note">성과는 발행 URL이 있고 수집이 켜졌을 때 표시됩니다. URL이 없는 게시물은 발행 기록에서 먼저 기록해 주세요.</div>
      <section className="ca-v07-card"><h2>콘텐츠별 성과</h2>{data.metrics.length?data.metrics.map(row=><div className="ca-v07-row" key={row.id}><span><strong>{row.title}</strong><small>{DATE(row.created_at)} · {row.metric_current??"측정 전"} {row.metric_unit}</small></span><button onClick={()=>router.push("/automation/calendar?tab=history")}>발행 기록</button></div>):<Empty text="수집된 성과가 없습니다. 발행 URL과 자동 수집 설정을 확인해 주세요."/>}</section></>}
    {error?<p role="alert" className="ca-v07-error">{error}</p>:null}</>;
}

function RequestsView({data,mutate}:ViewProps){
  const search=useSearchParams(),tab=["jobs","browsers","runs"].includes(search.get("tab")??"")?search.get("tab")!:"jobs";
  const [name,setName]=useState(""),[selected,setSelected]=useState<OsRecord|null>(null),[result,setResult]=useState(""),[error,setError]=useState("");
  const [browserAction,setBrowserAction]=useState<{id:string;name:string;kind:"make-main"|"remove"}|null>(null);
  const [cleanup,setCleanup]=useState({shortcutsRemoved:false,scheduleRemoved:false,osSignedOut:false,localFilesRemoved:false});
  const [previousScheduleOff,setPreviousScheduleOff]=useState(false);
  const doAction=async(path:string,body:unknown={})=>{
    try{await mutate(path,"POST",body);setError("");return true;}
    catch(issue){setError(issue instanceof Error?issue.message:"처리하지 못했습니다.");return false;}
  };
  return <><div className="ca-v07-toolbar"><Link href="/automation/worker?via=now" target="_blank">AI 작업 화면 ↗</Link><button onClick={()=>void navigator.clipboard.writeText(workerInstruction("now"))}>/브랜디작업 지시문 복사</button></div>
    {data.silent?<div className="ca-v07-error" role="status">내 컴퓨터 응답 없음 · 예약 시각 뒤 실행 기록이 없습니다. Chrome·OS 로그인을 확인하고 지금 실행해 주세요.</div>:null}
    <Tabs base="/automation/requests" active={tab} tabs={[{id:"jobs",label:"작업 목록 "+data.jobs.length},{id:"browsers",label:"내 컴퓨터 "+data.browsers.length},{id:"runs",label:"실행 기록 "+data.runs.length}]}/>
    {tab==="jobs"?<section className="ca-v07-card"><h2>내 AI 작업</h2><p>내 Chrome의 Claude in Chrome이 초안을 만들고, 채택과 게시 결정은 사람이 합니다.</p>{data.jobs.length?data.jobs.map(row=><div key={row.id} className="ca-v07-row"><span><strong>{row.title}</strong><small>J-{String(row.metadata.jobNo??"—")} · {PROC_LABELS[str(row.metadata.proc)]??str(row.metadata.proc)} · {DATE(row.created_at)}{queueLabel(row)}</small></span><Status value={row.status} job/><button onClick={()=>{setSelected(row);setResult(JSON.stringify(row.metadata.result??{},null,2));}}>자세히</button></div>):<Empty text="아직 내 AI 작업이 없습니다. 주제나 콘텐츠 화면에서 만들 수 있습니다."/>}</section>
      :tab==="browsers"?<><section className="ca-v07-card"><h2>내 컴퓨터 등록</h2><p>등록한 Chrome에만 작업을 전달합니다. 회사 서버는 Claude를 호출하지 않습니다.</p><div className="ca-v07-actions"><input aria-label="컴퓨터 이름" placeholder="이 컴퓨터 이름" value={name} onChange={event=>setName(event.target.value)}/><button className="primary" disabled={!name.trim()} onClick={()=>void doAction("/api/v1/content/automation/browsers/register",{name}).then(ok=>{if(ok)setName("");})}>+ 컴퓨터 추가</button></div></section>
        <section className="ca-v07-card"><h2>설정 순서</h2><ol><li>Chrome에 Claude in Chrome을 설치하고 내 계정으로 로그인합니다.</li><li>같은 Chrome에서 OS에 로그인하고 이 브라우저를 등록합니다.</li><li>아래 두 지시문을 Claude in Chrome 바로가기로 각각 저장합니다.</li><li>예약 지시문을 규칙에 적은 시각마다 예약합니다. OS의 시각을 바꾸면 Claude의 예약도 직접 바꿉니다.</li><li>/브랜디작업으로 시험해 실행 기록을 확인합니다.</li></ol>
          <div className="ca-v07-actions"><button onClick={()=>void navigator.clipboard.writeText(workerInstruction("sched",name||data.browsers.find(row=>row.is_main)?.name))}>/브랜디예약 지시문 복사</button><button onClick={()=>void navigator.clipboard.writeText(workerInstruction("now",name||data.browsers.find(row=>row.is_main)?.name))}>/브랜디작업 지시문 복사</button></div>
          <p>OS가 아는 것은 화면을 연 시각과 제출한 결과입니다. Chrome·Claude 로그인 상태와 실제 예약 설정은 직접 확인해야 합니다.</p></section>
        <section className="ca-v07-card"><h2>등록한 컴퓨터</h2>{data.browsers.length?data.browsers.map(row=><div className="ca-v07-row" key={row.id}><span><strong>{row.name} {row.is_main?"· 메인":""}</strong><small>{row.os} · 등록 {DATE(row.registered_at)} · 마지막 실행 {DATE(row.last_run_at)}</small></span>{!row.is_main?<button onClick={()=>{setBrowserAction({id:row.id,name:row.name,kind:"make-main"});setPreviousScheduleOff(false);}}>이 컴퓨터로 바꾸기</button>:null}<button onClick={()=>{setBrowserAction({id:row.id,name:row.name,kind:"remove"});setCleanup({shortcutsRemoved:false,scheduleRemoved:false,osSignedOut:false,localFilesRemoved:false});}}>빼기 · 정리</button></div>):<Empty text="등록된 컴퓨터가 없습니다."/>}</section></>
      :<section className="ca-v07-card"><h2>실행 기록</h2>{data.runs.length?data.runs.map(row=><div className="ca-v07-row" key={row.id}><span><strong>{row.status==="missing"?"기록 없음":row.via==="sched"?"예약 실행":"지금 실행"} · {row.status==="missing"?row.slot:row.status}</strong><small>{DATE(row.started_at)} {row.status==="missing"?"· 예약 시각이 지났지만 작업 화면 실행이 확인되지 않았습니다.":`→ ${DATE(row.ended_at)} · 완료 ${row.done_count} · 막힘 ${row.blocked_count}`}</small></span></div>):<Empty text="아직 실행 기록이 없습니다."/>}</section>}
    {selected?<Modal label="AI 작업 자세히" onClose={()=>setSelected(null)}><h2>{selected.title}</h2><p><Status value={selected.status} job/> · {PROC_LABELS[str(selected.metadata.proc)]}</p>
      {selected.stage==="completed"?<pre>{JSON.stringify(selected.metadata.result,null,2)}</pre>:null}
      {selected.status==="backlog"?<div className="ca-v07-actions"><button onClick={()=>void doAction("/api/v1/content/automation/jobs/"+selected.id+"/rush").then(ok=>{if(ok)setSelected(null);})}>맨 앞으로</button><button onClick={()=>void doAction("/api/v1/content/automation/jobs/"+selected.id+"/cancel").then(ok=>{if(ok)setSelected(null);})}>닫기</button></div>:null}
      {selected.status==="blocked"?<button onClick={()=>void doAction("/api/v1/content/automation/jobs/"+selected.id+"/requeue").then(ok=>{if(ok)setSelected(null);})}>다시 대기열에</button>:null}
      {selected.status==="backlog"?<><p>밖에서 결과를 만들었다면 공정 형식에 맞는 JSON을 붙여넣으세요.</p><textarea rows={9} value={result} onChange={event=>setResult(event.target.value)}/><button onClick={()=>{try{void doAction("/api/v1/content/automation/jobs/"+selected.id+"/paste",{result:JSON.parse(result)}).then(ok=>{if(ok)setSelected(null);});}catch{setError("결과 JSON 형식을 확인해 주세요.");}}}>결과 저장</button></>:null}
      <div className="ca-v07-actions"><button onClick={()=>setSelected(null)}>닫기</button></div></Modal>:null}
    {browserAction?<Modal label="컴퓨터 등록 변경 확인" onClose={()=>setBrowserAction(null)}><h2>{browserAction.name}</h2>
      {browserAction.kind==="make-main"?<><p>새 메인 컴퓨터에서 예약을 켜기 전에 이전 컴퓨터의 /브랜디예약 예약을 끄세요.</p><label className="ca-v07-check"><input type="checkbox" checked={previousScheduleOff} onChange={event=>setPreviousScheduleOff(event.target.checked)}/>이전 컴퓨터의 예약을 껐습니다</label></>
        :<><p>등록 키를 즉시 무효화합니다. 아래 네 가지를 실제로 마친 뒤 각각 체크해 주세요.</p>{([
          ["shortcutsRemoved","바로가기 두 개를 지웠습니다"],["scheduleRemoved","Claude in Chrome 예약을 지웠습니다"],
          ["osSignedOut","그 Chrome에서 OS와 Claude를 로그아웃했습니다"],["localFilesRemoved","내려받은 회사 자료를 정리했습니다"],
        ] as const).map(([key,label])=><label className="ca-v07-check" key={key}><input type="checkbox" checked={cleanup[key]} onChange={event=>setCleanup({...cleanup,[key]:event.target.checked})}/>{label}</label>)}</>}
      <div className="ca-v07-actions"><button onClick={()=>setBrowserAction(null)}>취소</button><button className="primary" disabled={browserAction.kind==="make-main"?!previousScheduleOff:!Object.values(cleanup).every(Boolean)} onClick={()=>void doAction(`/api/v1/content/automation/browsers/${browserAction.id}/${browserAction.kind}`,browserAction.kind==="make-main"?{previousScheduleOff}:{cleanup}).then(ok=>{if(ok)setBrowserAction(null);})}>{browserAction.kind==="make-main"?"메인으로 바꾸기":"등록 해제"}</button></div>
    </Modal>:null}
    {error?<p role="alert" className="ca-v07-error">{error}</p>:null}</>;
}

function SkillSettings({data,mutate}:ViewProps){
  const search=useSearchParams();
  const requested=search.get("proc")??"topic",proc=Object.hasOwn(PROC_LABELS,requested)?requested:"topic";
  const skills=data.skills.filter(row=>row.metadata.process===proc);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const selected=selectedId==="new"?null:skills.find(row=>row.id===selectedId)??skills.find(row=>row.metadata.active===true)??skills[0]??null;
  const [title,setTitle]=useState(""),[slug,setSlug]=useState(""),[body,setBody]=useState(""),[error,setError]=useState(""),[preview,setPreview]=useState(false);
  useEffect(()=>{setSelectedId(null);},[proc]);
  useEffect(()=>{setTitle(selected?.title??"");setSlug(str(selected?.metadata.slug));setBody(selected?.description??"");},[selected]);
  const save=async()=>{
    if(!title.trim()||!slug.trim()||!body.trim()){setError("이름·영문 스킬 이름·본문을 입력해 주세요.");return;}
    try{
      const path=selected?`/api/v1/content/automation/skills/${selected.id}`:"/api/v1/content/automation/skills";
      const response=await mutate(path,selected?"PATCH":"POST",selected
        ?{expectedVersion:selected.version,title,description:body,metadata:{slug}}
        :{title,description:body,metadata:{process:proc,slug,active:false}});
      const record=response.record as OsRecord;
      setSelectedId(record.id);setError("");
    }catch(issue){setError(issue instanceof Error?issue.message:"스킬을 저장하지 못했습니다.");}
  };
  const activate=async()=>{
    if(!selected)return;
    try{await mutate(`/api/v1/content/automation/skills/${selected.id}/activate`,"POST",{});setError("");}
    catch(issue){setError(issue instanceof Error?issue.message:"사용 중 스킬을 바꾸지 못했습니다.");}
  };
  const sections=["언제 쓰나","입력","절차","결과 형식","자가검수","하지 말 것"];
  return <div className="ca-v07-grid-two"><section className="ca-v07-card"><h2>공정마다 내 스킬 하나</h2><p>AI 작업을 만들 때 사용 중 버전을 고정합니다.</p>
    <div className="ca-v07-process-list">{Object.entries(PROC_LABELS).map(([key,label])=><Link key={key} className={proc===key?"active":""} href={`/automation/settings?tab=skills&proc=${key}`} onClick={()=>setSelectedId(null)}>{label}<small>{data.skills.find(row=>row.metadata.process===key&&row.metadata.active===true)?"사용 중":"기본 절차"}</small></Link>)}</div>
    <button type="button" onClick={()=>{setSelectedId("new");setTitle("");setSlug("");setBody("");}}>+ 새 스킬</button>
    {skills.map(row=><button type="button" key={row.id} className="ca-v07-row" onClick={()=>setSelectedId(row.id)}><span>{row.title} · v{row.version}</span><small>{row.metadata.active===true?"★ 사용 중":"초안"}</small></button>)}
  </section><section className="ca-v07-card ca-v07-form"><h2>{PROC_LABELS[proc]} 스킬 {selected?`· v${selected.version}`:"· 새로 만들기"}</h2>
    <label>이름<input value={title} onChange={event=>setTitle(event.target.value)}/></label>
    <label>AI가 찾는 이름<input value={slug} placeholder="my-process-skill" onChange={event=>setSlug(event.target.value.toLowerCase())}/></label>
    <label>본문(SKILL.md)<textarea rows={18} value={body} onChange={event=>setBody(event.target.value)}/></label>
    <small>{body.length}자 · {body.split("\n").length}줄</small><div className="ca-v07-checks">{sections.map(section=><span key={section}>{body.includes(section)?"✓":"○"} {section}</span>)}</div>
    <div className="ca-v07-actions"><label className="ca-v07-file">.md 올리기<input type="file" accept=".md,text/markdown,text/plain" onChange={async event=>{const file=event.target.files?.[0];if(file)setBody((await file.text()).slice(0,20_000));}}/></label>
      <button type="button" onClick={()=>setPreview(true)}>시험해 보기</button><button type="button" onClick={()=>void save()}>저장 {selected?`(v${selected.version+1})`:""}</button>
      {selected&&selected.metadata.active!==true?<button type="button" className="primary" onClick={()=>void activate()}>사용 중으로</button>:null}</div>
    {preview?<div className="ca-v07-note"><h3>AI 작업 화면에 보이는 지시문 예시</h3><pre>{`공정: ${PROC_LABELS[proc]}\n예시 주제: 고객 질문에 답하기\n승인·예약·게시·삭제하지 마세요.\n\n스킬 ${title} (${slug})\n${body}`}</pre><button onClick={()=>void navigator.clipboard.writeText(`공정: ${PROC_LABELS[proc]}\n${body}`)}>지시문 복사</button><button onClick={()=>setPreview(false)}>닫기</button></div>:null}
    {error?<p role="alert" className="ca-v07-error">{error}</p>:null}
  </section></div>;
}

type TemplatePage={type:string;name:string;bgPath:string;slots:CardSlot[]};
function TemplateEditor({record,mutate,onClose}:{record:OsRecord;mutate:ViewProps["mutate"];onClose:()=>void}){
  const {accessToken}=useSession();
  const [title,setTitle]=useState(record.title),[pages,setPages]=useState<TemplatePage[]>(
    Array.isArray(record.metadata.pages)?record.metadata.pages as TemplatePage[]:[]);
  const [pageIndex,setPageIndex]=useState(0),[slotName,setSlotName]=useState(""),[background,setBackground]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const canvas=useRef<HTMLDivElement>(null);
  const drag=useRef<{name:string;mode:"move"|"resize";x:number;y:number;original:CardSlot}|null>(null);
  const page=pages[pageIndex];
  const slot=page?.slots.find(item=>item.name===slotName)??page?.slots[0];
  useEffect(()=>{
    if(!accessToken||!page?.bgPath){return;}
    let active=true;
    void apiRequest<{url:string}>(`/api/v1/content/automation/uploads?path=${encodeURIComponent(page.bgPath)}`,{token:accessToken})
      .then(response=>{if(active)setBackground(response.url);})
      .catch(()=>{if(active)setBackground("");});
    return()=>{active=false;};
  },[accessToken,page?.bgPath]);
  const updatePage=(next:TemplatePage)=>setPages(previous=>previous.map((item,index)=>index===pageIndex?next:item));
  const updateSlot=(next:CardSlot)=>{
    if(!page||!slot)return;
    updatePage({...page,slots:page.slots.map(item=>item.name===slot.name?next:item)});
    setSlotName(next.name);
  };
  const addSlot=(type:"text"|"image")=>{
    if(!page)return;
    let number=1,name=type==="text"?"새 글 칸":"새 이미지 칸";
    while(page.slots.some(item=>item.name===name)){number+=1;name=`${type==="text"?"새 글 칸":"새 이미지 칸"} ${number}`;}
    const next:CardSlot={name,type,x:8+Math.min(page.slots.length*3,15),y:20+Math.min(page.slots.length*6,40),
      w:70,h:20,size:38,color:"#ffffff",weight:600,align:"left",lines:3,fit:"warn"};
    updatePage({...page,slots:[...page.slots,next]});setSlotName(name);
  };
  const addPage=async(file:File)=>{
    if(!accessToken)return;
    setBusy(true);setError("");
    try{
      const upload=await apiRequest<{path:string;token:string}>("/api/v1/content/automation/uploads",{
        method:"POST",token:accessToken,body:JSON.stringify({kind:"template",mime:file.type,size:file.size})});
      const client=getBrowserSupabase();if(!client)throw new Error("미디어 저장소를 사용할 수 없습니다.");
      const saved=await client.storage.from("os-content-media").uploadToSignedUrl(upload.path,upload.token,file,{contentType:file.type});
      if(saved.error)throw new Error("페이지 배경 파일을 올리지 못했습니다.");
      setPages(previous=>[...previous,{type:"body",name:file.name.replace(/\.[^.]+$/,"").slice(0,80),bgPath:upload.path,slots:[]}]);
      setPageIndex(pages.length);setSlotName("");
    }catch(issue){setError(issue instanceof Error?issue.message:"페이지를 추가하지 못했습니다.");}
    finally{setBusy(false);}
  };
  const save=async()=>{
    setBusy(true);setError("");
    try{await mutate(`/api/v1/content/automation/templates/${record.id}`,"PATCH",{
      expectedVersion:record.version,title,metadata:{pages}});onClose();}
    catch(issue){setError(issue instanceof Error?issue.message:"템플릿을 저장하지 못했습니다.");}
    finally{setBusy(false);}
  };
  const pointerMove=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(!drag.current||!canvas.current||!page)return;
    const rect=canvas.current.getBoundingClientRect(),state=drag.current;
    const deltaX=(event.clientX-state.x)/rect.width*100,deltaY=(event.clientY-state.y)/rect.height*100;
    const next=state.mode==="move"?{...state.original,x:Math.max(0,Math.min(100-state.original.w,state.original.x+deltaX)),
      y:Math.max(0,Math.min(100-state.original.h,state.original.y+deltaY))}:
      {...state.original,w:Math.max(2,Math.min(100-state.original.x,state.original.w+deltaX)),
        h:Math.max(2,Math.min(100-state.original.y,state.original.h+deltaY))};
    setPages(previous=>previous.map((item,index)=>index===pageIndex?{...item,slots:item.slots.map(current=>current.name===state.name?next:current)}:item));
  };
  return <section className="ca-v07-card ca-v07-template-editor"><div className="ca-v07-detail-head"><h2>템플릿 편집 · v{record.version}</h2><button onClick={onClose}>닫기</button></div>
    <label>템플릿 이름<input value={title} onChange={event=>setTitle(event.target.value)}/></label>
    <div className="ca-v07-toolbar">{pages.map((item,index)=><button className={pageIndex===index?"active":""} key={index} onClick={()=>{setPageIndex(index);setSlotName("");}}>{index+1} · {item.name} ({item.slots.length})</button>)}
      <label className="ca-v07-file">+ 페이지<input type="file" accept="image/png,image/jpeg" onChange={event=>{const file=event.target.files?.[0];if(file)void addPage(file);event.target.value="";}}/></label></div>
    {page?<div className="ca-v07-card-layout"><div className="ca-v07-page-list"><h3>이 페이지의 칸</h3>{page.slots.map(item=><button key={item.name} className={item.name===slot?.name?"active":""} onClick={()=>setSlotName(item.name)}>{item.name} · {item.type==="image"?"이미지":"글"}</button>)}
      <button onClick={()=>addSlot("text")}>+ 텍스트 칸</button><button onClick={()=>addSlot("image")}>+ 이미지 칸</button></div>
      <div className="ca-v07-canvas-wrap"><div ref={canvas} className="ca-v07-canvas" style={background?{backgroundImage:`url(${background})`}:undefined}
        onPointerMove={pointerMove} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
        {page.slots.map(item=><div key={item.name} className={`ca-v07-template-slot${item.name===slot?.name?" active":""}`} role="button" tabIndex={0}
          style={{left:item.x+"%",top:item.y+"%",width:item.w+"%",height:item.h+"%"}}
          onClick={()=>setSlotName(item.name)} onKeyDown={event=>{if(event.key==="Enter")setSlotName(item.name);}}
          onPointerDown={event=>{setSlotName(item.name);drag.current={name:item.name,mode:(event.target as HTMLElement).dataset.resize?"resize":"move",x:event.clientX,y:event.clientY,original:item};event.currentTarget.setPointerCapture(event.pointerId);}}>
          <span>{item.name}</span><i data-resize="true" aria-hidden="true"/></div>)}
      </div><small>칸을 끌어 옮기고 오른쪽 아래 모서리로 크기를 바꿉니다. 위치·크기 수치도 오른쪽에서 조절할 수 있습니다.</small></div>
      <div className="ca-v07-slot-editor"><h3>{slot?.name??"칸을 선택하세요"}</h3>{slot?<><label>칸 이름<input value={slot.name} onChange={event=>updateSlot({...slot,name:event.target.value})}/></label>
        <label>종류<select value={slot.type} onChange={event=>updateSlot({...slot,type:event.target.value})}><option value="text">글</option><option value="image">이미지</option></select></label>
        {(["x","y","w","h"] as const).map(key=><label key={key}>{key.toUpperCase()} (%)<input type="number" min="0" max="100" value={Math.round(slot[key])} onChange={event=>updateSlot({...slot,[key]:Number(event.target.value)})}/></label>)}
        {slot.type==="text"?<><label>글자 크기<input type="number" min="11" max="160" value={slot.size} onChange={event=>updateSlot({...slot,size:Number(event.target.value)})}/></label>
          <label>최대 줄 수<input type="number" min="1" max="30" value={slot.lines} onChange={event=>updateSlot({...slot,lines:Number(event.target.value)})}/></label>
          <label>글자 색<input type="color" value={slot.color} onChange={event=>updateSlot({...slot,color:event.target.value})}/></label>
          {slot.lines*slot.size*1.25/13.5>slot.h?<small className="ca-v07-error">정한 줄 수가 칸 높이에 들어가지 않을 수 있습니다.</small>:null}</>:null}
        <button onClick={()=>{updatePage({...page,slots:page.slots.filter(item=>item.name!==slot.name)});setSlotName("");}}>칸 삭제</button></>:null}</div></div>:null}
    {error?<p role="alert" className="ca-v07-error">{error}</p>:null}
    <div className="ca-v07-actions"><button className="primary" disabled={busy||!title.trim()} onClick={()=>void save()}>{busy?"저장 중…":"템플릿 저장"}</button></div>
  </section>;
}

function SettingsView({data,mutate}:ViewProps){
  const search=useSearchParams(),tab=["run","skills","templates","defaults"].includes(search.get("tab")??"")?search.get("tab")!:"run";
  const [rules,setRules]=useState<RunRules>({...DEFAULT_RUN_RULES}),[error,setError]=useState("");
  const [title,setTitle]=useState(""),[description,setDescription]=useState(""),[kind,setKind]=useState("templates");
  const [file,setFile]=useState<File|null>(null),[licenseSource,setLicenseSource]=useState("unknown"),[licenseNo,setLicenseNo]=useState("");
  const [vendor,setVendor]=useState(""),[purchasedAt,setPurchasedAt]=useState("");
  const [assetCategory,setAssetCategory]=useState("photo"),[alt,setAlt]=useState("");
  const [person,setPerson]=useState(false),[consentExpires,setConsentExpires]=useState(""),[busy,setBusy]=useState(false);
  const [openTemplateId,setOpenTemplateId]=useState<string|null>(null);
  const [previewTitle,setPreviewTitle]=useState(""),[previewBody,setPreviewBody]=useState("");
  const {accessToken,demo}=useSession();
  useEffect(()=>{setRules(data.rules??{...DEFAULT_RUN_RULES});},[data.rules]);
  useEffect(()=>{if(tab==="templates")setKind("templates");},[tab]);
  const saveRules=async()=>{try{await mutate("/api/v1/content/automation/run-rules","PUT",{
    enabled:rules.enabled,days:rules.days,times:rules.times,per_run:rules.per_run,daily_max:rules.daily_max,
    order_by:rules.order_by,long_only_now:rules.long_only_now,grace_minutes:rules.grace_minutes,
    lease_minutes:rules.lease_minutes,notify:rules.notify,defaults:rules.defaults??{},
  });setError("");}catch(issue){setError(issue instanceof Error?issue.message:"실행 규칙을 저장하지 못했습니다.");}};
  const create=async()=>{
    setBusy(true);
    try{
      if(kind==="assets"&&licenseSource==="stock"&&(!licenseNo.trim()||!vendor.trim()||!purchasedAt))throw new Error("스톡 이미지의 라이선스 번호·구매처·구매일을 입력해 주세요.");
      if(kind==="assets"&&person&&!consentExpires)throw new Error("인물 이미지의 동의 만료일을 입력해 주세요.");
      if(kind==="assets"&&!alt.trim())throw new Error("이미지의 대체 텍스트를 입력해 주세요.");
      const dimensions=kind==="assets"&&file?await createImageBitmap(file).then(image=>{
        const value={width:image.width,height:image.height};image.close();return value;
      }):{width:0,height:0};
      let storagePath="";
      if(file&&kind!=="skills"){
        if(!accessToken)throw new Error("로그인이 필요합니다.");
        const upload=await apiRequest<{path:string;token:string}>("/api/v1/content/automation/uploads",{
          method:"POST",token:accessToken,body:JSON.stringify({kind:kind==="assets"?"asset":"template",mime:file.type,size:file.size})});
        const client=getBrowserSupabase();
        if(!client)throw new Error("미디어 저장소를 사용할 수 없습니다.");
        const saved=await client.storage.from("os-content-media").uploadToSignedUrl(upload.path,upload.token,file,{contentType:file.type});
        if(saved.error)throw new Error("파일을 올리지 못했습니다. 다시 시도해 주세요.");
        storagePath=upload.path;
      }
      const metadata=kind==="assets"?{storagePath,category:assetCategory,alt:alt.trim(),...dimensions,
        license:{source:licenseSource,licenseNo:licenseNo.trim(),vendor:vendor.trim(),purchasedAt},consent:{person,expiresAt:consentExpires}}:
        {pages:[{type:"cover",name:"표지",bgPath:storagePath,slots:[{name:"제목",type:"text",x:8,y:40,w:84,h:22,size:56,color:"#ffffff",weight:700,align:"left",lines:3,fit:"warn"}]}]};
      await mutate("/api/v1/content/automation/"+kind,"POST",{title,description,metadata});
      setTitle("");setDescription("");setFile(null);setLicenseNo("");setVendor("");setPurchasedAt("");setAlt("");setError("");
    }
    catch(issue){setError(issue instanceof Error?issue.message:"저장하지 못했습니다.");}
    finally{setBusy(false);}
  };
  const values=kind==="templates"?data.templates:data.assets;
  const openTemplate=data.templates.find(row=>row.id===openTemplateId);
  return <><Tabs base="/automation/settings" active={tab} tabs={[{id:"run",label:"실행 규칙"},{id:"skills",label:"스킬"},{id:"templates",label:"템플릿·이미지"},{id:"defaults",label:"기본값"}]}/>
    {tab==="run"?<section className="ca-v07-card ca-v07-form"><h2>내 Chrome 실행 규칙</h2><label className="ca-v07-check"><input type="checkbox" checked={rules.enabled} onChange={event=>setRules({...rules,enabled:event.target.checked})}/>예약 실행 사용</label>
      <label>실행 요일<select value={rules.days} onChange={event=>setRules({...rules,days:event.target.value})}><option value="daily">매일</option><option value="weekdays">평일</option><option value="monday">월요일</option></select></label>
      <label>실행 시각(쉼표로 구분)<input value={rules.times.join(", ")} onChange={event=>setRules({...rules,times:event.target.value.split(",").map(value=>value.trim())})}/></label>
      <div className="ca-v07-form-grid"><label>한 번에<select value={rules.per_run} onChange={event=>setRules({...rules,per_run:Number(event.target.value)})}>{[1,3,5].map(value=><option key={value} value={value}>{value}개</option>)}</select></label><label>하루 최대<select value={rules.daily_max} onChange={event=>setRules({...rules,daily_max:Number(event.target.value)})}>{[10,15,30].map(value=><option key={value} value={value}>{value}개</option>)}</select></label><label>순서<select value={rules.order_by} onChange={event=>setRules({...rules,order_by:event.target.value})}><option value="due">마감순</option><option value="made">만든순</option><option value="proc">공정순</option></select></label></div>
      <label className="ca-v07-check"><input type="checkbox" checked={rules.long_only_now} onChange={event=>setRules({...rules,long_only_now:event.target.checked})}/>긴 작업은 지금 실행에서만</label>
      <p className="ca-v07-note">OS는 내 작업만 등록한 브라우저에 전달합니다. 승인·예약·게시 결정은 직원이 직접 합니다.</p><button className="primary" onClick={()=>void saveRules()}>실행 규칙 저장</button></section>
    :tab==="defaults"?<section className="ca-v07-card ca-v07-form"><h2>내 기본값</h2><p>나의 새 콘텐츠에 적용할 기본값입니다. 라이선스가 불명인 이미지는 발행 준비로 넘길 수 없습니다.</p>
      <label>기본 AI 처리<select value={str(rules.defaults?.sendMode)||"queue"} onChange={event=>setRules({...rules,defaults:{...rules.defaults,sendMode:event.target.value}})}><option value="queue">예약 대기열</option><option value="ask">매번 고르기</option><option value="copy">복사해서 처리</option></select></label>
      <label>기본 카드뉴스 템플릿<select value={str(rules.defaults?.templateId)} onChange={event=>setRules({...rules,defaults:{...rules.defaults,templateId:event.target.value||null}})}><option value="">없음</option>{data.templates.map(row=><option value={row.id} key={row.id}>{row.title}</option>)}</select></label>
      <label>게시 알림(분 전)<input type="number" min="0" max="10080" value={Number(rules.defaults?.leadMinutes??30)} onChange={event=>setRules({...rules,defaults:{...rules.defaults,leadMinutes:Number(event.target.value)}})}/></label>
      <label>이미지 최소 짧은 변(px)<input type="number" min="1" max="10000" value={Number(rules.defaults?.minImageShortSide??1080)} onChange={event=>setRules({...rules,defaults:{...rules.defaults,minImageShortSide:Number(event.target.value)}})}/></label>
      <button className="primary" onClick={()=>void saveRules()}>기본값 저장</button></section>
    :tab==="skills"?<SkillSettings data={data} mutate={mutate}/>
    :<>{demo&&kind==="templates"?<section className="ca-v07-card ca-v07-form"><h2>카드 문구 미리보기 · 저장 없음</h2><label>미리보기 제목<input value={previewTitle} onChange={event=>setPreviewTitle(event.target.value)}/></label><label>미리보기 본문<textarea value={previewBody} onChange={event=>setPreviewBody(event.target.value)}/></label><div className="automation-template-preview"><h2>{previewTitle||"카드 제목"}</h2><p>{previewBody||"카드 본문"}</p></div></section>:null}<div className="ca-v07-toolbar"><select value={kind} onChange={event=>setKind(event.target.value)} aria-label="자료 종류"><option value="templates">템플릿</option><option value="assets">이미지</option></select></div>
      <section className="ca-v07-card ca-v07-form"><h2>내 템플릿·이미지</h2><label>이름<input value={title} onChange={event=>setTitle(event.target.value)}/></label>
        <label>{kind==="assets"?"이미지 파일":"템플릿 배경 파일"}<input type="file" accept={kind==="assets"?"image/png,image/jpeg,image/webp":"image/png,image/jpeg"} onChange={event=>setFile(event.target.files?.[0]??null)}/></label>
          {kind==="assets"?<><label>분류<select value={assetCategory} onChange={event=>setAssetCategory(event.target.value)}><option value="photo">사진</option><option value="logo">로고</option><option value="icon">아이콘</option><option value="frame">영상 장면</option><option value="other">기타</option></select></label><label>대체 텍스트<input value={alt} onChange={event=>setAlt(event.target.value)}/></label><label>출처<select value={licenseSource} onChange={event=>setLicenseSource(event.target.value)}><option value="unknown">모름 · 발행 불가</option><option value="own">직접 촬영</option><option value="designer">직접 제작</option><option value="stock">구매한 스톡</option></select></label>{licenseSource==="stock"?<><label>라이선스 번호<input value={licenseNo} onChange={event=>setLicenseNo(event.target.value)}/></label><label>구매처<input value={vendor} onChange={event=>setVendor(event.target.value)}/></label><label>구매일<input type="date" value={purchasedAt} onChange={event=>setPurchasedAt(event.target.value)}/></label></>:null}<label className="ca-v07-check"><input type="checkbox" checked={person} onChange={event=>setPerson(event.target.checked)}/>사람이 나옵니다</label>{person?<label>동의 만료일<input type="date" value={consentExpires} onChange={event=>setConsentExpires(event.target.value)}/></label>:null}</>:null}
        <button className="primary" onClick={()=>void create()} disabled={!title.trim()||busy||!file}>{busy?"저장 중…":"새 기록 저장"}</button></section>
      <section className="ca-v07-card"><h2>저장된 기록</h2>{values.length?values.map(row=><div className="ca-v07-row" key={row.id}><span><strong>{row.title}</strong><small>v{row.version} · {DATE(row.updated_at)}</small></span>{kind==="templates"?<button onClick={()=>setOpenTemplateId(row.id)}>칸 편집</button>:<small>{str((row.metadata.license as Record<string,unknown>|undefined)?.source)||"불명"} · {Number(row.metadata.width)||0}×{Number(row.metadata.height)||0}{Math.min(Number(row.metadata.width)||0,Number(row.metadata.height)||0)<Number(rules.defaults?.minImageShortSide??1080)?" · 해상도 경고":""}</small>}</div>):<Empty text="내 기록이 없습니다."/>}</section>
      {openTemplate?<TemplateEditor key={`${openTemplate.id}:${openTemplate.version}`} record={openTemplate} mutate={mutate} onClose={()=>setOpenTemplateId(null)}/>:null}</>}
    {error?<p role="alert" className="ca-v07-error">{error}</p>:null}</>;
}
