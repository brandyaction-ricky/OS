"use client";

import { PageTitle } from "./page-title";

import { WorkspaceLoadState } from "./workspace-load-state";
import { RefreshCw, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getKnowledgeGraph, listMembers, repairKnowledgeLinks, setDocumentSteward, type OsMember } from "@/lib/api-client";
import { getDemoKnowledgeDocuments } from "@/lib/demo-knowledge-store";
import { buildKnowledgeGraph, type BrokenKnowledgeLink, type KnowledgeGraph } from "@/lib/knowledge-links";
import { graphView } from "@/lib/knowledge-graph-view";
import { statusLabel } from "./dashboard";
import { useSession } from "./session-provider";

export function KnowledgeGraphWorkspace() {
  const { demo, accessToken, profile } = useSession();
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
  const [stewardless, setStewardless] = useState(false);
  const [members, setMembers] = useState<OsMember[]>([]);
  const [repair, setRepair] = useState<{ oldTarget: string; sources: BrokenKnowledgeLink[] } | null>(null);
  const [repairQuery, setRepairQuery] = useState("");
  const [repairTargetId, setRepairTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
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
  useEffect(() => { if (!demo && profile?.role === "admin") void listMembers(accessToken).then((response) => setMembers(response.members)).catch(() => setMembers([])); }, [accessToken, demo, profile?.role]);
  const view = useMemo(() => graphView(graph, selectedId, query, folder, depth, limit), [graph, selectedId, query, folder, depth, limit]);
  const selected = graph.nodes.find(node => node.id === selectedId);
  const folders = [...new Set(graph.nodes.map(node => node.folder).filter(Boolean))].sort();
  const linked = (direction: "incoming" | "outgoing") => graph.edges.filter(edge => direction === "incoming" ? edge.target === selectedId : edge.source === selectedId).map(edge => graph.nodes.find(node => node.id === (direction === "incoming" ? edge.source : edge.target))!).filter(Boolean);
  const broken = graph.broken.filter(item => (!brokenType || (item.reason ?? "missing") === brokenType) && (!folder || graph.nodes.some(node => node.id === item.sourceId && (node.folder === folder || node.folder.startsWith(folder + "/")))) && (!stewardless || graph.nodes.some(node => node.id === item.sourceId && node.status === "canonical" && !node.stewardId)) && `${item.sourceTitle} ${item.targetTitle}`.toLocaleLowerCase("ko-KR").includes(brokenQuery.trim().toLocaleLowerCase("ko-KR")));
  const repairChoices = graph.nodes.filter(node => `${node.folder}/${node.title}`.toLocaleLowerCase("ko-KR").includes(repairQuery.trim().toLocaleLowerCase("ko-KR"))).slice(0, 30);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(view.matches.length / 50) - 1));
  const currentBrokenPage = Math.min(brokenPage, Math.max(0, Math.ceil(broken.length / 50) - 1));
  const positioned = new Map(view.nodes.map((node, index) => {
    const center = node.id === selectedId;
    const n = view.ids.has(selectedId ?? "") ? index - 1 : index;
    const angle = n / Math.max(1, view.nodes.length - (view.ids.has(selectedId ?? "") ? 1 : 0)) * Math.PI * 2;
    return [node.id, center ? {x:450,y:260} : {x:450 + Math.cos(angle)*365,y:260 + Math.sin(angle)*210}];
  }));
  const select = (id: string) => { setSelectedId(id); setLimit(24); };
  const beginRepair = (item: BrokenKnowledgeLink, all: boolean) => {
    setRepair({ oldTarget: item.targetTitle, sources: all ? broken.filter(row => row.targetTitle === item.targetTitle).slice(0, 50) : [item] });
    setRepairQuery(item.targetTitle); setRepairTargetId(item.candidates?.[0]?.id ?? ""); setNotice("");
  };
  const submitRepair = async () => {
    if (!repair || !repairTargetId) return;
    const sources = repair.sources.flatMap((item) => {
      const source = graph.nodes.find((node) => node.id === item.sourceId);
      return source?.currentVersion ? [{ id: source.id, expectedVersion: source.currentVersion }] : [];
    });
    if (sources.length !== repair.sources.length) { setNotice("원본 버전을 확인할 수 없습니다. 연결 새로고침 후 다시 시도해 주세요."); return; }
    setBusy(true);
    try {
      const result = await repairKnowledgeLinks(accessToken, { oldTarget: repair.oldTarget, targetId: repairTargetId, sources });
      const updated = result.results.filter(row => row.outcome === "updated").length;
      const proposed = result.results.filter(row => row.outcome === "proposal").length;
      const failed = result.results.filter(row => row.outcome === "failed");
      setNotice(`즉시 수정 ${updated}건 · 정본 변경 제안 ${proposed}건 · 실패 ${failed.length}건${failed.length ? ` (${failed.map(row => row.message).join(", ")})` : ""}. 정본 링크는 승인 후 사라집니다.`);
      setRepair(null); await load();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "링크를 수정하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const saveSteward = async (stewardId: string) => {
    if (!selected?.currentVersion) return;
    setBusy(true); setNotice("");
    try { await setDocumentSteward(accessToken, selected.id, selected.currentVersion, stewardId || null); setNotice("문서 담당을 저장했습니다."); await load(); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : "문서 담당을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle /><p>[[문서명]] 연결을 탐색합니다. 제목이 겹치면 폴더를 포함한 전체 경로로 연결해 주세요.</p></div><Link className="primary-button" href="/knowledge">문서 작업공간 <ExternalLink size={15}/></Link></header>
    <div className="p2-toolbar">{!loading && !error ? <span>볼 수 있는 문서 {graph.nodes.length} · 전체 연결 {graph.totalLinks ?? graph.edges.length + graph.broken.length} · 깨진 링크 {graph.broken.length} / {graph.totalLinks ?? graph.edges.length + graph.broken.length}</span> : null}<button className="secondary-button" disabled={loading} onClick={() => void load()}><RefreshCw size={15}/> {loading ? "갱신 중…" : "연결 새로고침"}</button></div>
    {notice ? <p role="status" className="inline-alert">{notice}</p> : null}
    {error ? <p role="alert" className="inline-alert danger">{error} 기존 결과가 표시될 수 있습니다.</p> : null}
    <WorkspaceLoadState loading={loading} error={error} retry={load}>
    <section className="knowledge-graph-layout"><div className="panel knowledge-graph-main">
      <div className="p2-toolbar"><label>문서 검색<input value={query} onChange={event => {setQuery(event.target.value);setPage(0);}} placeholder="제목 또는 폴더 경로"/></label><label>폴더<select value={folder} onChange={event => {setFolder(event.target.value);setPage(0);setBrokenPage(0);}}><option value="">전체 폴더</option>{folders.map(path => <option key={path}>{path}</option>)}</select></label><label>연결 깊이<select value={depth} onChange={event => setDepth(Number(event.target.value))}><option value="1">직접 연결</option><option value="2">2단계 연결</option></select></label><button className="secondary-button" aria-pressed={list} onClick={() => setList(!list)}>{list ? "지도 보기" : "전체 목록 보기"}</button><button className="ghost-button" onClick={() => setSelectedId(null)}>선택 해제</button></div>
      <p className="p2-caption">조건에 맞는 문서 {view.matches.length}개 · 지도 {view.nodes.length}개 표시 (최대 72개){selected ? ` · 선택: ${selected.title}` : ""}</p>
      {!view.matches.length ? <p className="quiet-state">조건에 맞는 문서가 없습니다. 검색어나 폴더를 변경해 주세요.</p> : list ? <><div className="p2-document-list">{view.matches.slice(currentPage*50,(currentPage+1)*50).map(node => <button key={node.id} onClick={() => select(node.id)} aria-pressed={node.id === selectedId}><strong>{node.title}</strong><small>{node.folder || "분류 없음"} · 들어옴 {node.incoming} / 나감 {node.outgoing}</small></button>)}</div><div className="p2-toolbar"><button disabled={!currentPage} onClick={() => setPage(currentPage-1)}>이전 문서</button><span>{currentPage+1} / {Math.max(1,Math.ceil(view.matches.length/50))}</span><button disabled={(currentPage+1)*50 >= view.matches.length} onClick={() => setPage(currentPage+1)}>다음 문서</button></div></> : <><svg className="knowledge-graph-svg" viewBox="0 0 900 520" role="group" aria-label="지식 문서 연결 지도">{graph.edges.filter(edge => view.ids.has(edge.source) && view.ids.has(edge.target)).map(edge => {const a=positioned.get(edge.source)!,b=positioned.get(edge.target)!;return <line key={edge.source+edge.target} x1={a.x} y1={a.y} x2={b.x} y2={b.y}/>;})}{view.nodes.map(node => {const point=positioned.get(node.id)!;const active=node.id===selectedId;return <g key={node.id} role="button" tabIndex={0} className={active ? "active" : ""} aria-label={`${node.folder}/${node.title} 문서 선택`} onClick={() => select(node.id)} onKeyDown={event => {if(event.key === "Enter" || event.key === " "){event.preventDefault();select(node.id);}}}><title>{node.folder}/{node.title}</title><circle cx={point.x} cy={point.y} r={active?12:7} fill={node.status === "canonical" ? "var(--mint)" : ["review","reviewed"].includes(node.status) ? "var(--warning)" : node.status === "team" ? "var(--accent)" : "var(--muted)"}/>{active || view.nodes.length <= 24 ? <text x={point.x} y={point.y-16}>{node.title.length>16?node.title.slice(0,16)+"…":node.title}</text>:null}</g>;})}</svg><div className="p2-toolbar"><button className="secondary-button" disabled={limit>=72} onClick={() => setLimit(value => Math.min(72,value+24))}>지도에 더 표시</button><span>전체 문서와 긴 제목은 목록에서 확인할 수 있습니다.</span></div></>}
    </div><aside className="panel knowledge-graph-side">{selected ? <><span className={`status-pill status-${selected.status}`}>{statusLabel(selected.status)}</span><h2>{selected.title}</h2><p>{selected.folder || "분류 없음"}</p><Link className="secondary-button" href={`/knowledge?document=${selected.id}`}>문서 열기</Link>{graph.stewardReady && profile?.role === "admin" ? <label>문서 담당<select aria-label="문서 담당" value={selected.stewardId ?? ""} disabled={busy} onChange={(event) => void saveSteward(event.target.value)}><option value="">담당 없음</option>{members.filter(member => member.is_active).map(member => <option key={member.id} value={member.id}>{member.display_name || member.email}</option>)}</select></label> : null}{(["incoming","outgoing"] as const).map(direction => <div key={direction}><h3>{direction === "incoming" ? "백링크" : "나가는 링크"} {linked(direction).length}</h3><div className="graph-link-list">{linked(direction).map(node => <button key={node.id} onClick={() => select(node.id)}>{node.title}<small>{node.folder}</small></button>)}{!linked(direction).length ? <small>연결이 없습니다.</small> : null}</div></div>)}</> : <p className="quiet-state">지도 또는 전체 목록에서 문서를 선택하세요.</p>}</aside></section>
    <section className="panel p2-broken-links"><h2>깨진 링크</h2><p>원본과 대상의 버전을 확인하고 고칩니다. 정본은 변경 제안으로 보내며 승인 전까지 원문이 유지됩니다.</p><div className="p2-toolbar"><label>깨진 링크 검색<input value={brokenQuery} onChange={event => {setBrokenQuery(event.target.value);setBrokenPage(0);}} placeholder="대상 또는 원본 문서 제목"/></label><label>문제 유형<select value={brokenType} onChange={event => {setBrokenType(event.target.value);setBrokenPage(0);}}><option value="">전체 유형</option><option value="missing">대상 없음</option><option value="ambiguous">동일 이름 여러 개</option></select></label>{graph.stewardReady ? <label><input type="checkbox" checked={stewardless} onChange={event => {setStewardless(event.target.checked);setBrokenPage(0);}}/>담당 없는 정본</label> : null}<span>{broken.length} / 전체 연결 {graph.totalLinks ?? graph.edges.length + graph.broken.length}</span></div><div className="p2-document-list">{broken.slice(currentBrokenPage*50,(currentBrokenPage+1)*50).map((item,index) => <div key={`${item.sourceId}-${index}`}><Link href={`/knowledge?document=${item.sourceId}`}><strong>[[{item.targetTitle}]]</strong><small>원본: {item.sourceTitle} · {item.reason === "ambiguous" ? "같은 이름이 여러 개입니다. 경로를 지정하세요." : "대상 문서가 없습니다."}</small></Link>{item.candidates?.map(candidate => <Link key={candidate.id} href={`/knowledge?document=${candidate.id}`}>후보: {candidate.folder}/{candidate.title}</Link>)}{!demo ? <span><button className="secondary-button" onClick={() => beginRepair(item, false)}>링크 고치기</button>{broken.filter(row => row.targetTitle === item.targetTitle).length > 1 ? <button className="ghost-button" onClick={() => beginRepair(item, true)}>같은 링크 {Math.min(50, broken.filter(row => row.targetTitle === item.targetTitle).length)}곳 한 번에</button> : null}</span> : null}</div>)}</div>{!broken.length ? <p className="quiet-state">{graph.broken.length ? "조건에 맞는 깨진 링크가 없습니다." : "깨진 링크가 없습니다."}</p> : <div className="p2-toolbar"><button disabled={!currentBrokenPage} onClick={() => setBrokenPage(currentBrokenPage-1)}>이전 깨진 링크</button><span>{currentBrokenPage+1} / {Math.ceil(broken.length/50)}</span><button disabled={(currentBrokenPage+1)*50>=broken.length} onClick={() => setBrokenPage(currentBrokenPage+1)}>다음 깨진 링크</button></div>}</section>
    {stewardless && graph.stewardReady ? <section className="panel p2-broken-links"><h2>담당 없는 정본 {graph.nodes.filter(node => node.status === "canonical" && !node.stewardId).length}개</h2><div className="p2-document-list">{graph.nodes.filter(node => node.status === "canonical" && !node.stewardId).slice(0, 50).map(node => <button key={node.id} onClick={() => select(node.id)}><strong>{node.title}</strong><small>{node.folder || "분류 없음"} · 오른쪽에서 담당 지정</small></button>)}</div></section> : null}
    </WorkspaceLoadState>
    {repair ? <div className="drawer-backdrop" onMouseDown={event => {if (event.target === event.currentTarget && !busy) setRepair(null);}}><div className="side-drawer" role="dialog" aria-modal="true" aria-label="깨진 링크 고치기"><div className="drawer-header"><div><span className="eyebrow">문서 연결</span><h2>링크 고치기</h2></div><button className="icon-button" aria-label="닫기" onClick={() => setRepair(null)}>×</button></div><p>[[{repair.oldTarget}]] · 원본 {repair.sources.length}개 · 최대 50개</p><label>대상 문서 찾기<input value={repairQuery} onChange={event => {setRepairQuery(event.target.value);setRepairTargetId("");}} placeholder="문서 제목 또는 폴더" /></label><label>연결할 문서<select value={repairTargetId} onChange={event => setRepairTargetId(event.target.value)}><option value="">대상 선택</option>{repairChoices.map(node => <option key={node.id} value={node.id}>{node.folder}/{node.title}</option>)}</select></label><p>대상이 휴지통에 있다면 문서 작업공간에서 먼저 복원해 주세요.</p><div className="drawer-actions"><button className="secondary-button" onClick={() => setRepair(null)}>취소</button><button className="primary-button" disabled={busy || !repairTargetId} onClick={() => void submitRepair()}>{busy ? "수정 중…" : "링크 고치기"}</button></div></div></div> : null}
  </>;
}
