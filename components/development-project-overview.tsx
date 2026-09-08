"use client";

import { useEffect, useState } from "react";
import type { OsRecord } from "@/lib/record-types";

const STATES = [["backlog", "접수"], ["active", "진행 중"], ["review", "검수 대기"], ["blocked", "보류"]] as const;
type Summary = { counts: Record<string, number>; error?: boolean };

export function DevelopmentProjectOverview({ projects, token, demo, requests, onChoose }: {
  projects: OsRecord[]; token: string | null; demo: boolean; requests: OsRecord[];
  onChoose: (id: string, status?: string) => void;
}) {
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    setSummaries({});
    const refresh = async () => {
      if (pending || (!demo && !token)) return;
      pending = true;
      try {
        await Promise.all(projects.map(async project => {
          let summary: Summary;
          try {
            if (demo) summary = { counts: Object.fromEntries(STATES.map(([status]) => [status, requests.filter(item => item.parent_id === project.id && item.status === status).length])) };
            else {
              const response = await fetch(`/api/v1/development-requests?${new URLSearchParams({ projectId: project.id, summary: "1", limit: "1" })}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
              if (!response.ok) throw new Error("Summary unavailable");
              summary = await response.json();
              if (STATES.some(([key]) => !Number.isFinite(summary.counts?.[key]))) throw new Error("Invalid summary");
            }
          } catch { summary = { counts: {}, error: true }; }
          if (!controller.signal.aborted) setSummaries(previous => ({ ...previous, [project.id]: summary }));
        }));
      } finally { pending = false; }
    };
    void refresh();
    const onRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(onRefresh, 60_000);
    window.addEventListener("focus", onRefresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", onRefresh); };
  }, [projects, token, demo, requests, revision]);
  return <section className="dev-overview" aria-label="프로젝트 전체 현황">
    <header><div><h2>오늘 확인할 개발 작업</h2><p>프로젝트를 선택하면 해당 요청과 개발·배포 기록으로 이동합니다.</p></div><button className="dev-button" onClick={() => setRevision(value => value + 1)}>새로고침</button></header>
    <div className="dev-overview-grid">{projects.map(project => {
      const summary = summaries[project.id];
      return <article key={project.id}><button className="dev-project-title" onClick={() => onChoose(project.id)}>{project.title}</button><p>{project.description || "프로젝트 목적을 확인해 주세요."}</p>
        {summary?.error ? <p role="alert">현황을 불러오지 못했습니다. 새로고침해 주세요.</p> : <div className="dev-project-counts">{STATES.map(([key, label]) => <button key={key} onClick={() => onChoose(project.id, key)}><span>{label}</span><strong>{summary ? summary.counts[key] : "—"}</strong></button>)}</div>}
        <small>검수 대기·보류 항목부터 확인하세요.</small>
      </article>;
    })}</div>
    {!projects.length && <p role="status">프로젝트 목록을 확인하고 있습니다. 등록된 프로젝트가 없다면 상단에서 추가해 주세요.</p>}
  </section>;
}
