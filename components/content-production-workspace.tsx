"use client";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {listAllRecordsOfType} from "@/lib/api-client";
import {contentOrigin,type ContentOriginFilter as OriginFilter} from "@/lib/content-origin";
import {PRODUCTION_STEPS,productionStep,productionSources,productionHref,type ProductionStep} from "@/lib/content-production-board";
import {demoRecord} from "@/lib/demo-record";
import type {OsRecord,RecordType} from "@/lib/record-types";
import {ContentPipelinePanel} from "./content-pipeline-panel";
import {PageTitle} from "./page-title";
import {ContentOriginFilter} from "./content-origin-filter";
import {useSession} from "./session-provider";
import {WorkspaceSection} from "./workspace-section";
import {ContentRadarWorkspace} from "./content-radar-workspace";
import {ContentLinkedScripts} from "./content-linked-scripts";
import {ContentScriptsWorkspace} from "./content-pipeline-workspaces";
import {ContentPackagingWorkspace} from "./content-packaging-workspace";
import {ContentShortformWorkspace} from "./content-shortform-workspace";
import {YoutubeKitWorkspace} from "./content-studio-workspaces";
const demoSources=()=>[demoRecord({id:"demo-production-plan",recordType:"content_topic",title:"예시 · 새 콘텐츠 기획",status:"backlog",metadata:{origin:"own"}},"demo"),demoRecord({id:"demo-production-script",recordType:"content_topic",title:"예시 · 영상 원고 준비",status:"planned",metadata:{origin:"own"}},"demo")];
const TYPES:RecordType[]=["content_topic","content_package","content_script","content_short","content_publish"];
export function ContentProductionWorkspace({showPlanningHandoff=false,showJevAssist=false,showTopicJevAssist=false}:{showPlanningHandoff?:boolean;showJevAssist?:boolean;showTopicJevAssist?:boolean}) {
 const {accessToken,demo,profile}=useSession(),search=useSearchParams();const [records,setRecords]=useState<OsRecord[]>([]),[loading,setLoading]=useState(!demo),[error,setError]=useState("");const [origin,setOrigin]=useState<OriginFilter>("own"),[query,setQuery]=useState("");
 const [showPipeline,setShowPipeline]=useState(false);
 const sourceId=search.get("sourceId")??"",step=PRODUCTION_STEPS.find(([key])=>key===search.get("step"))?.[0]??"planning",tools=search.get("view")==="tools"&&!sourceId;
 const loadGeneration=useRef(0);
 const load=useCallback(async()=>{const generation=++loadGeneration.current;if(demo){setRecords(demoSources());setLoading(false);return;}setRecords([]);if(!accessToken){setLoading(false);return;}setLoading(true);setError("");try{const loaded=(await Promise.all(TYPES.map(type=>listAllRecordsOfType(accessToken,type)))).flat();if(generation===loadGeneration.current)setRecords(loaded);}catch{if(generation===loadGeneration.current)setError("제작 자료를 불러오지 못했습니다. 다시 불러와 주세요.");}finally{if(generation===loadGeneration.current)setLoading(false);}},[accessToken,demo]);
 useEffect(()=>{const lifecycle=loadGeneration;void load();return()=>{lifecycle.current++;};},[load,profile?.id]);
 const sources=useMemo(()=>productionSources(records,origin).filter(row=>`${row.title} ${row.brand}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())),[records,origin,query]);
 const selected=records.find(row=>row.id===sourceId&&row.record_type==="content_topic"&&!row.archived_at);
 const sample=()=>setRecords(demoSources());
 const renderStep=(key:ProductionStep)=><WorkspaceSection title={PRODUCTION_STEPS.find(([value])=>value===key)![1]} key={`${sourceId}:${key}`}>
  {key==="planning"?<ContentRadarWorkspace productionMode lockedSource={selected} showPlanningHandoff={showPlanningHandoff} showTopicJevAssist={showTopicJevAssist}/>:key==="script"?(selected?<ContentLinkedScripts lockedSourceId={selected.id} showPlanningHandoff={showPlanningHandoff}/>:<ContentScriptsWorkspace showPlanningHandoff={showPlanningHandoff}/>):key==="package"?<ContentPackagingWorkspace lockedSource={selected} showJevAssist={showJevAssist}/>:key==="short"?<ContentShortformWorkspace lockedSource={selected}/>:<YoutubeKitWorkspace lockedSource={selected}/>}
 </WorkspaceSection>;
 return <><header className="page-header"><div className="page-title-group"><PageTitle/><p>콘텐츠 하나에서 기획부터 발행까지 이어서 작업합니다.</p></div><div className="header-actions"><Link className="secondary-button" href="/content/topics">주제 찾기</Link><Link className="secondary-button" href="/content/production?view=tools&step=script">전체 원고·도구</Link></div></header>
 {demo?<p className="inline-alert">데모 · 실제 저장이나 발행을 실행하지 않습니다. <button className="ghost-button" onClick={sample}>예시 콘텐츠 보기</button></p>:null}
 {error?<p className="inline-alert danger" role="alert">{error}<button onClick={()=>void load()}>다시 불러오기</button></p>:null}
 {sourceId||tools?<><Link className="secondary-button" href="/content/production">제작 현황으로</Link><div className="production-detail-heading"><h2>{selected?.title??(tools?"공정별 도구":loading?"콘텐츠 불러오는 중…":"콘텐츠를 찾을 수 없습니다")}</h2>{selected?<span className="production-caption">{selected.brand||"브랜드 미정"} · {contentOrigin(selected)==="own"?"우리 콘텐츠":"선택한 콘텐츠 종류 확인"}</span>:null}</div>
 {(!sourceId||selected)?<><nav className="production-tabs" aria-label="콘텐츠 작업 단계">{PRODUCTION_STEPS.map(([key,label])=><Link className={step===key?"active":""} aria-current={step===key?"page":undefined} key={key} href={sourceId?productionHref(sourceId,key):`/content/production?view=tools&step=${key}`}>{label}</Link>)}</nav><div className={selected?"production-detail locked":"production-detail"}>{renderStep(step)}{selected?<details className="panel load-error" onToggle={event=>setShowPipeline(event.currentTarget.open)}><summary>제작 자산·전체 승인 현황</summary>{showPipeline?(demo?<p>데모에서는 승인·업로드·AI 실행을 하지 않습니다.</p>:<ContentPipelinePanel key={selected.id} sourceId={selected.id} onChange={async()=>{}}/>):null}</details>:null}</div></>:!loading?<p>보관 여부와 접근 권한을 확인하거나 제작 현황에서 다시 선택해 주세요.</p>:null}</>:<>
 <div className="production-toolbar"><ContentOriginFilter value={origin} onChange={setOrigin}/><input aria-label="제작 콘텐츠 검색" value={query} onChange={event=>setQuery(event.target.value)} placeholder="제목·브랜드 검색"/><button className="secondary-button" onClick={()=>void load()} disabled={loading||demo}>새로고침</button></div>
 <p className="production-caption">현재 필터의 보관 전 콘텐츠 {loading?"불러오는 중":`${sources.length}개`} · 각 열은 저장된 산출물을 기준으로 다음 작업을 안내합니다. 승인 여부는 상세에서 확인하세요.</p>
 <section className="production-board" aria-label="콘텐츠 제작 현황">{PRODUCTION_STEPS.map(([key,label])=>{const rows=sources.filter(source=>productionStep(source,records)===key);return <section className="production-column" key={key}><header><h2>{label}</h2><span>{loading?"—":`${rows.length} / ${sources.length}`}</span></header>{loading?<div className="loading-skeleton" aria-label="콘텐츠 불러오는 중"/>:rows.map(source=><Link className="production-card" key={source.id} href={productionHref(source.id,key)}><strong>{source.title}</strong><small>{source.brand||"브랜드 미정"} · {source.due_date?`기한 ${source.due_date}`:"기한 미정"}</small><small>{source.status==="published"?"발행 완료":"상세에서 이어하기"}</small></Link>)}{!loading&&!rows.length?<p>이 단계의 콘텐츠가 없습니다.</p>:null}</section>;})}</section>
 </>}
 </>;
}
