"use client";

import {
  ArrowRight,
  BookCheck,
  CircleAlert,
  FileClock,
  FileText,
  Search,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DEMO_DOCUMENTS } from "@/lib/demo-data";
import { listAllRecords, listDocuments } from "@/lib/api-client";
import type { KnowledgeDocument } from "@/lib/types";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

function formatRelative(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const hours = Math.max(1, Math.floor(diff / 3_600_000));
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export function Dashboard() {
  const { demo, accessToken, profile } = useSession();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>(demo ? DEMO_DOCUMENTS : []);
  const [operations, setOperations] = useState<OsRecord[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (demo) return;
    Promise.all([listDocuments(accessToken, "limit=20"), listAllRecords(accessToken)])
      .then(([knowledge, operating]) => { setDocuments(knowledge.documents); setOperations(operating.records); })
      .catch((reason) => setError(reason.message));
  }, [accessToken, demo]);

  const recent = [...documents].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
  const operatingStats = useMemo(() => {
    const tasks = operations.filter((record) => record.record_type === "task" && !["done", "cancelled"].includes(record.status));
    const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const monthKey = new Date().toISOString().slice(0, 7);
    const published = operations.filter((record) => record.record_type === "content_publish" && record.status === "published" && new Date(record.updated_at) >= weekStart).length;
    const revenue = operations.filter((record) => record.record_type === "revenue" && String(record.metadata.date ?? record.created_at).startsWith(monthKey)).reduce((sum, record) => sum + Number(record.metadata.net ?? record.amount ?? 0), 0);
    const videos = operations.filter((record) => ["content_topic", "content_script", "content_package", "content_short", "content_publish"].includes(record.record_type) && !["done", "published", "cancelled"].includes(record.status)).length;
    const alerts = operations.filter((record) => ["blocked", "warning"].includes(record.status) || record.priority === "urgent").length;
    const nextTasks = [...tasks].sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999")).slice(0, 5);
    return {
      tasks: tasks.length, published, revenue, videos, alerts, nextTasks,
      decisions: operations.filter((record) => record.record_type === "decision" && ["open", "review"].includes(record.status)).length,
      aiReview: operations.filter((record) => record.record_type === "ai_job" && record.status === "review").length,
      activeProjects: operations.filter((record) => record.record_type === "project" && ["planned", "active", "blocked"].includes(record.status)).length,
    };
  }, [operations]);

  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <span className="eyebrow">COMMAND CENTER</span>
          <h1>{profile?.displayName ?? "리키"}님, 오늘의 운영 현황입니다.</h1>
          <p>이번 주 발행, 통합 순매출, 진행 영상, 경고와 다음 업무를 5초 안에 확인하세요.</p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/knowledge/search"><Search size={16} /> 지식 찾기</Link>
          <Link className="primary-button" href="/organization/tasks"><FileText size={16} /> 업무 관리</Link>
        </div>
      </header>

      {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}

      <section className="metric-grid">
        <div className="metric-card">
          <div className="metric-top"><span>이번 주 발행</span><span className="metric-icon"><FileText size={16} /></span></div>
          <div className="metric-value">{operatingStats.published}</div>
          <div className="metric-caption">발행 완료 콘텐츠</div>
        </div>
        <div className="metric-card">
          <div className="metric-top"><span>통합 순매출</span><span className="metric-icon"><TrendingUp size={16} /></span></div>
          <div className="metric-value growth-money">{(operatingStats.revenue / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만원</div>
          <div className="metric-caption">이번 달 확정 기준</div>
        </div>
        <div className="metric-card">
          <div className="metric-top"><span>진행 영상</span><span className="metric-icon"><FileClock size={16} /></span></div>
          <div className="metric-value">{operatingStats.videos}</div>
          <div className="metric-caption">기획부터 업로드 전까지</div>
        </div>
        <div className="metric-card">
          <div className="metric-top"><span>운영 경고</span><span className="metric-icon"><Sparkles size={16} /></span></div>
          <div className="metric-value">{operatingStats.alerts}</div>
          <div className={`metric-caption ${operatingStats.alerts ? "warn" : "good"}`}>{operatingStats.alerts ? "막힘·긴급 확인" : "운영 경고 없음"}</div>
        </div>
      </section>

      <section className="content-grid dashboard-grid">
        <article className="panel">
          <div className="panel-header">
            <div><h2>최근 업데이트</h2><p>회사 지식에 새로 쌓인 변화입니다.</p></div>
            <Link className="panel-link" href="/knowledge">전체 보기 <ArrowRight size={13} /></Link>
          </div>
          {recent.length ? (
            <div className="activity-list">
              {recent.map((document) => (
                <Link href={`/knowledge?document=${document.id}`} key={document.id}>
                  <span className={`document-symbol status-${document.status}`}><FileText size={16} /></span>
                  <span className="activity-main"><strong>{document.title}</strong><small>{document.folder || "분류 없음"} · {document.team || "전체"}</small></span>
                  <span className={`status-pill status-${document.status}`}>{statusLabel(document.status)}</span>
                  <time>{formatRelative(document.updated_at)}</time>
                </Link>
              ))}
            </div>
          ) : <div className="empty-state"><div><span><FileText /></span><h3>첫 지식을 만들어 보세요</h3><p>문서를 저장하면 업데이트 현황이 이곳에 쌓입니다.</p><Link className="primary-button" href="/knowledge?new=1">새 문서 만들기</Link></div></div>}
        </article>

        <aside className="panel decision-panel">
          <div className="panel-header"><div><h2>다음 업무</h2><p>기한이 가까운 완료 전 업무입니다.</p></div><span className="count-badge">{operatingStats.nextTasks.length}</span></div>
          <div className="decision-list">
            {operatingStats.nextTasks.length ? operatingStats.nextTasks.map((task) => (
              <Link href="/organization/tasks" key={task.id}>
                <span className="decision-icon"><CircleAlert size={16} /></span>
                <span><strong>{task.title}</strong><small>{task.team || "전체"} · {task.due_date || "기한 미정"}</small></span>
                <ArrowRight size={14} />
              </Link>
            )) : (
              <div className="quiet-state"><BookCheck size={24} /><strong>완료 전 업무 없음</strong><span>새 업무가 생기면 기한순으로 표시됩니다.</span></div>
            )}
          </div>
        </aside>
      </section>

      <section className="content-grid lower-grid">
        <article className="panel readiness-panel">
          <div className="panel-header"><div><h2>OS 구축 현황</h2><p>현재 작동하는 운영 범위입니다.</p></div><span className="build-progress">운영 기반</span></div>
          <div className="readiness-steps">
            <div className="done"><span>01</span><div><strong>지식 기반</strong><small>문서·버전·검토·검색 API</small></div></div>
            <div className="done"><span>02</span><div><strong>실행 관리</strong><small>업무·목표·회의·AI 작업</small></div></div>
            <div className="done"><span>03</span><div><strong>콘텐츠·성과</strong><small>자동화·캘린더·매출·퍼널·CRM</small></div></div>
            <div className="active"><span>04</span><div><strong>외부 자동화</strong><small>API 키·채널 승인 후 연결</small></div></div>
          </div>
        </article>
        <article className="panel team-panel">
          <div className="panel-header"><div><h2>지식 활용 원칙</h2><p>한 두뇌, 여러 통로</p></div><Users size={17} /></div>
          <div className="principle-copy">
            <TrendingUp size={24} />
            <p>직원과 AI가 같은 회사 정본을 검색하고, 새 결정은 다시 검토 가능한 지식으로 남깁니다.</p>
          </div>
        </article>
      </section>
    </>
  );
}

export function statusLabel(status: KnowledgeDocument["status"]) {
  return ({ draft: "개인 초안", team: "팀 공유", review: "검토 요청", reviewed: "검토 완료", canonical: "회사 정본", archived: "보관" })[status];
}
