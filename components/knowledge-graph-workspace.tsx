"use client";

import { RefreshCw, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getKnowledgeGraph } from "@/lib/api-client";
import { getDemoKnowledgeDocuments } from "@/lib/demo-knowledge-store";
import { buildKnowledgeGraph, type KnowledgeGraph } from "@/lib/knowledge-links";
import { graphView } from "@/lib/knowledge-graph-view";
import { statusLabel } from "./dashboard";
import { useSession } from "./session-provider";

export function KnowledgeGraphWorkspace() {
  const { demo, accessToken } = useSession();
  const [graph, setGraph] = useState<KnowledgeGraph>({ nodes: [], edges: [], broken: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("");
  const [depth, setDepth] = useState(1);
  const [limit, setLimit] = useState(24);
  const [list, setList] = useState(false);
  const [page, setPage] = useState(0);
  const [brokenQuery, setBrokenQuery] = useState("");
  const [brokenType, setBrokenType] = useState("");
  const [brokenPage, setBrokenPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const next = demo ? buildKnowledgeGraph(getDemoKnowledgeDocuments()) : await getKnowledgeGraph(accessToken);
      if (request !== generation.current) return;
      setGraph(next); setError("");
      setSelectedId(current => next.nodes.some(node => node.id === current) ? current : null);
    } catch (reason) { if (request === generation.current) setError(reason instanceof Error ? reason.message : "지식 연결을 불러오지 못했습니다."); }
    finally { if (request === generation.current) setLoading(false); }
  }, [demo, accessToken]);
  useEffect(() => { const requests = generation; void load(); const refresh = () => void load(); window.addEventListener("focus", refresh); return () => {requests.current++;window.removeEventListener("focus", refresh);}; }, [load]);
  const view = useMemo(() => graphView(graph, selectedId, query, folder, depth, limit), [graph, selectedId, query, folder, depth, limit]);
  const selected = graph.nodes.find(node => node.id === selectedId);
  const folders = [...new Set(graph.nodes.map(node => node.folder).filter(Boolean))].sort();
  const linked = (direction: "incoming" | "outgoing") => graph.edges.filter(edge => direction === "incoming" ? edge.target === selectedId : edge.source === selectedId).map(edge => graph.nodes.find(node => node.id === (direction === "incoming" ? edge.source : edge.target))!).filter(Boolean);
  const broken = graph.broken.filter(item => (!brokenType || (item.reason ?? "missing") === brokenType) && (!folder || graph.nodes.some(node => node.id === item.sourceId && (node.folder === folder || node.folder.startsWith(folder + "/")))) && `${item.sourceTitle} ${item.targetTitle}`.toLocaleLowerCase("ko-KR").includes(brokenQuery.trim().toLocaleLowerCase("ko-KR")));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(view.matches.length / 50) - 1));
  const currentBrokenPage = Math.min(brokenPage, Math.max(0, Math.ceil(broken.length / 50) - 1));
  const positioned = new Map(view.nodes.map((node, index) => {
    const center = node.id === selectedId;
    const n = view.ids.has(selectedId ?? "") ? index - 1 : index;
    const angle = n / Math.max(1, view.nodes.length - (view.ids.has(selectedId ?? "") ? 1 : 0)) * Math.PI * 2;
    return [node.id, center ? {x:450,y:260} : {x:450 + Math.cos(angle)*365,y:260 + Math.sin(angle)*210}];
  }));
  const select = (id: string) => { setSelectedId(id); setLimit(24); };
  return <>
    <header className="page-header"><div className="page-title-group"><span className="eyebrow">자동 지식 연결</span><h1>지식 연결</h1><p>[[문서명]] 연결을 탐색합니다. 제목이 겹치면 폴더를 포함한 전체 경로로 연결해 주세요.</p></div><Link className="primary-button" href="/knowledge">문서 작업공간 <ExternalLink size={15}/></Link></header>
    <div className="p2-toolbar"><span>문서 {graph.nodes.length} · 연결 {graph.edges.length} · 깨진 링크 {graph.broken.length}</span><button className="secondary-button" disabled={loading} onClick={() => void load()}><RefreshCw size={15}/> {loading ? "갱신 중…" : "연결 새로고침"}</button></div>
    {error ? <p role="alert" className="inline-alert danger">{error} 기존 결과가 표시될 수 있습니다.</p> : null}
    <section className="knowledge-graph-layout"><div className="panel knowledge-graph-main">
      <div className="p2-toolbar"><label>문서 검색<input value={query} onChange={event => {setQuery(event.target.value);setPage(0);}} placeholder="제목 또는 폴더 경로"/></label><label>폴더<select value={folder} onChange={event => {setFolder(event.target.value);setPage(0);setBrokenPage(0);}}><option value="">전체 폴더</option>{folders.map(path => <option key={path}>{path}</option>)}</select></label><label>연결 깊이<select value={depth} onChange={event => setDepth(Number(event.target.value))}><option value="1">직접 연결</option><option value="2">2단계 연결</option></select></label><button className="secondary-button" aria-pressed={list} onClick={() => setList(!list)}>{list ? "지도 보기" : "전체 목록 보기"}</button><button className="ghost-button" onClick={() => setSelectedId(null)}>선택 해제</button></div>
      <p className="p2-caption">조건에 맞는 문서 {view.matches.length}개 · 지도 {view.nodes.length}개 표시 (최대 72개){selected ? ` · 선택: ${selected.title}` : ""}</p>
      {!view.matches.length ? <p className="quiet-state">조건에 맞는 문서가 없습니다. 검색어나 폴더를 변경해 주세요.</p> : list ? <><div className="p2-document-list">{view.matches.slice(currentPage*50,(currentPage+1)*50).map(node => <button key={node.id} onClick={() => select(node.id)} aria-pressed={node.id === selectedId}><strong>{node.title}</strong><small>{node.folder || "분류 없음"} · 들어옴 {node.incoming} / 나감 {node.outgoing}</small></button>)}</div><div className="p2-toolbar"><button disabled={!currentPage} onClick={() => setPage(currentPage-1)}>이전 문서</button><span>{currentPage+1} / {Math.max(1,Math.ceil(view.matches.length/50))}</span><button disabled={(currentPage+1)*50 >= view.matches.length} onClick={() => setPage(currentPage+1)}>다음 문서</button></div></> : <><svg className="knowledge-graph-svg" viewBox="0 0 900 520" role="group" aria-label="지식 문서 연결 지도">{graph.edges.filter(edge => view.ids.has(edge.source) && view.ids.has(edge.target)).map(edge => {const a=positioned.get(edge.source)!,b=positioned.get(edge.target)!;return <line key={edge.source+edge.target} x1={a.x} y1={a.y} x2={b.x} y2={b.y}/>;})}{view.nodes.map(node => {const point=positioned.get(node.id)!;const active=node.id===selectedId;return <g key={node.id} role="button" tabIndex={0} className={active ? "active" : ""} aria-label={`${node.folder}/${node.title} 문서 선택`} onClick={() => select(node.id)} onKeyDown={event => {if(event.key === "Enter" || event.key === " "){event.preventDefault();select(node.id);}}}><title>{node.folder}/{node.title}</title><circle cx={point.x} cy={point.y} r={active?12:7} fill={node.status === "canonical" ? "var(--mint)" : ["review","reviewed"].includes(node.status) ? "var(--warning)" : node.status === "team" ? "var(--accent)" : "var(--muted)"}/>{active || view.nodes.length <= 24 ? <text x={point.x} y={point.y-16}>{node.title.length>16?node.title.slice(0,16)+"…":node.title}</text>:null}</g>;})}</svg><div className="p2-toolbar"><button className="secondary-button" disabled={limit>=72} onClick={() => setLimit(value => Math.min(72,value+24))}>지도에 더 표시</button><span>전체 문서와 긴 제목은 목록에서 확인할 수 있습니다.</span></div></>}
    </div><aside className="panel knowledge-graph-side">{selected ? <><span className={`status-pill status-${selected.status}`}>{statusLabel(selected.status)}</span><h2>{selected.title}</h2><p>{selected.folder || "분류 없음"}</p><Link className="secondary-button" href={`/knowledge?document=${selected.id}`}>문서 열기</Link>{(["incoming","outgoing"] as const).map(direction => <div key={direction}><h3>{direction === "incoming" ? "백링크" : "나가는 링크"} {linked(direction).length}</h3><div className="graph-link-list">{linked(direction).map(node => <button key={node.id} onClick={() => select(node.id)}>{node.title}<small>{node.folder}</small></button>)}{!linked(direction).length ? <small>연결이 없습니다.</small> : null}</div></div>)}</> : <p className="quiet-state">지도 또는 전체 목록에서 문서를 선택하세요.</p>}</aside></section>
    <section className="panel p2-broken-links"><h2>깨진 링크</h2><p>문서를 수정한 뒤 연결 새로고침으로 해결 여부를 확인하세요. 선택한 폴더의 원본 문서에 있는 링크를 표시합니다.</p><div className="p2-toolbar"><label>깨진 링크 검색<input value={brokenQuery} onChange={event => {setBrokenQuery(event.target.value);setBrokenPage(0);}} placeholder="대상 또는 원본 문서 제목"/></label><label>문제 유형<select value={brokenType} onChange={event => {setBrokenType(event.target.value);setBrokenPage(0);}}><option value="">전체 유형</option><option value="missing">대상 없음</option><option value="ambiguous">동일 이름 여러 개</option></select></label><span>{broken.length}개</span></div><div className="p2-document-list">{broken.slice(currentBrokenPage*50,(currentBrokenPage+1)*50).map((item,index) => <div key={`${item.sourceId}-${index}`}><Link href={`/knowledge?document=${item.sourceId}`}><strong>[[{item.targetTitle}]]</strong><small>원본: {item.sourceTitle} · {item.reason === "ambiguous" ? "같은 이름이 여러 개입니다. 경로를 지정하세요." : "대상 문서가 없습니다."}</small></Link>{item.candidates?.map(candidate => <Link key={candidate.id} href={`/knowledge?document=${candidate.id}`}>후보: {candidate.folder}/{candidate.title}</Link>)}</div>)}</div>{!broken.length ? <p className="quiet-state">{graph.broken.length ? "조건에 맞는 깨진 링크가 없습니다." : "깨진 링크가 없습니다."}</p> : <div className="p2-toolbar"><button disabled={!currentBrokenPage} onClick={() => setBrokenPage(currentBrokenPage-1)}>이전 깨진 링크</button><span>{currentBrokenPage+1} / {Math.ceil(broken.length/50)}</span><button disabled={(currentBrokenPage+1)*50>=broken.length} onClick={() => setBrokenPage(currentBrokenPage+1)}>다음 깨진 링크</button></div>}</section>
  </>;
}
