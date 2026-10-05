"use client";
import {createContext,useCallback,useContext,useEffect,useMemo,useState} from "react";
import {usePathname,useSearchParams} from "next/navigation";
import Link from "next/link";
import {listAllRecordsOfType} from "@/lib/api-client";
import {demoRecord} from "@/lib/demo-record";
import {NAV_STAGES,findPage} from "@/lib/navigation";
import {defaultsToAll,workTopicSelection,workTopics,workTopicHref} from "@/lib/content-work-context";
import {productionStep,PRODUCTION_STEPS} from "@/lib/content-production-board";
import type {OsRecord,RecordType} from "@/lib/record-types";
import {useSession} from "./session-provider";
import {defaultGenerationMode,type GenerationMode} from "@/lib/content-generation-mode";
type WorkContext = {topics:OsRecord[];publications:OsRecord[];selected?:OsRecord;topicId:string;loading:boolean;error:string;generationMode:GenerationMode;select:(id:string)=>void;reload:()=>void};
const Context=createContext<WorkContext|null>(null);
const TYPES:RecordType[]=["content_topic","content_script","content_package","content_short","content_publish","company_setting"];
export function ContentWorkProvider({children}:{children:React.ReactNode}) {
  const path=usePathname(), search=useSearchParams(), {accessToken,demo,profile}=useSession();
  const enabled=path.startsWith("/content/");
  const [records,setRecords]=useState<OsRecord[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [saved,setSaved]=useState(""),[revision,setRevision]=useState(0);
  const storageKey=`brandy-os-work-topic:${profile?.id??"demo"}`;
  useEffect(()=>{try{setSaved(localStorage.getItem(storageKey)??"");}catch{setSaved("");}},[storageKey]);
  useEffect(()=>{
    let active=true;setRecords([]);setError("");
    if(!enabled){setLoading(false);return;}
    if(demo){setRecords([demoRecord({id:"demo-final-topic",recordType:"content_topic",title:"예시 · 첫 콘텐츠 제작",status:"planned",metadata:{origin:"own"}},"demo")]);setLoading(false);return;}
    if(!accessToken){setLoading(false);return;}
    setLoading(true);
    Promise.all(TYPES.map(type=>listAllRecordsOfType(accessToken,type))).then(results=>{if(active)setRecords(results.flat());}).catch(()=>{if(active)setError("작업 영상을 불러오지 못했습니다. 다시 불러와 주세요.");}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[enabled,accessToken,demo,profile?.id,revision]);
  const requested=search.get("topic")??search.get("sourceId");
  const topicId=workTopicSelection(records,requested,saved,defaultsToAll(path,search.get("tab")));
  const topics=useMemo(()=>workTopics(records),[records]);
  const selected=topics.find(row=>row.id===topicId);
  const select=useCallback((id:string)=>{
    setSaved(id);try{localStorage.setItem(storageKey,id);}catch{/* URL remains the source of truth. */}
    window.history.replaceState(null,"",workTopicHref(`${path}?${search}`,id));
  },[path,search,storageKey]);
  const reload=useCallback(()=>setRevision(value=>value+1),[]);
  const page=findPage(path), content=NAV_STAGES.find(stage=>stage.id==="content")!;
  const showProcess=enabled && Boolean(page.processNumber);
  const currentStep=selected?productionStep(selected,records):null;
  const completedThrough=currentStep?PRODUCTION_STEPS.findIndex(([key])=>key===currentStep):0;
  return <Context.Provider value={{topics,publications:records.filter(row=>row.record_type==="content_publish"),selected,topicId,loading,error,generationMode:defaultGenerationMode(records),select,reload}}>
    {showProcess?<section className="process-bar" data-ui="process-bar" aria-label="작업 중인 영상">
      <label><span className="process-bar-label">작업 중인 영상</span><select className="process-video" data-ui="process-video" aria-label="작업 중인 영상 선택" value={topicId} disabled={loading||Boolean(error)} onChange={event=>select(event.target.value)}><option value="">{loading?"불러오는 중…":"전체 영상"}</option>{topics.map(topic=><option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
      <nav className="process-steps" aria-label="콘텐츠 공정 순서"><span className="process-bar-label">공정</span>{content.pages.map((item,index)=>{
        const current=(page.navHref??page.href)===item.href;
        const done=Boolean(selected)&&index<completedThrough;
        return <Link key={item.href} href={workTopicHref(item.href,topicId)} data-ui={current?"process-step-current":"process-step"} aria-label={`${item.processNumber}. ${item.label}`} aria-current={current?"step":undefined} className={`process-step${current?" active current":done?" done":""}`} title={`${item.label} · ${current?"현재 화면":done?"저장된 산출물 있음 · 승인 별도 확인":"이동"}`}><span className={`process-icon ${current?"now":done?"done":"todo"}`} aria-hidden="true">{!current&&done?"✓":null}</span><span>{item.processNumber}{current?`. ${item.label}`:""}</span></Link>;
      })}</nav>
      {error?<span role="alert">{error}<button onClick={reload}>다시 불러오기</button></span>:requested&&requested!=="all"&&!loading&&!selected?<span role="status">이 영상은 접근할 수 없거나 우리 콘텐츠가 아닙니다.</span>:null}
    </section>:null}
    {children}
  </Context.Provider>;
}
export function useContentWork() {return useContext(Context);}
