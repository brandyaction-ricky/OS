"use client";
import Link from "next/link";
import {useRouter,useSearchParams} from "next/navigation";
import {useEffect,useState} from "react";
import {Header,Empty,Card,SpaceBadge} from "./ui";
import {useKnowledge} from "./provider";
import {searchWorkspace,queryTerms,type KnowledgeSearchHit} from "@/lib/knowledge/search";
import {apiRequest} from "@/lib/api-client";
import {kstTime} from "@/lib/knowledge/model";
import {meetingDecisions} from "@/lib/knowledge/meetings";
function Highlight({text,query}:{text:string;query:string}){
  const terms=queryTerms(query).flat().filter(Boolean).sort((a,b)=>b.length-a.length);if(!terms.length)return text;
  // Tokenize without regex interpolation so a query is never executable syntax.
  const lower=text.toLowerCase();const nodes:React.ReactNode[]=[];let cursor=0,start=0;
  while(cursor<text.length){const hit=terms.find(t=>lower.startsWith(t,cursor));if(hit){if(start<cursor)nodes.push(text.slice(start,cursor));nodes.push(<mark key={cursor}>{text.slice(cursor,cursor+hit.length)}</mark>);cursor+=hit.length;start=cursor;}else cursor++;}
  if(start<text.length)nodes.push(text.slice(start));return nodes;
}
export function KnowledgeSearchPage(){
  const {state,actor,token,demo}=useKnowledge(),params=useSearchParams(),router=useRouter();
  const q=params.get("q")??"",space=params.get("space")??"all",includeMine=params.get("mine")==="1",includeAI=params.get("ai")==="1"&&actor.memberKind!=="partner";
  const [input,setInput]=useState(q),[composing,setComposing]=useState(false),[results,setResults]=useState<KnowledgeSearchHit[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[total,setTotal]=useState(0);
  const offset=Number(params.get("offset"))||0;
  function query(patch:Record<string,string>){const next=new URLSearchParams(params);Object.entries(patch).forEach(([k,v])=>v?next.set(k,v):next.delete(k));router.replace(`/knowledge/search?${next}`);}
  useEffect(()=>setInput(q),[q]);
  useEffect(()=>{if(composing||input===q)return;const timer=setTimeout(()=>{const next=new URLSearchParams(params);if(input.trim())next.set("q",input.trim());else next.delete("q");next.delete("offset");router.replace(`/knowledge/search?${next}`);},350);return()=>clearTimeout(timer);},[input,q,composing,params,router]);
  useEffect(()=>{
    const abort=new AbortController();let active=true;setError("");
    if(!q){setResults([]);setTotal(0);setLoading(false);return()=>abort.abort();}
    setLoading(true);
    if(demo){const rows=searchWorkspace(state.documents,q,{space,includeMine,includeAI,ownerId:actor.ownerId});setResults(rows.slice(offset,offset+50));setTotal(rows.length);setLoading(false);}
    else void apiRequest<{results:KnowledgeSearchHit[];total:number}>(`/api/v1/knowledge/search?q=${encodeURIComponent(q)}&space=${space}&includeMine=${includeMine}&includeAI=${includeAI}&offset=${offset}`,{token,signal:abort.signal}).then(result=>{if(active){setResults(result.results);setTotal(result.total);}}).catch(e=>{if(active&&!abort.signal.aborted){setError(e.message);setResults([]);}}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;abort.abort();};
  },[q,space,includeMine,includeAI,demo,token,state.documents,actor.ownerId,offset]);
  const decisionQuery=q.replace(/결정/g,"").trim().toLowerCase(),decisions=q.includes("결정")?meetingDecisions(state.meetings).filter(row=>row.confirmed&&(!decisionQuery||row.item.text.toLowerCase().includes(decisionQuery))).map(({meeting,item})=>({id:`${meeting.id}:${item.id}`,text:item.text,meeting})):[];
  return <><Header title="문서 찾기" description="제목·본문·결정 기록에서 찾습니다. 열람 권한이 있는 내용만 검색합니다."/><form className="kw-search-form" onSubmit={e=>{e.preventDefault();if(!composing)query({q:input.trim(),offset:""});}}><input aria-label="문서 검색어" placeholder="제목, 본문, 결정 키워드" value={input} onChange={e=>setInput(e.target.value)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)}/><button className="kw-primary" disabled={!input.trim()}>검색</button></form><div className="kw-toolbar"><select aria-label="검색 공간" value={space} onChange={e=>query({space:e.target.value,mine:e.target.value==="mine"?"1":params.get("mine")??"",offset:""})}>{[["all","전체 공간"],["mine","내 노트"],["team","팀 문서"],["canon","회사 정본"],["meet","회의록"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>{(space==="all"||space==="mine")&&<label className="kw-actions"><input type="checkbox" checked={includeMine} onChange={e=>query({mine:e.target.checked?"1":"",offset:""})}/>내 노트 포함</label>}{actor.memberKind!=="partner"&&<label className="kw-actions"><input type="checkbox" checked={includeAI} onChange={e=>query({ai:e.target.checked?"1":"",offset:""})}/>AI 기록 포함</label>}</div>
    {!q?<Empty>검색어를 입력하세요. 내 노트와 AI 기록은 기본 검색에서 제외됩니다.</Empty>:loading?<Empty>문서를 찾는 중입니다</Empty>:error?<p role="alert" className="kw-error">{error}</p>:<div className="kw-stack">{q.includes("결정")&&<Card title={`결정 기록 · ${decisions.length}`}>{decisions.map(i=><article className="kw-search-result" key={i.id}><Link href={`/knowledge/meetings/${i.meeting.id}`}><Highlight text={i.text} query={decisionQuery}/></Link><small>{i.meeting.title} · {i.meeting.metadata.reviewedAt?kstTime(i.meeting.metadata.reviewedAt):"시각 미기록"}</small></article>)}{!decisions.length&&<Empty>조건에 맞는 결정이 없습니다</Empty>}</Card>}{([["title","제목 일치"],["body","본문 일치"],["partial","일부 단어 일치"]] as const).map(([group,label])=>results.some(r=>r.group===group)&&<Card key={group} title={label}>{results.filter(r=>r.group===group).map(r=><article className="kw-search-result" key={r.id}><div className="kw-actions"><Link href={`/knowledge/${r.space==="canon"?"canon":"doc"}/${r.id}`}><Highlight text={r.title} query={q}/></Link><SpaceBadge space={r.space}/></div><p><Highlight text={r.excerpt} query={q}/></p><small>{kstTime(r.updatedAt)}</small></article>)}</Card>)}{!results.length&&!decisions.length&&<Empty>검색 결과가 없습니다. 검색 범위나 단어를 바꿔 보세요.</Empty>}{total>50&&<div className="kw-toolbar"><button disabled={!offset} onClick={()=>query({offset:String(Math.max(0,offset-50))})}>이전</button><small>{offset+1}–{Math.min(total,offset+50)} / {total}</small><button disabled={offset+50>=total} onClick={()=>query({offset:String(offset+50)})}>다음</button></div>}</div>}</>;
}
