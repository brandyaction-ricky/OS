"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2, RefreshCw } from "lucide-react";
import type { WorkItem, WorkTab } from "@/lib/personal-work";
import { TodayContentOperations } from "./today-content-operations";
import { PageTitle } from "./page-title";
import { useSession } from "./session-provider";
import { WorkspaceSkeleton } from "./workspace-load-state";
const TABS: Array<[WorkTab, string]> = [["received", "받은 일"], ["review", "검토·승인"], ["requested", "요청한 일"]];
interface WorkResponse { tabs: Record<WorkTab, WorkItem[]>; truncated: boolean; checkedAt: string }
export function PersonalWorkHome() {
  const { demo, accessToken, loading: sessionLoading } = useSession();
  const params = useSearchParams();
  const tab = TABS.some(([id]) => id === params.get("tab")) ? params.get("tab") as WorkTab : "received";
  const [data, setData] = useState<WorkResponse | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
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
  const change = (key: string, value: string) => { const next = new URLSearchParams(params.toString()); next.set(key, value); window.history.replaceState(null, "", `/home?${next}`); };
  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle /><p>나에게 배정된 일, 확인할 문서, 요청의 진행 상황을 확인합니다.</p></div></header>
    <TodayContentOperations />
      <nav className="workspace-tabs" aria-label="내 할 일 보기">{TABS.map(([id,label]) => <button key={id} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => change("tab",id)}>{label} <span>{loading || !data ? "…" : data.tabs[id].length}</span></button>)}</nav>
      {error ? <div className="inline-alert danger" role="alert">{error}<button className="secondary-button" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /> 다시 불러오기</button></div> : loading || !data ? <WorkspaceSkeleton /> : <section className="panel personal-work-list" aria-label={TABS.find(([id])=>id===tab)?.[1]}>
        <header><span>{tab === "review" ? "현재 권한으로 검토할 수 있는 항목" : tab === "requested" ? "내가 등록한 요청·업무" : "기한이 빠른 순서"}</span><small>{demo ? "데모 · 실제 업무 연결 전" : "접속 중 1분마다 갱신"}</small></header>
        {data.truncated && <p role="status">최근 1,000개 범위입니다. 전체 항목은 각 업무 화면에서 확인하세요.</p>}
        {data.tabs[tab].map(item => <Link key={`${item.kind}-${item.id}`} href={item.href}><div><strong>{item.title}</strong><p>{item.nextAction}</p></div><span>{item.status}</span><time>{item.dueDate || "기한 미정"}</time><ArrowRight size={15} /></Link>)}
        {!data.tabs[tab].length && <div className="empty-state"><div><CheckCircle2 /><h2>{tab === "received" ? "배정된 일이 없습니다" : tab === "review" ? "확인할 항목이 없습니다" : "남긴 요청이 없습니다"}</h2><p>업무가 생기면 이곳에서 바로 확인할 수 있습니다.</p></div></div>}
      </section>}
      {data && !error && [...new Map([...data.tabs.received, ...data.tabs.requested].filter(item => item.status === "막힘").map(item => [item.id, item])).values()].length > 0 ? <section className="panel personal-work-blocked"><h2>막힌 일</h2>{[...new Map([...data.tabs.received, ...data.tabs.requested].filter(item => item.status === "막힘").map(item => [item.id, item])).values()].map(item => <Link key={item.id} href={item.href}><strong>{item.title}</strong><span>{item.nextAction}</span></Link>)}</section> : null}
      <div className="personal-work-links"><Link href="/organization/tasks">업무 열기 <ArrowRight size={14} /></Link><Link href="/knowledge/search">지식 찾기 <ArrowRight size={14} /></Link></div>
  </>;
}
