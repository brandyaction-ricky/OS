"use client";

import {
  ArrowRight,
  Bot,
  Building2,
  CheckCircle2,
  CircleAlert,
  Database,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getHealth,
  getTelegramStatus,
  listMembers,
  listRecords,
  type OsMember,
  type TelegramConnectionStatus,
} from "@/lib/api-client";
import {
  KNOWLEDGE_CATEGORIES,
  operatingStatusLabel,
  roleLabel,
  SENSITIVE_ACCESS_ROSTER,
} from "@/lib/company-settings";
import { memberMatchesRoster } from "@/lib/company-roster";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

type Page = "connections" | "access" | "company" | "channels";
type ConnectionStatus = "ready" | "warning" | "waiting";

interface ConnectionRow {
  system: string;
  purpose: string;
  owner: string;
  status: ConnectionStatus;
  location: string;
}

const POLICY_ROWS = [
  ["정본 편집", "활성 구성원", "수정본 저장 후 검토 단계"],
  ["정본 승격", "작성자 자기 승인 가능", "모든 승격 이력을 감사 로그에 기록"],
  ["경영지원 민감", "sensitive", "경영지원 권한 또는 관리자"],
  ["일반 회사 서류", "활성 구성원", "비활성 계정 자동 차단"],
  ["RS 협업 지식", "허용 팀·사용자", "브랜드·팀 범위 제한"],
] as const;

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function recordMonth(record: OsRecord) {
  const metadataMonth = record.metadata.periodMonth;
  return typeof metadataMonth === "string"
    ? metadataMonth
    : record.due_date?.slice(0, 7) ||
        record.starts_at?.slice(0, 7) ||
        record.created_at.slice(0, 7);
}

function normalized(value: string) {
  return value.toLowerCase().replaceAll(" ", "");
}

function targetInWon(record: OsRecord) {
  const target = Number(record.metric_target);
  if (!Number.isFinite(target) || target <= 0) return 0;
  const unit = record.metric_unit.toLowerCase().replaceAll(" ", "");
  const terms = `${record.title} ${record.tags.join(" ")} ${String(record.metadata.metricKind ?? "")}`.toLowerCase();
  const monetaryUnit = /(원|만원|억원|억|krw)/.test(unit);
  if (!monetaryUnit && (unit || !/(매출|revenue)/.test(terms))) return 0;
  if (unit.includes("억원") || unit === "억") return target * 100_000_000;
  if (unit.includes("만원")) return target * 10_000;
  return unit.includes("원") || !unit ? target : 0;
}

function monthlyTarget(goals: OsRecord[], brand: string) {
  const key = normalized(brand);
  return goals
    .filter(
      (goal) =>
        recordMonth(goal) === currentMonth() &&
        normalized(`${goal.brand} ${goal.title}`).includes(key),
    )
    .reduce((sum, goal) => sum + targetInWon(goal), 0);
}

function money(value: number) {
  if (value >= 100_000_000)
    return `${(value / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원`;
  return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만원`;
}

function SettingsLoading({ page }: { page: Page }) {
  return (
    <section className="panel settings-loading-state" aria-live="polite" aria-busy="true">
      <LoaderCircle className="spin" size={24} />
      <div>
        <strong>설정 정보를 확인하는 중입니다.</strong>
        <p>
          {page === "connections"
            ? "실제 서버와 외부 서비스 연결 상태를 불러옵니다."
            : "계정·권한·회사 기준을 불러옵니다."}
        </p>
      </div>
    </section>
  );
}

export function SettingsWorkspace({ page }: { page: Page }) {
  const { accessToken, demo } = useSession();
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getHealth>> | null>(null);
  const [telegram, setTelegram] = useState<TelegramConnectionStatus | null>(null);
  const [members, setMembers] = useState<OsMember[]>([]);
  const [brands, setBrands] = useState<OsRecord[]>([]);
  const [goals, setGoals] = useState<OsRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (demo) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    try {
      const [status, memberResult, brandResult, goalResult, telegramResult] =
        await Promise.all([
          getHealth(),
          listMembers(accessToken),
          listRecords(accessToken, "brand", "limit=100"),
          listRecords(accessToken, "goal", "limit=200"),
          page === "channels"
            ? getTelegramStatus(accessToken).catch(() => null)
            : Promise.resolve(null),
        ]);
      setHealth(status);
      setMembers(memberResult.members);
      setBrands(brandResult.records);
      setGoals(goalResult.records);
      setTelegram(telegramResult);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "설정 정보를 불러오지 못했습니다.",
      );
    } finally {
      setLoaded(true);
    }
  }, [accessToken, demo, page]);

  useEffect(() => {
    load();
  }, [load]);

  const active = members.filter((member) => member.is_active);
  const finance = active.filter(
    (member) => member.finance_access || member.role === "admin",
  );
  const connectionRows = useMemo<ConnectionRow[]>(
    () => [
      {
        system: "Supabase",
        purpose: "데이터베이스·로그인·접근 권한",
        owner: "리키",
        status:
          health?.database === "ready" && health.auth === "ready"
            ? "ready"
            : "waiting",
        location: "Supabase 프로젝트 설정",
      },
      {
        system: "Vercel",
        purpose: "OS 웹·API·예약 작업",
        owner: "리키",
        status: health?.checkedAt ? "ready" : "waiting",
        location: "Vercel 환경변수",
      },
      {
        system: "OpenAI",
        purpose: "의미 검색·사진 글자 읽기·지식 답변",
        owner: "리키",
        status: health?.embeddings === "ready" ? "ready" : "waiting",
        location: "Vercel 환경변수",
      },
      {
        system: "Telegram",
        purpose: "질문·폰 캡처·알림",
        owner: "리키",
        status: health?.telegram === "ready" ? "ready" : "waiting",
        location: "Vercel 환경변수",
      },
      {
        system: "Claude",
        purpose: "콘텐츠 정본 실행",
        owner: "리키",
        status: health?.contentAi === "ready" ? "ready" : "waiting",
        location: "Vercel 환경변수",
      },
      {
        system: "YouTube Data API",
        purpose: "시장 영상·공개 성과 읽기",
        owner: "리키",
        status: health?.youtube === "ready" ? "ready" : "waiting",
        location: "Vercel 환경변수",
      },
      {
        system: "YouTube 업로드 OAuth",
        purpose: "채널 동의·비공개/일부공개 업로드",
        owner: "리키",
        status: health?.youtubeOAuth === "ready" ? "ready" : "waiting",
        location: "유튜브 관리에서 채널 연결",
      },
      {
        system: "Meta·Google Ads",
        purpose: "광고비·광고수익률 읽기",
        owner: "리키",
        status:
          health?.advertising === "ready"
            ? "ready"
            : health?.advertising === "partial"
              ? "warning"
              : "waiting",
        location: "Vercel 환경변수",
      },
      {
        system: "마이인·브랜디에듀",
        purpose: "주문·고객·매출 읽기",
        owner: "담당자 지정",
        status: "waiting",
        location: "각 자사몰 관리자",
      },
      {
        system: "국민·신한 법인카드",
        purpose: "경영지원 지출 원장",
        owner: "안저",
        status: "waiting",
        location: "카드 관리자·CSV",
      },
    ],
    [health],
  );
  const title =
    page === "connections"
      ? "연결"
      : page === "access"
        ? "권한"
        : page === "company"
          ? "회사 설정"
          : "메시지 창구";
  const pageDescription =
    page === "connections"
      ? "비밀값을 노출하지 않고 무엇이·누가·어디에 연결됐는지 관리합니다."
      : page === "access"
        ? "역할과 민감 데이터 접근 규칙을 실제 구성원 권한과 함께 확인합니다."
        : page === "company"
          ? "브랜드·표시이름·연차·지식 분류의 회사 공통 기준입니다."
          : "직원이 OS 지식을 쓰는 메시지 통로와 승인 상태를 확인합니다.";
  const displayBrands = brands.length
    ? brands
    : (["마이인", "브랜디액션 에듀"].map((brand, index) => ({
        id: `default-${index}`,
        title: brand,
        description: "운영 브랜드 기본값",
        status: "active",
      })) as Pick<OsRecord, "id" | "title" | "description" | "status">[]);

  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <span className="eyebrow">설정 관리</span>
          <h1>{title}</h1>
          <p>{pageDescription}</p>
        </div>
      </header>
      {error ? (
        <div className="inline-alert danger">
          <CircleAlert size={16} /> {error}
        </div>
      ) : null}
      {!loaded ? (
        <SettingsLoading page={page} />
      ) : error && !health ? null : (
        <>
          {page === "connections" ? (
            <>
              <section className="metric-grid compact-metrics settings-connection-metrics">
                <div className="metric-card"><div className="metric-top"><span>전체 연결</span><Link2 size={16} /></div><div className="metric-value">{connectionRows.length}</div></div>
                <div className="metric-card"><div className="metric-top"><span>연결됨</span><CheckCircle2 size={16} /></div><div className="metric-value">{connectionRows.filter((row) => row.status === "ready").length}</div></div>
                <div className="metric-card"><div className="metric-top"><span>일부 연결</span><CircleAlert size={16} /></div><div className="metric-value">{connectionRows.filter((row) => row.status === "warning").length}</div></div>
                <div className="metric-card"><div className="metric-top"><span>연결 대기</span><LoaderCircle size={16} /></div><div className="metric-value">{connectionRows.filter((row) => row.status === "waiting").length}</div></div>
              </section>
              <section className="connection-master">
                {connectionRows.map((row) => (
                  <article className="panel connection-row" key={row.system}>
                    <span className={`state-dot ${row.status}`} />
                    <div className="connection-icon">{row.system === "Supabase" ? <Database /> : row.system === "Vercel" ? <Server /> : <Link2 />}</div>
                    <div><strong>{row.system}</strong><p>{row.purpose}</p></div>
                    <div><small>담당</small><span>{row.owner}</span></div>
                    <div><small>설정 위치</small><span>{row.location}</span></div>
                    <em className={`status-pill status-${row.status}`}>{row.status === "ready" ? "연결됨" : row.status === "warning" ? "일부 연결" : "연결 대기"}</em>
                  </article>
                ))}
              </section>
            </>
          ) : null}

          {page === "access" ? (
            <>
              <section className="metric-grid compact-metrics">
                <div className="metric-card"><div className="metric-top"><span>활성 구성원</span><Users size={16} /></div><div className="metric-value">{active.length}</div></div>
                <div className="metric-card"><div className="metric-top"><span>관리자</span><ShieldCheck size={16} /></div><div className="metric-value">{active.filter((member) => member.role === "admin").length}</div></div>
                <div className="metric-card"><div className="metric-top"><span>민감자료 허용</span><LockKeyhole size={16} /></div><div className="metric-value">{finance.length}</div></div>
              </section>
              <section className="panel policy-table">
                <header><span>영역</span><span>접근 주체</span><span>강제 방식</span></header>
                {POLICY_ROWS.map((row) => (
                  <div key={row[0]}>
                    <strong>{row[0]}</strong>
                    {row[1] === "sensitive" ? (
                      <span className="policy-member-list">
                        {SENSITIVE_ACCESS_ROSTER.map((name) => {
                          const account = members.find((member) => memberMatchesRoster(member, name));
                          const allowed = Boolean(account?.is_active && (account.finance_access || account.role === "admin"));
                          return <b className={allowed ? "ready" : "waiting"} key={name}>{name} · {allowed ? "허용 중" : account ? "권한 확인" : "초대 대기"}</b>;
                        })}
                      </span>
                    ) : <span>{row[1]}</span>}
                    <small>{row[2]}</small>
                  </div>
                ))}
              </section>
              <section className="panel member-role-table">
                <div className="panel-header"><div><h2>실제 계정 역할</h2><p>로그인 계정과 OS 구성원 정보 기준</p></div></div>
                {active.map((member) => (
                  <div key={member.id}>
                    <span><strong>{member.display_name || member.email.split("@")[0]}</strong><small>{member.email}</small></span>
                    <em>{roleLabel(member.role)}</em>
                    <span>{member.team || "팀 미지정"}</span>
                    <span>{member.finance_access || member.role === "admin" ? "민감 허용" : "일반"}</span>
                  </div>
                ))}
              </section>
            </>
          ) : null}

          {page === "company" ? (
            <>
              <section className="studio-two">
                <article className="panel company-block">
                  <div className="panel-header">
                    <div><h2>운영 브랜드</h2><p>브랜드 목표와 담당 기준</p></div>
                    <Link className="panel-link" href="/home/goals">월 목표 설정 <ArrowRight size={13} /></Link>
                  </div>
                  {displayBrands.map((brand) => {
                    const target = monthlyTarget(goals, brand.title);
                    return (
                      <div className="company-list-row" key={brand.id}>
                        <Building2 size={16} />
                        <span><strong>{brand.title}</strong><small>{target ? `이번 달 매출 목표 ${money(target)}` : "이번 달 매출 목표 미설정"}</small></span>
                        <em>{operatingStatusLabel(brand.status)}</em>
                      </div>
                    );
                  })}
                </article>
                <article className="panel company-block">
                  <div className="panel-header">
                    <div><h2>표시이름</h2><p>로그인 아이디 대신 사람 이름 표시</p></div>
                    <Link className="panel-link" href="/organization/members">구성원에서 수정 <ArrowRight size={13} /></Link>
                  </div>
                  {active.map((member) => (
                    <div className="company-list-row" key={member.id}>
                      <Users size={16} />
                      <span><strong>{member.display_name || "이름 미설정"}</strong><small>{member.email}</small></span>
                      <em>{roleLabel(member.role)}</em>
                    </div>
                  ))}
                </article>
              </section>
              <section className="panel category-grid">
                <div className="panel-header"><div><h2>지식 분류 8종</h2><p>지식 문서의 폴더 추천값과 공유하는 회사 기본 분류</p></div></div>
                <div>{KNOWLEDGE_CATEGORIES.map((category, index) => <span key={category}><b>{index + 1}</b>{category}</span>)}</div>
              </section>
            </>
          ) : null}

          {page === "channels" ? (
            <>
              <section className="channel-hero panel">
                <div className="connection-icon"><Bot /></div>
                <div><span className="eyebrow">텔레그램</span><h2>@brandyOS_Bot</h2><p>회사 정본 질문, 프로젝트·업무 조회, 아이디어·후기·사진 캡처를 처리합니다.</p></div>
                <em className={`status-pill status-${telegram?.configured ? "ready" : "waiting"}`}>{telegram?.configured ? "웹훅 연결됨" : "연결 대기"}</em>
              </section>
              <section className="studio-two">
                <article className="panel company-block">
                  <div className="panel-header"><div><h2>지원 기능</h2><p>한 두뇌 · 여러 통로</p></div></div>
                  {["회사 정본 검색", "프로젝트·업무·목표 조회", "#인박스 아이디어 저장", "/후기 상품후기 정본", "/썸네일기록 결정 로그", "/요약 주소 요약", "사진 글자 읽기"].map((item) => <div className="company-list-row" key={item}><CheckCircle2 size={15} /><strong>{item}</strong></div>)}
                </article>
                <article className="panel company-block">
                  <div className="panel-header"><div><h2>접근 승인</h2><p>미등록 사용자는 기본 차단</p></div></div>
                  <div className="channel-stat"><MessageSquareText /><span><strong>{telegram?.pendingUsers?.length ?? 0}명 승인 대기</strong><small>설정 → 운영 모니터링에서 승인·거절</small></span></div>
                  <div className="channel-stat"><KeyRound /><span><strong>허용 명단 + 관리자 승인</strong><small>토큰과 사용자 ID는 화면에 노출하지 않음</small></span></div>
                </article>
              </section>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
