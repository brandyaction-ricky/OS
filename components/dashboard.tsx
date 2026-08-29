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
import { listDocuments } from "@/lib/api-client";
import type { KnowledgeDocument } from "@/lib/types";
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
  const [error, setError] = useState("");

  useEffect(() => {
    if (demo) return;
    listDocuments(accessToken, "limit=20")
      .then(({ documents: next }) => setDocuments(next))
      .catch((reason) => setError(reason.message));
  }, [accessToken, demo]);

  const stats = useMemo(() => ({
    total: documents.length,
    canonical: documents.filter((document) => document.status === "canonical").length,
    review: documents.filter((document) => document.status === "review").length,
    drafts: documents.filter((document) => document.status === "draft" || document.status === "team").length,
  }), [documents]);

  const recent = [...documents].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
  const pending = documents.filter((document) => document.status === "review").slice(0, 4);

  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <span className="eyebrow">COMMAND CENTER</span>
          <h1>{profile?.displayName ?? "리키"}님, 오늘의 운영 현황입니다.</h1>
          <p>지식의 상태와 지금 결정해야 할 일을 한눈에 확인하세요.</p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/knowledge/search"><Search size={16} /> 지식 찾기</Link>
          <Link className="primary-button" href="/knowledge?new=1"><FileText size={16} /> 새 문서</Link>
        </div>
      </header>

      {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}

      <section className="metric-grid">
        <div className="metric-card">
          <div className="metric-top"><span>전체 지식 문서</span><span className="metric-icon"><FileText size={16} /></span></div>
          <div className="metric-value">{stats.total}</div>
          <div className="metric-caption">회사와 구성원의 누적 지식</div>
        </div>
        <div className="metric-card">
          <div className="metric-top"><span>회사 정본</span><span className="metric-icon"><BookCheck size={16} /></span></div>
          <div className="metric-value">{stats.canonical}</div>
          <div className="metric-caption good">누구나 근거로 활용 가능</div>
        </div>
        <div className="metric-card">
          <div className="metric-top"><span>검토 대기</span><span className="metric-icon"><FileClock size={16} /></span></div>
          <div className="metric-value">{stats.review}</div>
          <div className={`metric-caption ${stats.review ? "warn" : "good"}`}>{stats.review ? "확인과 결정이 필요합니다" : "밀린 검토가 없습니다"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-top"><span>작성 중</span><span className="metric-icon"><Sparkles size={16} /></span></div>
          <div className="metric-value">{stats.drafts}</div>
          <div className="metric-caption">개인·팀 작업 공간</div>
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
          <div className="panel-header"><div><h2>지금 결정할 일</h2><p>검토가 필요한 지식입니다.</p></div><span className="count-badge">{pending.length}</span></div>
          <div className="decision-list">
            {pending.length ? pending.map((document) => (
              <Link href={`/knowledge/review?document=${document.id}`} key={document.id}>
                <span className="decision-icon"><CircleAlert size={16} /></span>
                <span><strong>{document.title}</strong><small>{document.team || "전체"} · 검토 요청</small></span>
                <ArrowRight size={14} />
              </Link>
            )) : (
              <div className="quiet-state"><BookCheck size={24} /><strong>검토 대기 없음</strong><span>새 요청이 들어오면 여기에 표시됩니다.</span></div>
            )}
          </div>
        </aside>
      </section>

      <section className="content-grid lower-grid">
        <article className="panel readiness-panel">
          <div className="panel-header"><div><h2>OS 구축 현황</h2><p>이번 재구축의 작동 범위입니다.</p></div><span className="build-progress">1단계</span></div>
          <div className="readiness-steps">
            <div className="done"><span>01</span><div><strong>지식 기반</strong><small>문서·버전·검토·검색 API</small></div></div>
            <div className="active"><span>02</span><div><strong>통로 연결</strong><small>OS 화면·텔레그램·직원 AI</small></div></div>
            <div><span>03</span><div><strong>실행 기능</strong><small>콘텐츠·업무·회의 자동화</small></div></div>
            <div><span>04</span><div><strong>성과 연결</strong><small>매출·퍼널·CRM 의사결정</small></div></div>
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
