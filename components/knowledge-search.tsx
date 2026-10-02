"use client";

import {progressiveSearch} from "@/lib/progressive-search";
import type {IndexCoverage} from "@/lib/indexing-diagnostics";
import { PageTitle } from "./page-title";

import {
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  FileSearch,
  Filter,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { SEARCH_DEGRADATION_MESSAGES, type SearchDegradation } from "@/lib/search-diagnostics";
import { createLatestSearch } from "@/lib/knowledge-search-state";
import { apiRequest, searchKnowledge } from "@/lib/api-client";
import { searchDemoDocuments } from "@/lib/demo-data";
import type { DocumentStatus, SearchResult } from "@/lib/types";
import { statusLabel } from "./dashboard";
import { useSession } from "./session-provider";

type SearchMode = "hybrid" | "keyword" | "semantic";

function SearchContent() {
  const searchParams = useSearchParams();
  const { demo, accessToken } = useSession();
  const initialQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [lastQuery, setLastQuery] = useState("");
  const [applied, setApplied] = useState<{ query: string; mode: SearchMode; statuses: DocumentStatus[] } | null>(null);
  const generation = useRef(createLatestSearch());
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [statuses, setStatuses] = useState<DocumentStatus[]>(["canonical", "reviewed", "team"]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchingMore,setSearchingMore]=useState(false);
  const [partial,setPartial]=useState(false);
  const [coverage,setCoverage]=useState<IndexCoverage|null>(null);
  const [coverageError,setCoverageError]=useState("");
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>{let active=true;const abort=new AbortController();setCoverage(null);setCoverageError("");if(!demo&&accessToken)apiRequest<{coverage:IndexCoverage}>("/api/v1/search/progress",{token:accessToken,signal:abort.signal}).then(result=>{if(active)setCoverage(result.coverage);}).catch(()=>{if(active)setCoverageError("검색 준비 현황을 확인하지 못했습니다. 검색은 계속 사용할 수 있습니다.");});return()=>{active=false;abort.abort();};},[demo,accessToken]);
  const [degraded, setDegraded] = useState(false);
  const [reasons, setReasons] = useState<SearchDegradation[]>([]);
  const [tookMs, setTookMs] = useState(0);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const execute = async (nextQuery = query) => {
    const trimmed = nextQuery.trim();
    if (!trimmed) return;
    controller.current?.abort();const abort=new AbortController();controller.current=abort;
    const request = generation.current.start();
    const criteria = { query: trimmed, mode, statuses: [...statuses] };
    setLoading(true);setSearchingMore(false);setPartial(false);setResults([]);setError(""); setReasons([]); setDegraded(false);
    const started = performance.now();
    try {
      if (!criteria.statuses.length) {
        setResults([]); setDegraded(false); setTookMs(0);
      } else if (demo) {
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        if (!generation.current.current(request)) return;
        setResults(searchDemoDocuments(trimmed).filter((result) => statuses.includes(result.status)));
        setDegraded(false); setTookMs(Math.round(performance.now() - started));
      } else {
        const input={query:trimmed,mode:criteria.mode,topK:20,filters:{statuses:criteria.statuses}};
        const update=(response:Awaited<ReturnType<typeof searchKnowledge>>)=>{setResults(response.results);setDegraded(response.degraded);setReasons(response.degradationReasons??[]);setTookMs(response.tookMs);setApplied(criteria);setLastQuery(trimmed);};
        if(criteria.mode==="keyword"){const response=await searchKnowledge(accessToken,input,abort.signal);if(!generation.current.current(request))return;update(response);}
        else {
          const outcome=await progressiveSearch(()=>searchKnowledge(accessToken,{...input,mode:"keyword",quick:true},abort.signal),()=>searchKnowledge(accessToken,input,abort.signal),response=>{if(generation.current.current(request)){update(response);setLoading(false);setSearchingMore(true);setPartial(true);}});
          if(!generation.current.current(request))return;
          update(outcome.result);setPartial(outcome.partial);setSearchingMore(false);
        }
      }
      setApplied(criteria); setLastQuery(trimmed);
    } catch (reason) {
      if (!generation.current.current(request)) return;
      setApplied(criteria); setLastQuery(trimmed);
      setError(reason instanceof Error ? reason.message : "검색하지 못했습니다.");
      setResults([]);
    } finally { if (generation.current.current(request)) {setLoading(false);setSearchingMore(false);} }
  };

  useEffect(() => {
    const gate = generation.current;
    if (initialQuery && (demo || accessToken)) { setQuery(initialQuery); void execute(initialQuery); }
    return () => { gate.invalidate(); controller.current?.abort(); };
  }, [initialQuery, demo, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps
  const conditionsChanged = Boolean(applied && (query.trim() !== applied.query || mode !== applied.mode || [...statuses].sort().join() !== [...applied.statuses].sort().join()));

  const grouped = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    results.forEach((result) => map.set(result.documentId, [...(map.get(result.documentId) ?? []), result]));
    return [...map.values()];
  }, [results]);

  const submit = (event: FormEvent) => { event.preventDefault(); execute(); };
  const toggleStatus = (status: DocumentStatus) => {
    setStatuses((current) => current.includes(status) ? current.filter((item) => item !== status) : [...current, status]);
  };

  return (
    <>
      <header className="search-hero">
        <span className="search-orb"><Sparkles size={20} /></span>
        <div><PageTitle /><p>검토된 정본과 팀 지식에서 근거 문단까지 함께 찾습니다.</p></div>
      </header>

      <form className="knowledge-search-form" onSubmit={submit}>
        <Search size={20} />
        <input aria-label="지식 검색어" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: 썸네일을 검토할 때 가장 먼저 보는 기준은?" autoFocus />
        <button className="primary-button" disabled={loading || !query.trim()}>{loading ? "찾는 중…" : "지식 검색"}</button>
      </form>

      <div className="search-controls">
        <div className="mode-switch" aria-label="검색 방식">
          {(["hybrid", "keyword", "semantic"] as const).map((item) => <button key={item} className={mode === item ? "active" : ""} aria-pressed={mode === item} onClick={() => setMode(item)}>{item === "hybrid" ? "균형 검색" : item === "keyword" ? "정확한 단어" : "의미 검색"}</button>)}
        </div>
        <div className="status-filters"><Filter size={13} />{(["canonical", "reviewed", "team", "draft"] as DocumentStatus[]).map((status) => <button key={status} className={statuses.includes(status) ? "active" : ""} aria-pressed={statuses.includes(status)} onClick={() => toggleStatus(status)}><span />{statusLabel(status)}</button>)}</div>
      </div>

      <div className="index-progress" role="status">{demo?"데모 · 색인 연결 현황은 로그인한 환경에서 확인할 수 있습니다.":coverage?<>접근 가능한 현재 문서의 색인 완료 {coverage.done.toLocaleString("ko-KR")} / 전체 {coverage.total.toLocaleString("ko-KR")} · 대기 {coverage.pending} · 처리 중 {coverage.running} · 실패 {coverage.failed} · 작업 미등록 {coverage.untracked}<br/>작업 상태 기준 · 나머지는 단어 검색을 이용할 수 있습니다. {coverage.truncated?"조회 한도에 도달한 부분 집계입니다.":""} 확인 {new Date(coverage.capturedAt).toLocaleTimeString("ko-KR")}</>:coverageError||"검색 준비 현황 확인 중…"}</div>
      {searchingMore?<p className="inline-alert" role="status">단어 검색 결과부터 표시했습니다. 의미가 비슷한 자료를 더 찾는 중…</p>:partial?<p className="inline-alert" role="status">추가 검색을 완료하지 못해 먼저 찾은 단어 검색 결과를 유지합니다.</p>:null}
      {!statuses.length ? <p className="inline-alert">검색할 문서 상태를 하나 이상 선택해 주세요.</p> : null}
      {conditionsChanged ? <p className="inline-alert" role="status">조건 변경됨 · 아래는 이전 검색 결과입니다. 다시 검색하면 새 조건을 적용합니다.</p> : null}
      {degraded ? <div className="inline-alert"><CircleAlert size={15} /> {reasons.length ? reasons.map(reason => SEARCH_DEGRADATION_MESSAGES[reason]).join(" ") : "일부 검색 기능을 사용할 수 없어 단어 검색 결과를 표시합니다."} <button type="button" className="ghost-button" disabled={loading} onClick={() => execute()}>다시 검색</button></div> : null}
      {error ? <div className="inline-alert danger"><CircleAlert size={15} /> {error}<button className="ghost-button" disabled={loading} onClick={() => execute()}>다시 검색</button></div> : null}

      {!lastQuery && !loading ? (
        <section className="search-start">
          <div className="search-guide panel"><span><FileSearch size={22} /></span><h2>질문하듯 검색해도 됩니다</h2><p>정확한 문서명을 몰라도 업무 맥락과 원하는 답을 적어주세요.</p><div className="example-queries">{["검토 요청 문서를 정본으로 만드는 절차", "유튜브 제목과 썸네일 패키징 기준", "텔레그램에 저장한 답은 어디에 쌓이나요?"].map((item) => <button key={item} onClick={() => { setQuery(item); execute(item); }}>{item}<ChevronRight size={13} /></button>)}</div></div>
          <div className="search-scope panel"><h3>검색 범위</h3><div><BookOpen size={17} /><span><strong>회사 정본</strong><small>누구나 활용 가능한 검토 완료 지식</small></span><Check size={15} /></div><div><Clock3 size={17} /><span><strong>팀 공유</strong><small>현재 팀이 함께 다듬고 있는 지식</small></span><Check size={15} /></div></div>
        </section>
      ) : null}

      {lastQuery && !loading ? (
        <section className="search-results-layout">
          <div className="results-main">
            <div className="results-summary"><span><strong>{grouped.length}</strong>개 문서에서 {results.length}개 근거를 찾았습니다.</span><small>{tookMs}ms · {applied?.mode === "hybrid" ? "균형 검색" : applied?.mode === "keyword" ? "정확한 단어" : "의미 검색"}</small></div>
            <p className="applied-search-criteria">적용된 조건 · “{applied?.query}” · {applied?.statuses.length ? applied.statuses.map(statusLabel).join(" · ") : "선택한 상태 없음"}</p>
            {grouped.map((items) => {
              const first = items[0];
              return (
                <article className="search-result-card" key={first.documentId}>
                  <header><span className={`document-symbol status-${first.status}`}><BookOpen size={16} /></span><div><Link href={`/knowledge?document=${first.documentId}`}>{first.title}</Link><small>{first.folder || "분류 없음"} · {first.brand || "전체 브랜드"}</small></div><span className={`status-pill status-${first.status}`}>{statusLabel(first.status)}</span><strong>{Math.round(Math.max(...items.map((item) => item.score)) * 100)}%</strong></header>
                  <div className="result-passages">
                    {items.slice(0, 3).map((item, index) => (
                      <div key={`${item.chunkId}-${index}`}>
                        <div className="passage-heading"><span>{item.heading || "본문"}</span><button onClick={async () => { await navigator.clipboard.writeText(`${item.title} · ${item.text}`); setCopied(String(item.chunkId ?? index)); }}><Copy size={12} /> {copied === String(item.chunkId ?? index) ? "복사됨" : "인용 복사"}</button></div>
                        <p>{item.text}</p>
                        <small>출처 · 문서 {item.documentId.slice(0, 8)} · 버전 {item.citation.version ?? "현재"} · 문단 {item.citation.chunkId ?? index + 1}</small>
                      </div>
                    ))}
                  </div>
                  <footer><Link href={`/knowledge?document=${first.documentId}`}>원문 열기 <ChevronRight size={13} /></Link></footer>
                </article>
              );
            })}
            {!grouped.length ? <div className="panel empty-state"><div><span><Search /></span><h3>관련 지식을 찾지 못했습니다</h3><p>단어를 줄이거나 팀 공유 문서까지 검색 범위를 넓혀보세요.</p></div></div> : null}
          </div>
          <aside className="search-side panel"><h3>검색 품질 확인</h3><p>답을 만들 때는 아래 근거를 먼저 확인하세요.</p><ul><li><Check size={13} /> 문서 상태가 정본인지</li><li><Check size={13} /> 현재 업무와 같은 브랜드인지</li><li><Check size={13} /> 최근 버전인지</li></ul><Link href="/knowledge/review">검토함 열기 <ChevronRight size={13} /></Link></aside>
        </section>
      ) : null}
    </>
  );
}

export function KnowledgeSearch() { return <Suspense><SearchContent /></Suspense>; }
