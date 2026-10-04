"use client";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {useEffect,useMemo,useState} from "react";
import {getDocument,listDocuments} from "@/lib/api-client";
import {getDemoKnowledgeDocuments} from "@/lib/demo-knowledge-store";
import type {KnowledgeDocument} from "@/lib/types";
import {useSession} from "./session-provider";
import {PageTitle} from "./page-title";
import {KnowledgeInlineProvider} from "./knowledge-inline";
import {MarkdownView} from "./knowledge-workspace";
import {KnowledgeReviewHistory} from "./knowledge-review-history";
import {SkillsWorkspace} from "./skills-workspace";
import {WorkspaceSection} from "./workspace-section";

/** Read projection of existing canonical documents; promotion remains in the approval flow. */
export function KnowledgeCanonWorkspace(){
  const {demo,accessToken}=useSession();
  const params=useSearchParams();
  const [documents,setDocuments]=useState<KnowledgeDocument[]>([]),[total,setTotal]=useState(0),[offset,setOffset]=useState(0);
  const [selectedId,setSelectedId]=useState(params.get("document")??""),[selected,setSelected]=useState<KnowledgeDocument|null>(null);
  const [query,setQuery]=useState(""),[folder,setFolder]=useState(""),[view,setView]=useState("source");
  const [loading,setLoading]=useState(true),[reading,setReading]=useState(false),[error,setError]=useState(""),[readError,setReadError]=useState("");
  const [revision,setRevision]=useState(0);
  useEffect(()=>{setDocuments([]);setTotal(0);setOffset(0);setSelected(null);},[demo,accessToken]);
  useEffect(()=>{
    let active=true;setLoading(true);setError("");
    if(!demo&&!accessToken)return;
    const request=demo?Promise.resolve({documents:getDemoKnowledgeDocuments().filter(row=>row.status==="canonical"),total:undefined}):listDocuments(accessToken,`view=summary&statuses=canonical&limit=200&offset=${offset}`);
    request.then(result=>{if(!active)return;setDocuments(previous=>offset?[...new Map([...previous,...result.documents].map(row=>[row.id,row])).values()]:result.documents);setTotal(result.total??result.documents.length);}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:"정본 목록을 불러오지 못했습니다.");}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[demo,accessToken,offset,revision]);
  const visible=useMemo(()=>documents.filter(row=>(!folder||row.folder===folder)&&`${row.title} ${row.folder} ${row.tags.join(" ")}`.toLocaleLowerCase("ko-KR").includes(query.trim().toLocaleLowerCase("ko-KR"))),[documents,query,folder]);
  const currentId=visible.some(row=>row.id===selectedId)?selectedId:visible[0]?.id??"";
  useEffect(()=>{
    let active=true;setSelected(null);setReadError("");setReading(Boolean(currentId));
    if(!currentId)return;
    const request=demo?Promise.resolve({document:getDemoKnowledgeDocuments().find(row=>row.id===currentId)!}):getDocument(accessToken,currentId);
    request.then(result=>{if(active&&result.document.status==="canonical")setSelected(result.document);else if(active)setReadError("정본 상태가 바뀌었습니다. 목록을 새로고침해 주세요.");}).catch(reason=>{if(active)setReadError(reason instanceof Error?reason.message:"원문을 불러오지 못했습니다.");}).finally(()=>{if(active)setReading(false);});
    return()=>{active=false;};
  },[demo,accessToken,currentId,revision]);
  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle/><p>승인된 회사 원문과 연결된 실행 규칙을 관리합니다. 원문 변경은 기존 검토·승인 절차를 따릅니다.</p></div><div className="header-actions"><button className="secondary-button" disabled={loading||reading} onClick={()=>{setOffset(0);setRevision(value=>value+1);}}>원문 새로고침</button><Link className="primary-button" href="/knowledge?new=1">정본 등록 시작</Link></div></header>
    <p className="fullscreen-canon-caption">등록은 개인 초안 작성부터 시작합니다. 외부 원문 자동 동기화·AI 규칙 추출은 연결된 기능이 아니며, 현재 원문과 실행 규칙은 각각 문서·Skill에서 수정합니다.</p>
    {error?<p role="alert" className="inline-alert danger">{error}<button onClick={()=>setRevision(value=>value+1)}>다시 불러오기</button></p>:null}
    <div className="fullscreen-canon-layout"><aside className="panel fullscreen-canon-list" aria-label="회사 정본 목록"><header><h2>회사 정본</h2><span>{loading?"불러오는 중…":`${documents.length} / ${total}개`}</span></header><label>정본 찾기<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="제목·폴더·태그"/></label><label>폴더<select value={folder} onChange={event=>setFolder(event.target.value)}><option value="">전체 폴더</option>{[...new Set(documents.map(row=>row.folder))].filter(Boolean).sort().map(path=><option key={path}>{path}</option>)}</select></label>{visible.map(row=><button className="canon-document" key={row.id} aria-pressed={currentId===row.id} onClick={()=>{setSelectedId(row.id);setView("source");}}><strong>{row.title}</strong><small>{row.folder||"분류 없음"} · v{row.current_version}</small></button>)}{!loading&&!visible.length?<p className="quiet-state">조건에 맞는 정본이 없습니다.</p>:null}{documents.length<total?<button className="secondary-button" disabled={loading} onClick={()=>setOffset(documents.length)}>정본 더 불러오기</button>:null}<small>검색·폴더 필터는 불러온 정본 범위입니다.</small></aside>
    <section className="panel fullscreen-canon-detail" aria-label="정본 상세"><nav className="studio-tabs" aria-label="정본 상세 보기">{[["source","원문"],["history","검토 이력"],["rules","실행 규칙"]].map(([id,label])=><button key={id} aria-pressed={view===id} className={view===id?"active":""} onClick={()=>setView(id)}>{label}</button>)}</nav>{view==="rules"?<WorkspaceSection title="연결된 실행 규칙"><SkillsWorkspace key={currentId} sourceDocumentId={currentId||undefined}/></WorkspaceSection>:reading?<p role="status">원문 불러오는 중…</p>:readError?<p role="alert" className="inline-alert danger">{readError}</p>:selected?<><header><span className="status-pill status-canonical">회사 정본</span><h2>{selected.title}</h2><dl><div><dt>현재 버전</dt><dd>v{selected.current_version}</dd></div><div><dt>위치</dt><dd>{selected.folder||"분류 없음"}</dd></div><div><dt>팀 · 브랜드</dt><dd>{[selected.team,selected.brand].filter(Boolean).join(" · ")||"미지정"}</dd></div></dl><Link className="secondary-button" href={`/knowledge?document=${encodeURIComponent(selected.id)}`}>원문 열기 · 변경 제안</Link></header>{view==="history"?<KnowledgeReviewHistory id={selected.id} token={accessToken} demo={demo} revision={selected.updated_at}/>:<div className="markdown-view"><KnowledgeInlineProvider documentId={selected.id} revision={selected.current_version}><MarkdownView content={selected.content_md} onOpenLink={title=>{window.location.assign(`/knowledge/search?q=${encodeURIComponent(title)}`);}}/></KnowledgeInlineProvider></div>}</>:<div className="empty-state"><h2>정본을 선택해 주세요</h2><p>공개된 회사 정본이 없으면 초안을 작성하고 검토를 요청하세요.</p></div>}</section></div>
  </>;
}
