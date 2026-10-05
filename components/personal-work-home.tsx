"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2, RefreshCw } from "lucide-react";
import { listDocuments, listRecords } from "@/lib/api-client";
import type { WorkItem, WorkTab } from "@/lib/personal-work";
import type { KnowledgeDocument } from "@/lib/types";
import type { OsRecord } from "@/lib/record-types";
import { TodayContentOperations } from "./today-content-operations";
import { useSession } from "./session-provider";
import { WorkspaceSkeleton } from "./workspace-load-state";
const TABS: Array<[WorkTab, string]> = [["received", "받은 일"], ["review", "검토·승인"], ["requested", "요청한 일"]];
interface WorkResponse { tabs: Record<WorkTab, WorkItem[]>; truncated: boolean; checkedAt: string }
export function PersonalWorkHome() {
  const { demo, accessToken, profile, loading: sessionLoading } = useSession();
  const params = useSearchParams();
  const tab = TABS.some(([id]) => id === params.get("tab")) ? params.get("tab") as WorkTab : "received";
  const [data, setData] = useState<WorkResponse | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [recentDocuments, setRecentDocuments] = useState<KnowledgeDocument[]>([]);
  const [recentDecisions, setRecentDecisions] = useState<OsRecord[]>([]);
  const load = useCallback(async (signal: AbortSignal) => {
    if (sessionLoading) return;
    if (demo) { setData({ tabs: {received:[],review:[],requested:[]}, truncated:false, checkedAt:new Date().toISOString() }); setLoading(false); return; }
    if (!accessToken) return;
    try {
      setError("");
      const response = await fetch("/api/v1/my-work", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal });
      if (!response.ok) throw new Error("내 할 일을 불러오지 못했습니다.");
      const result = await response.json();
      if (!signal.aborted) setData(result);
    } catch (reason) { if (!signal.aborted) setError(reason instanceof Error ? reason.message : "연결을 확인해 주세요."); }
    finally { if (!signal.aborted) setLoading(false); }
  }, [accessToken, demo, sessionLoading]);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setLoading(true);
    let pending = false;
    const refresh = () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true; void load(controller.signal).finally(() => { pending = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000); window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load, revision]);
  useEffect(() => {
    if (demo || !accessToken) return;
    let active = true;
    void Promise.allSettled([
      listDocuments(accessToken, "view=summary&scope=mine_company&limit=3"),
      listRecords(accessToken, "decision", "limit=20"),
    ]).then(([documents, decisions]) => {
      if (!active) return;
      setRecentDocuments(documents.status === "fulfilled" ? documents.value.documents.slice(0, 3) : []);
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      setRecentDecisions(decisions.status === "fulfilled" ? decisions.value.records.filter((item) => Date.parse(item.updated_at) >= weekAgo).slice(0, 3) : []);
    });
    return () => { active = false; };
  }, [accessToken, demo, revision]);
  const change = (key: string, value: string) => { const next = new URLSearchParams(params.toString()); next.set(key, value); window.history.replaceState(null, "", `/home?${next}`); };
  const pendingItems=data?[...new Map([...data.tabs.received,...data.tabs.review,...data.tabs.requested].map(item=>[`${item.kind}:${item.id}`,item])).values()]:[];
  const blocked=pendingItems.filter(item=>item.status==="막힘");
  const nextDue=[...new Map((data?[...data.tabs.received,...data.tabs.review]:[]).map(item=>[`${item.kind}:${item.id}`,item])).values()].filter(item=>item.dueDate).sort((a,b)=>a.dueDate!.localeCompare(b.dueDate!)).slice(0,5);
  const activeCount = data ? new Map([...data.tabs.received, ...data.tabs.review].map((item) => [`${item.kind}:${item.id}`, item])).size : 0;
  const displayName = profile?.displayName || "내";
  return <>
    <header className="page-header personal-home-header"><div className="page-title-group"><h1>{displayName}님, 확인할 일 {loading || !data ? "…" : `${activeCount}건`}</h1><p>{new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date())} · 내게 온 일과 팀 운영 상황을 모았습니다.</p></div></header>
    <div className="fullscreen-home-layout"><section className="fullscreen-home-main">
      <TodayContentOperations blockedCount={blocked.length} />
      {error ? <div className="inline-alert danger" role="alert">{error}<button className="secondary-button" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /> 다시 불러오기</button></div> : loading || !data ? <WorkspaceSkeleton /> : <section className="panel personal-work-list" aria-label={TABS.find(([id])=>id===tab)?.[1]}>
        <header><strong>{tab === "review" ? "검토·승인" : tab === "requested" ? "요청한 일" : "나에게 배정"} {data.tabs[tab].length}</strong><small>기한 빠른 순 · 위치 = 메뉴 이름</small></header>
        {data.truncated && <p role="status">최근 1,000개 범위입니다. 전체 항목은 각 업무 화면에서 확인하세요.</p>}
        {data.tabs[tab].map(item => <Link key={`${item.kind}-${item.id}`} href={item.href}><div><strong>{item.title}</strong><p>{item.nextAction}</p></div><span>{item.status}</span><time>{item.dueDate || "기한 미정"}</time><ArrowRight size={15} /></Link>)}
        {!data.tabs[tab].length && <div className="empty-state"><div><CheckCircle2 /><h2>{tab === "received" ? "배정된 일이 없습니다" : tab === "review" ? "확인할 항목이 없습니다" : "남긴 요청이 없습니다"}</h2><p>업무가 생기면 이곳에서 바로 확인할 수 있습니다.</p></div></div>}
      </section>}
      {data && !error && blocked.length > 0 ? <section className="panel personal-work-blocked"><h2>⚠ 막혀 있는 일 {blocked.length}</h2>{blocked.slice(0, 3).map(item => <Link key={`${item.kind}:${item.id}`} href={item.href}><strong>{item.title}</strong><span>{item.nextAction}</span></Link>)}</section> : null}
      <div className="personal-work-links"><Link href="/organization/tasks">업무 열기 <ArrowRight size={14} /></Link><Link href="/knowledge/search">지식 찾기 <ArrowRight size={14} /></Link></div>
    </section><aside className="fullscreen-home-side"><nav className="workspace-tabs" aria-label="내 할 일 보기">{TABS.map(([id,label]) => <button key={id} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => change("tab",id)}>{label} {loading || !data ? "…" : data.tabs[id].length}</button>)}</nav><section className="panel home-next-work"><h2>내 다음 차례</h2>{data?.tabs[tab][0] ? <Link href={data.tabs[tab][0].href}><strong>{data.tabs[tab][0].title}</strong><small>{data.tabs[tab][0].nextAction}</small><span>열어보기 →</span></Link> : <p>지금 확인할 항목이 없습니다.</p>}</section><section className="panel home-week-issues"><h2>이번 주의 이슈 <small>팀 · 회의 결정</small></h2>{recentDecisions.length ? recentDecisions.map((item) => <Link key={item.id} href={`/organization/meetings?tab=decisions&record=${encodeURIComponent(item.id)}`}>{item.title}</Link>) : <p>최근 일주일간 확인 가능한 결정이 없습니다.</p>}<Link className="home-more-link" href="/organization/meetings?tab=decisions">결정 보기 →</Link></section><section className="panel home-recent-documents"><h2>최근 문서</h2>{recentDocuments.length ? recentDocuments.map((item) => <Link key={item.id} href={`/knowledge?document=${encodeURIComponent(item.id)}`}>{item.title}<small>{new Date(item.updated_at).toLocaleDateString("ko-KR")}</small></Link>) : <p>표시할 문서가 없습니다.</p>}</section><section className="panel fullscreen-home-due"><header><h2>가까운 기한</h2><Link href="/organization/schedule">일정 보기 →</Link></header>{loading?<p role="status">기한 확인 중…</p>:error?<p>내 할 일을 다시 불러오면 기한을 확인할 수 있습니다.</p>:nextDue.length?nextDue.map(item=><Link key={`${item.kind}:${item.id}`} href={item.href}><time>{item.dueDate}</time><strong>{item.title}</strong><small>{item.status}</small></Link>):<p>기한이 등록된 내 업무가 없습니다.</p>}</section></aside></div>
  </>;
}
