"use client";

import {
  ArrowRight,
  CalendarDays,
  CircleAlert,
  FileText,
  Film,
  Search,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listAllRecords, listDocuments } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import type { KnowledgeDocument } from "@/lib/types";
import { useSession } from "./session-provider";

function money(value: number) {
  return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만원`;
}
function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("ko-KR", {
        month: "short",
        day: "numeric",
      }).format(new Date(value))
    : "기한 미정";
}
function metadataNumber(record: OsRecord, key: string) {
  const value = Number(record.metadata[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function Dashboard() {
  const { accessToken, demo, profile } = useSession();
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (demo) return;
    Promise.all([
      listAllRecords(accessToken, "limit=500"),
      listDocuments(accessToken, "view=summary&limit=20"),
    ])
      .then(([operating, knowledge]) => {
        setRecords(operating.records);
        setDocuments(knowledge.documents);
      })
      .catch((reason) => setError(reason.message));
  }, [accessToken, demo]);
  const view = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7);
    const revenue = records.filter(
      (item) =>
        item.record_type === "revenue" &&
        String(item.metadata.date ?? item.created_at).startsWith(month),
    );
    const brand = (names: string[]) => {
      const rows = revenue.filter((item) =>
        names.some((name) =>
          (item.brand || item.title).toLowerCase().includes(name.toLowerCase()),
        ),
      );
      return {
        current: rows.reduce(
          (sum, item) =>
            sum + metadataNumber(item, "net") + Number(item.amount || 0),
          0,
        ),
        goal: rows.reduce(
          (sum, item) =>
            sum + Number(item.metric_target || item.metadata.goal || 0),
          0,
        ),
      };
    };
    const myin = brand(["마이인", "myin"]),
      edu = brand(["에듀", "edu"]);
    const total = {
      current: myin.current + edu.current,
      goal: myin.goal + edu.goal,
    };
    const meetings = records
      .filter((item) => item.record_type === "meeting")
      .sort((a, b) =>
        (b.starts_at || b.created_at).localeCompare(
          a.starts_at || a.created_at,
        ),
      );
    const nextMeeting = [...meetings]
      .filter((item) => item.status === "planned" && item.starts_at)
      .sort((a, b) => (a.starts_at || "").localeCompare(b.starts_at || ""))[0];
    const meetingIssues = meetings
      .slice(0, 4)
      .flatMap((meeting) =>
        (Array.isArray(meeting.metadata.pending)
          ? meeting.metadata.pending
          : []
        ).map((title, index) => ({
          id: `${meeting.id}-${index}`,
          title: String(title),
          source: meeting.title,
          owner: "미지정",
          due: nextMeeting?.starts_at || null,
          href: "/organization/meetings",
        })),
      );
    const taskIssues = records
      .filter(
        (item) =>
          item.record_type === "task" &&
          !["done", "cancelled"].includes(item.status) &&
          (item.metadata.source === "meeting" || item.status === "blocked"),
      )
      .map((item) => ({
        id: item.id,
        title: item.title,
        source:
          String(item.metadata.source) === "meeting"
            ? "회의 후속"
            : "업무 막힘",
        owner: String(item.metadata.assigneeName || item.team || "미지정"),
        due: item.due_date,
        href: "/organization/tasks",
      }));
    const issues = [...taskIssues, ...meetingIssues].slice(0, 8);
    const videos = records
      .filter(
        (item) =>
          [
            "content_topic",
            "content_script",
            "content_package",
            "content_short",
            "content_publish",
          ].includes(item.record_type) &&
          !["done", "published", "cancelled"].includes(item.status),
      )
      .slice(0, 6);
    return { myin, edu, total, issues, videos, nextMeeting };
  }, [records]);
  const revenueCard = (
    title: string,
    value: { current: number; goal: number },
  ) => (
    <article className="revenue-card">
      <span>{title}</span>
      <strong>{money(value.current)}</strong>
      <div>
        <i
          style={{
            width: `${Math.min(100, value.goal ? (value.current / value.goal) * 100 : 0)}%`,
          }}
        />
      </div>
      <small>
        목표 {value.goal ? money(value.goal) : "미설정"} ·{" "}
        {value.goal ? Math.round((value.current / value.goal) * 100) : 0}%
      </small>
    </article>
  );
  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <span className="eyebrow">오늘 현황</span>
          <h1>
            {profile?.displayName || "리키"}님, 이번 주 핵심만 모았습니다.
          </h1>
          <p>
            매출 목표, 회의에서 남은 이슈, 영상 제작과 최근 지식을 한 흐름으로
            확인합니다.
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/knowledge/search">
            <Search size={15} />
            지식 찾기
          </Link>
          <Link className="primary-button" href="/organization/meetings">
            <CalendarDays size={15} />
            회의 준비
          </Link>
        </div>
      </header>
      {error ? (
        <div className="inline-alert danger">
          <CircleAlert size={16} />
          {error}
        </div>
      ) : null}
      <section className="revenue-band">
        <div>
          <TrendingUp />
          <span>
            <small>이번 달 통합 순매출</small>
            <strong>{money(view.total.current)}</strong>
          </span>
          <em>
            {view.total.goal
              ? Math.round((view.total.current / view.total.goal) * 100)
              : 0}
            %
          </em>
        </div>
        {revenueCard("마이인", view.myin)}
        {revenueCard("브랜디액션 에듀", view.edu)}
      </section>
      <section className="panel weekly-issues">
        <div className="panel-header">
          <div>
            <h2>이번 주 핵심 이슈</h2>
            <p>회의 미결과 막힌 업무를 다음 회의까지 닫습니다.</p>
          </div>
          {view.nextMeeting ? (
            <span className="count-badge">
              다음 회의 {date(view.nextMeeting.starts_at)}
            </span>
          ) : null}
        </div>
        <div className="issue-table">
          <header>
            <span>이슈</span>
            <span>출처</span>
            <span>담당</span>
            <span>기한</span>
          </header>
          {view.issues.map((issue) => (
            <Link href={issue.href} key={issue.id}>
              <strong>{issue.title}</strong>
              <span>{issue.source}</span>
              <span>{issue.owner}</span>
              <time>{date(issue.due)}</time>
            </Link>
          ))}
          {!view.issues.length ? (
            <div className="quiet-state">
              <CircleAlert />
              <strong>열린 주간 이슈가 없습니다.</strong>
              <span>회의에서 미결 항목을 저장하면 자동으로 표시됩니다.</span>
            </div>
          ) : null}
        </div>
      </section>
      <section className="content-grid dashboard-third">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>이번 주 영상</h2>
              <p>기획부터 발행 전까지의 제작 흐름</p>
            </div>
            <Link className="panel-link" href="/content/automation">
              전체 보기 <ArrowRight size={13} />
            </Link>
          </div>
          <div className="weekly-video-list">
            {view.videos.map((item) => (
              <Link href="/content/automation" key={item.id}>
                <Film size={16} />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.brand || "공통"} · {item.status}
                  </small>
                </span>
                <em>{item.due_date || "일정 미정"}</em>
              </Link>
            ))}
            {!view.videos.length ? (
              <div className="quiet-state">
                <Film />
                <strong>진행 영상 없음</strong>
                <span>콘텐츠 기획을 등록하면 단계별로 표시됩니다.</span>
              </div>
            ) : null}
          </div>
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>최근 지식</h2>
              <p>새로 저장되거나 수정된 문서</p>
            </div>
            <Link className="panel-link" href="/knowledge">
              전체 보기 <ArrowRight size={13} />
            </Link>
          </div>
          <div className="recent-knowledge">
            {documents.slice(0, 6).map((item) => (
              <Link href={`/knowledge?document=${item.id}`} key={item.id}>
                <FileText size={15} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.folder || "분류 없음"}</small>
                </span>
                <time>{date(item.updated_at)}</time>
              </Link>
            ))}
          </div>
        </article>
      </section>
    </>
  );
}

export function statusLabel(status: KnowledgeDocument["status"]) {
  return {
    draft: "개인 초안",
    team: "팀 공유",
    review: "검토 요청",
    reviewed: "검토 완료",
    canonical: "회사 정본",
    archived: "보관",
  }[status];
}
