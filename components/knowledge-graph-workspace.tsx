"use client";

import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CircleDot, ExternalLink, Link2, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getKnowledgeGraph } from "@/lib/api-client";
import { DEMO_DOCUMENTS } from "@/lib/demo-data";
import { buildKnowledgeGraph, type KnowledgeGraph } from "@/lib/knowledge-links";
import { useSession } from "./session-provider";

const EMPTY_GRAPH: KnowledgeGraph = { nodes: [], edges: [], broken: [] };
const GRAPH_LIMIT = 72;

function nodeColor(status: string) {
  if (status === "canonical") return "#55d6b2";
  if (status === "review" || status === "reviewed") return "#ffb748";
  if (status === "team") return "#7d9bff";
  return "#697586";
}

export function KnowledgeGraphWorkspace() {
  const { demo, accessToken } = useSession();
  const [graph, setGraph] = useState<KnowledgeGraph>(EMPTY_GRAPH);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");

  useEffect(() => {
    if (demo) {
      const next = buildKnowledgeGraph(DEMO_DOCUMENTS);
      setGraph(next);
      setSelectedId(next.nodes.sort((a, b) => b.incoming + b.outgoing - a.incoming - a.outgoing)[0]?.id ?? null);
      return;
    }
    setLoading(true);
    getKnowledgeGraph(accessToken)
      .then((next) => {
        setGraph(next);
        setSelectedId(next.nodes.sort((a, b) => b.incoming + b.outgoing - a.incoming - a.outgoing)[0]?.id ?? null);
        setError("");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "지식 연결을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [accessToken, demo]);

  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const selected = selectedId ? nodesById.get(selectedId) ?? null : null;
  const incoming = useMemo(() => graph.edges.filter((edge) => edge.target === selectedId).map((edge) => nodesById.get(edge.source)).filter(Boolean), [graph.edges, nodesById, selectedId]);
  const outgoing = useMemo(() => graph.edges.filter((edge) => edge.source === selectedId).map((edge) => nodesById.get(edge.target)).filter(Boolean), [graph.edges, nodesById, selectedId]);

  const visible = useMemo(() => {
    const ids = new Set<string>();
    if (selectedId) ids.add(selectedId);
    for (const node of [...incoming, ...outgoing]) if (node) ids.add(node.id);
    const ranked = [...graph.nodes].sort((a, b) => b.incoming + b.outgoing - a.incoming - a.outgoing || a.title.localeCompare(b.title, "ko"));
    for (const node of ranked) {
      if (ids.size >= GRAPH_LIMIT) break;
      ids.add(node.id);
    }
    const nodes = [...ids].map((id) => nodesById.get(id)).filter(Boolean);
    const positioned = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, index) => {
      if (!node) return;
      if (node.id === selectedId) positioned.set(node.id, { x: 450, y: 260 });
      else {
        const ringIndex = selectedId ? index - (index > nodes.findIndex((item) => item?.id === selectedId) ? 1 : 0) : index;
        const ring = ringIndex < 24 ? 1 : 2;
        const count = ring === 1 ? Math.min(24, nodes.length - 1) : Math.max(1, nodes.length - 25);
        const itemIndex = ring === 1 ? ringIndex : ringIndex - 24;
        const angle = (itemIndex / count) * Math.PI * 2 - Math.PI / 2;
        const radiusX = ring === 1 ? 205 : 380;
        const radiusY = ring === 1 ? 145 : 225;
        positioned.set(node.id, { x: 450 + Math.cos(angle) * radiusX, y: 260 + Math.sin(angle) * radiusY });
      }
    });
    return { ids, nodes, positioned };
  }, [graph.nodes, incoming, nodesById, outgoing, selectedId]);

  const matches = useMemo(() => {
    const value = query.trim().toLocaleLowerCase("ko-KR");
    if (!value) return [];
    return graph.nodes.filter((node) => `${node.title} ${node.folder}`.toLocaleLowerCase("ko-KR").includes(value)).slice(0, 12);
  }, [graph.nodes, query]);

  return <>
    <header className="page-header">
      <div className="page-title-group"><span className="eyebrow">자동 지식 연결</span><h1>지식 연결</h1><p>문서 본문의 [[문서명]]을 기준으로 연결 지도·백링크·깨진 링크를 자동 계산합니다.</p></div>
      <Link className="primary-button" href="/knowledge"><ExternalLink size={15} /> 문서 작업공간</Link>
    </header>

    {error ? <div className="inline-alert danger"><AlertTriangle size={15} />{error}</div> : null}
    <section className="knowledge-graph-metrics">
      <div><CircleDot size={16} /><span><strong>{graph.nodes.length.toLocaleString("ko-KR")}</strong><small>문서</small></span></div>
      <div><Link2 size={16} /><span><strong>{graph.edges.length.toLocaleString("ko-KR")}</strong><small>자동 연결</small></span></div>
      <div className={graph.broken.length ? "warning" : ""}><AlertTriangle size={16} /><span><strong>{graph.broken.length.toLocaleString("ko-KR")}</strong><small>깨진 링크</small></span></div>
    </section>

    <section className="knowledge-graph-layout">
      <div className="knowledge-graph-main panel">
        <div className="graph-toolbar">
          <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="문서 이름으로 찾기" /></label>
          <span>{visible.nodes.length}개 노드 표시 · 선택 문서 주변 연결 우선</span>
        </div>
        {matches.length ? <div className="graph-search-results">{matches.map((node) => <button key={node.id} onClick={() => { setSelectedId(node.id); setQuery(""); }}><strong>{node.title}</strong><small>{node.folder || "분류 없음"}</small></button>)}</div> : null}
        {loading ? <div className="loading-state">문서 연결을 계산하는 중입니다.</div> : graph.nodes.length ? <svg className="knowledge-graph-svg" viewBox="0 0 900 520" role="img" aria-label="지식 문서 연결 지도">
          {graph.edges.filter((edge) => visible.ids.has(edge.source) && visible.ids.has(edge.target)).map((edge) => {
            const source = visible.positioned.get(edge.source); const target = visible.positioned.get(edge.target);
            return source && target ? <line key={`${edge.source}-${edge.target}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} /> : null;
          })}
          {visible.nodes.map((node) => {
            if (!node) return null;
            const position = visible.positioned.get(node.id); if (!position) return null;
            const active = node.id === selectedId; const degree = node.incoming + node.outgoing;
            return <g className={active ? "active" : ""} key={node.id} role="button" tabIndex={0} onClick={() => setSelectedId(node.id)} onKeyDown={(event) => { if (event.key === "Enter") setSelectedId(node.id); }}>
              <circle cx={position.x} cy={position.y} r={active ? 12 : Math.min(9, 4 + degree)} fill={nodeColor(node.status)} />
              {(active || degree >= 2) ? <text x={position.x} y={position.y - (active ? 18 : 12)}>{node.title.length > 18 ? `${node.title.slice(0, 18)}…` : node.title}</text> : null}
            </g>;
          })}
        </svg> : <div className="empty-state"><div><CircleDot /><h3>연결할 문서가 없습니다.</h3><p>문서 본문에 [[문서명]]을 입력하면 자동으로 선이 생깁니다.</p></div></div>}
      </div>

      <aside className="knowledge-graph-side panel">
        {selected ? <>
          <span className={`status-pill status-${selected.status}`}>{selected.status === "canonical" ? "회사 정본" : selected.status === "team" ? "팀 공유" : "개인 문서"}</span>
          <h2>{selected.title}</h2><p>{selected.folder || "분류 없음"}</p>
          <Link className="secondary-button" href={`/knowledge?document=${selected.id}`}>문서 열기 <ExternalLink size={13} /></Link>
          <h3><ArrowDownLeft size={14} /> 백링크 {incoming.length}</h3>
          <div className="graph-link-list">{incoming.map((node) => node ? <button key={node.id} onClick={() => setSelectedId(node.id)}>{node.title}</button> : null)}{!incoming.length ? <small>이 문서를 가리키는 문서가 없습니다.</small> : null}</div>
          <h3><ArrowUpRight size={14} /> 나가는 링크 {outgoing.length}</h3>
          <div className="graph-link-list">{outgoing.map((node) => node ? <button key={node.id} onClick={() => setSelectedId(node.id)}>{node.title}</button> : null)}{!outgoing.length ? <small>이 문서가 연결한 문서가 없습니다.</small> : null}</div>
        </> : <div className="quiet-state">지도에서 문서를 선택하세요.</div>}
        <h3><AlertTriangle size={14} /> 깨진 링크 {graph.broken.length}</h3>
        <div className="broken-link-list">{graph.broken.slice(0, 50).map((item, index) => <Link key={`${item.sourceId}-${item.targetTitle}-${index}`} href={`/knowledge?document=${item.sourceId}`}><strong>[[{item.targetTitle}]]</strong><small>{item.sourceTitle}</small></Link>)}{!graph.broken.length ? <small>깨진 링크가 없습니다.</small> : null}</div>
      </aside>
    </section>
  </>;
}
