"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAdPerformance, getConnectionChecks, getHealth, listMembers, listRecords } from "@/lib/api-client";
import { findPage } from "@/lib/navigation";
import { useSession } from "./session-provider";
import { usePerformanceFilters } from "./performance-filter-context";
import { WorkspaceLoadState } from "./workspace-load-state";
interface DataConnection { name: string; status: string; collected: string | null; owner: string; href: string }
export function DataConnectionsWorkspace() {
  const { accessToken, demo, profile } = useSession();
  const { month, brand } = usePerformanceFilters();
  const [rows, setRows] = useState<DataConnection[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const [loadedKey, setLoadedKey] = useState("");
  const load = useCallback(async () => {
    if (demo) return;
    const request = ++generation.current;
    setLoading(true); setError("");
    try {
      const [health, ads, videos, ownership, members] = await Promise.all([
        getHealth(), getAdPerformance(accessToken, { period: month, brand }), listRecords(accessToken, "content_metric", "limit=200"),
        profile?.role === "admin" ? getConnectionChecks(accessToken) : Promise.resolve(null),
        profile?.role === "admin" ? listMembers(accessToken) : Promise.resolve(null),
      ]);
      if (request !== generation.current) return;
      setLoadedKey(`${month}:${brand}`);
      const owner = (id: string) => { const check = ownership?.checks.find(check => check.id === id); return check?.primaryOwner ? members?.members.find(member => member.id === check.primaryOwner)?.display_name || "담당 확인 필요" : profile?.role === "admin" ? "미지정" : "관리자에게 확인"; };
      const latestVideo = videos.records.reduce<string | null>((latest, row) => !latest || row.updated_at > latest ? row.updated_at : latest, null);
      setRows([
        { name: "주문·매출", status: "주문 연결 대기 · 수기·CSV 입력 별도", collected: null, owner: owner("orders"), href: "/performance/revenue" },
        { name: "Meta·Google 광고", status: ads.rows.length ? `${month} · API·CSV 수집 데이터 있음` : ads.connections.meta.configured || ads.connections.google.configured ? "설정됨(미확인) · 선택 월 미수집" : "연결 대기 · 선택 월 미수집", collected: ads.lastCollectedAt, owner: owner("advertising"), href: "/performance/ads" },
        { name: "영상 성과", status: latestVideo ? "저장된 지표 있음 · 자동 수집 여부 별도 확인" : health.youtube === "ready" ? "설정됨(미확인) · 성과 미수집" : "연결 대기", collected: latestVideo, owner: owner("youtube"), href: "/content/performance" },
      ]);
    } catch (reason) { if (request === generation.current) setError(reason instanceof Error ? reason.message : "데이터 연결 상태를 불러오지 못했습니다."); }
    finally { if (request === generation.current) setLoading(false); }
  }, [accessToken, demo, profile?.role, month, brand]);
  useEffect(() => { const requests = generation; void load(); return () => { requests.current++; }; }, [load]);
  const displayed = demo ? [["주문·매출", "/performance/revenue"], ["Meta·Google 광고", "/performance/ads"], ["영상 성과", "/content/performance"]].map(([name, href]) => ({ name, status: name === "주문·매출" ? "주문 연결 대기" : "데모 모드 · 확인 전", collected: null, owner: "미지정", href })) : rows;
  return <><header className="page-header"><div className="page-title-group"><h1>{findPage("/performance/connections").label}</h1><p>수집되지 않은 값은 —, 수집된 0은 0으로 표시합니다. 광고는 {month}·선택 브랜드, 영상은 조회 가능한 최근 저장 지표 기준입니다.</p></div><button className="secondary-button" onClick={load} disabled={demo || loading}>새로고침</button></header>
    <WorkspaceLoadState loading={loading || (!demo && !error && loadedKey !== `${month}:${brand}`)} error={error} retry={load}><section className="connection-evidence-grid">{displayed.map(row => <article className="panel connection-evidence" key={row.name}><h2>{row.name}</h2><p>{row.status}</p><dl><div><dt>마지막 수집·입력</dt><dd>{row.collected ? new Date(row.collected).toLocaleString("ko-KR") : "— 수집 이력 없음"}</dd></div><div><dt>정 담당</dt><dd>{row.owner}</dd></div></dl><div className="connection-evidence-actions"><Link className="secondary-button" href={row.href}>데이터 확인</Link><Link className="ghost-button" href="/settings/connections">담당·작동 상태</Link></div></article>)}</section></WorkspaceLoadState>
  </>;
}
