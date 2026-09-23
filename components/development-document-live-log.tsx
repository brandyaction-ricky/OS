"use client";

import { FileText, GitCommitHorizontal, RefreshCw, Rocket } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { recordText, safeWebUrl } from "@/lib/development-handoff";
import type { OsRecord } from "@/lib/record-types";

const STATUS_LABELS: Record<string, string> = {
  backlog: "접수", active: "수정 중", review: "검수 요청", done: "해결", blocked: "보류",
  working: "작업 중", tested: "검증 완료", dev_deployed: "Preview 배포", completed: "완료",
  deploying: "배포 중", ready: "배포 성공", failed: "배포 실패", rolled_back: "되돌림",
};

interface LiveLogResponse {
  project: { id: string; title: string } | null;
  requests: OsRecord[];
  history: OsRecord[];
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export function DevelopmentDocumentLiveLog({ token, documentId, demo }: { token: string | null; documentId: string; demo: boolean }) {
  const [data, setData] = useState<LiveLogResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (quiet = false) => {
    if (demo || !token) { setData(null); return; }
    if (!quiet) setLoading(true);
    try {
      const result = await apiRequest<LiveLogResponse>(`/api/v1/development-project-log?documentId=${encodeURIComponent(documentId)}`, { token });
      setData(result); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "연결된 개발 기록을 불러오지 못했습니다."); }
    finally { if (!quiet) setLoading(false); }
  }, [demo, documentId, token]);

  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(true); };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("brandy-development-requests-changed", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("brandy-development-requests-changed", refresh); };
  }, [load]);

  const visibleRequests = useMemo(() => {
    const open = data?.requests.filter((item) => item.status !== "done") ?? [];
    const done = data?.requests.filter((item) => item.status === "done").slice(0, 5) ?? [];
    return [...open, ...done].slice(0, 30);
  }, [data]);
  if (!loading && !error && !data?.project) return null;

  return <section className="development-document-live-log" aria-label="개발 관리 자동 연동">
    <header><div><span><FileText size={15} /> 개발 관리 자동 연동</span><h2>{data?.project?.title || "연결된 개발 기록"}</h2><p>정본 본문은 보존하고, 요청·상태·개발·배포 기록을 개발 관리에서 실시간으로 불러옵니다.</p></div><button type="button" aria-label="개발 기록 새로고침" disabled={loading} onClick={() => void load()}><RefreshCw size={14} className={loading ? "spin" : ""} /></button></header>
    {error ? <div className="development-live-error" role="alert">{error}<button type="button" onClick={() => void load()}>다시 불러오기</button></div> : null}
    {loading && !data ? <p className="development-live-empty">연결된 개발 기록을 확인하는 중입니다.</p> : null}
    {data?.project ? <>
      <div className="development-live-summary"><span>열린 요청 <strong>{data.requests.filter((item) => item.status !== "done").length}</strong></span><span>개발·배포 기록 <strong>{data.history.length}</strong></span><Link href={`/knowledge/development?project=${encodeURIComponent(data.project.id)}`}>개발 관리에서 보기</Link></div>
      <div className="development-live-columns"><div><h3>요청 현황</h3>{visibleRequests.length ? visibleRequests.map((item) => <Link className="development-live-row" href={`/knowledge/development?request=${encodeURIComponent(item.id)}`} key={item.id}><span><small>{item.id.slice(0, 8)} · {formatDate(item.updated_at)}</small><strong>{item.title}</strong></span><em className={`dev-status dev-status-${item.status}`}>{STATUS_LABELS[item.status] || item.status}</em></Link>) : <p className="development-live-empty">연결된 요청이 없습니다.</p>}</div><div><h3>최근 개발·배포</h3>{data.history.length ? data.history.slice(0, 15).map((item) => { const result = safeWebUrl(item.source_url); return <article className="development-live-row" key={item.id}><span><small>{item.record_type === "deployment" ? <Rocket size={11} /> : <GitCommitHorizontal size={11} />}{item.record_type === "deployment" ? "배포" : "개발"} · {formatDate(item.updated_at)}{recordText(item, "requestId") ? ` · ${recordText(item, "requestId").slice(0, 8)}` : ""}</small><strong>{item.title}</strong></span>{result ? <a href={result} target="_blank" rel="noreferrer">결과</a> : <em>{STATUS_LABELS[item.status] || item.status}</em>}</article>; }) : <p className="development-live-empty">연결된 개발·배포 기록이 없습니다.</p>}</div></div>
    </> : null}
  </section>;
}
