"use client";
import { useEffect, useState } from "react";
import { apiRequest, listDocuments } from "@/lib/api-client";
import { getDemoKnowledgeDocuments } from "@/lib/demo-knowledge-store";
import type { KnowledgeDocument } from "@/lib/types";
import { knowledgeFacets } from "@/lib/knowledge-facets";
import { KnowledgeModal } from "./knowledge-modal";
import { statusLabel } from "./dashboard";

export function KnowledgeDocumentFinder({token,demo,onSelect,onClose}: {token:string|null;demo:boolean;onSelect:(document:KnowledgeDocument)=>void;onClose:()=>void}) {
  const [filters,setFilters]=useState({q:"",folder:"",team:"",brand:"",tag:"",scope:"all"});
  const [applied,setApplied]=useState(filters);
  const [facets,setFacets]=useState<ReturnType<typeof knowledgeFacets>>({folders:[],teams:[],brands:[],tags:[]});
  const [page,setPage]=useState(0);
  const [documents,setDocuments]=useState<KnowledgeDocument[]>([]);
  const [total,setTotal]=useState(0);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState("");
  const [revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;if(demo){setFacets(knowledgeFacets(getDemoKnowledgeDocuments()));return;}apiRequest<ReturnType<typeof knowledgeFacets>>("/api/v1/documents/index?facets=true&scope=all",{token}).then(result=>{if(active)setFacets(result);}).catch(()=>{});return()=>{active=false;};},[demo,token]);
  useEffect(()=>{
    let active=true;setBusy(true);setError("");
    const run=async()=>{
      if(demo){const matches=getDemoKnowledgeDocuments().filter(row=>(applied.scope==="archived"?row.status==="archived":row.status!=="archived")&&(applied.scope!=="canonical"||row.status==="canonical")&&(!applied.folder||row.folder===(applied.folder==="분류 없음"?"":applied.folder))&&(!applied.team||row.team===applied.team)&&(!applied.brand||row.brand===applied.brand)&&(!applied.tag||row.tags.includes(applied.tag))&&`${row.title} ${row.content_md} ${row.source_ref??""}`.toLocaleLowerCase("ko-KR").includes(applied.q.toLocaleLowerCase("ko-KR")));return{documents:matches.slice(page*50,(page+1)*50),total:matches.length};}
      const params=new URLSearchParams({...applied,view:"summary",limit:"50",offset:String(page*50)});if(applied.folder)params.set("exactFolder","true");
      return listDocuments(token,params.toString());
    };
    void run().then(result=>{if(active){setDocuments(result.documents);setTotal(result.total);}}).catch(reason=>{if(active){setError(reason instanceof Error?reason.message:"문서를 찾지 못했습니다.");setDocuments([]);setTotal(0);}}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[applied,page,demo,token,revision]);
  return <KnowledgeModal title="문서 찾기" onClose={onClose}><div className="form-modal p2-finder"><header><h2>문서 찾기</h2><button aria-label="문서 찾기 닫기" onClick={onClose}>×</button></header><form className="form-fields" onSubmit={event=>{event.preventDefault();setApplied({...filters,q:filters.q.trim(),team:filters.team.trim(),brand:filters.brand.trim(),tag:filters.tag.trim()});setPage(0);setRevision(value=>value+1);}}><label className="wide">제목·본문·원본 경로<input value={filters.q} onChange={event=>setFilters({...filters,q:event.target.value})} maxLength={200}/></label><label>폴더<select value={filters.folder} onChange={event=>setFilters({...filters,folder:event.target.value})}><option value="">전체 폴더</option>{facets.folders.map(folder=><option key={folder}>{folder}</option>)}</select></label><label>범위<select value={filters.scope} onChange={event=>setFilters({...filters,scope:event.target.value})}><option value="all">전체 활성 문서</option><option value="canonical">회사 정본</option><option value="archived">휴지통</option></select></label>{(["team","brand","tag"] as const).map(key=><label key={key}>{{team:"담당 팀",brand:"브랜드",tag:"태그"}[key]}<input list={`finder-${key}`} value={filters[key]} maxLength={120} onChange={event=>setFilters({...filters,[key]:event.target.value})} placeholder="선택하거나 정확한 이름 입력"/><datalist id={`finder-${key}`}>{facets[`${key}s` as "teams"|"brands"|"tags"].map(value=><option key={value} value={value}/>)}</datalist></label>)}<div className="p2-toolbar"><button className="primary-button">찾기</button><button type="button" className="ghost-button" onClick={()=>{const empty={q:"",folder:"",team:"",brand:"",tag:"",scope:"all"};setFilters(empty);setApplied(empty);setPage(0);}}>필터 초기화</button></div></form><div className="p2-finder-results" aria-live="polite">{error?<p role="alert" className="inline-alert danger">{error}<button onClick={()=>setRevision(value=>value+1)}>다시 시도</button></p>:busy?<p>문서를 찾는 중…</p>:<><p>{total}개 결과 · {page*50+Math.min(total,1)}–{Math.min(total,(page+1)*50)}</p><div className="p2-document-list">{documents.map(row=><button key={row.id} onClick={()=>onSelect(row)}><strong>{row.title}</strong><small>{row.folder||"분류 없음"}/{row.title} · {statusLabel(row.status)} · v{row.current_version}</small><small>{row.team||"팀 없음"} · {row.brand||"브랜드 없음"} · {row.tags.join(", ")}</small></button>)}</div>{!documents.length?<p className="quiet-state">조건에 맞는 문서가 없습니다. 검색어와 필터를 확인해 주세요.</p>:null}</>}</div><footer><button disabled={busy||!page} onClick={()=>setPage(value=>value-1)}>이전 결과</button><span>{page+1} / {Math.max(1,Math.ceil(total/50))}</span><button disabled={busy||(page+1)*50>=total} onClick={()=>setPage(value=>value+1)}>다음 결과</button></footer></div></KnowledgeModal>;
}
