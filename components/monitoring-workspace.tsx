"use client";

import {
  Activity,
  Bot,
  CheckCircle2,
  CircleAlert,
  Database,
  KeyRound,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  connectTelegramWebhook,
  decideTelegramUser,
  getHealth,
  getIndexingStatus,
  getTelegramStatus,
  listDocuments,
  listRecords,
  runIndexing,
  type EmbeddingQueueStatus,
  type TelegramConnectionStatus,
} from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

export function MonitoringWorkspace() {
  const { accessToken, demo } = useSession();
  const [health, setHealth] = useState<Awaited<
    ReturnType<typeof getHealth>
  > | null>(null);
  const [connections, setConnections] = useState<OsRecord[]>([]);
  const [documents, setDocuments] = useState(0);
  const [queue, setQueue] = useState<EmbeddingQueueStatus | null>(null);
  const [indexingConfigured, setIndexingConfigured] = useState(false);
  const [cronConfigured, setCronConfigured] = useState(false);
  const [telegramStatus, setTelegramStatus] =
    useState<TelegramConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (demo) return;
    setLoading(true);
    try {
      const [
        status,
        connectionResult,
        documentResult,
        indexingResult,
        telegramResult,
      ] = await Promise.all([
        getHealth(),
        listRecords(accessToken, "connection", "limit=200"),
        listDocuments(accessToken, "limit=1"),
        getIndexingStatus(accessToken),
        getTelegramStatus(accessToken).catch(() => null),
      ]);
      setHealth(status);
      setConnections(connectionResult.records);
      setDocuments(documentResult.total);
      setQueue(indexingResult.queue);
      setIndexingConfigured(indexingResult.configured);
      setCronConfigured(indexingResult.cronConfigured);
      setTelegramStatus(telegramResult);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "운영 상태를 확인하지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, demo]);
  useEffect(() => {
    load();
  }, [load]);
  const run = async (action: "process" | "retry_failed") => {
    setLoading(true);
    try {
      await runIndexing(accessToken, action, action === "process" ? 25 : 100);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "인덱싱 작업을 실행하지 못했습니다.",
      );
      setLoading(false);
    }
  };
  const connectTelegram = async () => {
    setLoading(true);
    try {
      await connectTelegramWebhook(accessToken);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "텔레그램 웹훅을 연결하지 못했습니다.",
      );
      setLoading(false);
    }
  };
  const decideTelegram = async (
    externalUserId: string,
    action: "approve" | "reject",
  ) => {
    setLoading(true);
    try {
      await decideTelegramUser(accessToken, externalUserId, action);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "텔레그램 사용자 승인 상태를 저장하지 못했습니다.",
      );
      setLoading(false);
    }
  };
  const status = (
    ready: boolean,
    title: string,
    description: string,
    icon: React.ReactNode,
  ) => (
    <article className="panel service-status">
      <span className={ready ? "ready" : "waiting"}>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <em className={ready ? "ready" : "waiting"}>{ready ? "정상" : "대기"}</em>
    </article>
  );
  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <span className="eyebrow">OPERATIONS MONITORING</span>
          <h1>운영 모니터링</h1>
          <p>DB·인증·검색·메시지 연결과 내부 데이터 준비 상태를 점검합니다.</p>
        </div>
        <button className="secondary-button" disabled={loading} onClick={load}>
          <RefreshCw size={15} className={loading ? "spin" : ""} /> 새로 확인
        </button>
      </header>
      {error ? (
        <div className="inline-alert danger">
          <CircleAlert size={16} /> {error}
        </div>
      ) : null}
      <section className="monitor-summary panel">
        <span className={health?.ok ? "healthy" : "partial"}>
          <Activity size={20} />
        </span>
        <div>
          <strong>
            {health?.ok ? "핵심 서버 정상" : "핵심 서버 확인 필요"}
          </strong>
          <p>
            {health?.checkedAt
              ? new Intl.DateTimeFormat("ko-KR", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(health.checkedAt))
              : "확인 중"}
          </p>
        </div>
        <small>
          지식 문서 {documents.toLocaleString("ko-KR")}개 · 외부 연결{" "}
          {connections.length}개
        </small>
      </section>
      <section className="service-grid">
        {status(
          health?.database === "ready",
          "Supabase Database",
          health?.database === "ready"
            ? "운영 기록·지식 테이블 응답 정상"
            : "서비스 키 또는 DB 응답 확인 필요",
          <Database size={18} />,
        )}
        {status(
          health?.auth === "ready",
          "Supabase Auth",
          health?.auth === "ready"
            ? "이메일·비밀번호 세션 사용 가능"
            : "공개 인증 설정 누락",
          <KeyRound size={18} />,
        )}
        {status(
          health?.embeddings === "ready",
          "지식 검색",
          health?.embeddings === "ready"
            ? "키워드·의미·하이브리드 검색"
            : "키워드 검색만 사용 중",
          <Search size={18} />,
        )}
        {status(
          Boolean(telegramStatus?.webhook?.url),
          "Telegram",
          telegramStatus?.webhook?.url
            ? `@${telegramStatus.bot?.username ?? "bot"} 웹훅 연결됨`
            : telegramStatus?.configured
              ? "토큰 확인됨 · 웹훅 등록 대기"
              : "봇 토큰 등록 전",
          <MessageSquareText size={18} />,
        )}
      </section>
      <section className="monitor-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>임베딩 작업 큐</h2>
              <p>
                {indexingConfigured
                  ? cronConfigured
                    ? "매일 자동 실행 · 관리자 수동 실행 가능"
                    : "관리자 수동 실행 가능 · 예약 보안값 등록 대기"
                  : "OpenAI 키 등록 전에는 키워드 검색 유지"}
              </p>
            </div>
            <Search size={17} />
          </div>
          <div className="queue-metrics">
            <span>
              <strong>{queue?.pending ?? 0}</strong>
              <small>대기</small>
            </span>
            <span>
              <strong>{queue?.running ?? 0}</strong>
              <small>처리 중</small>
            </span>
            <span>
              <strong>{queue?.failed ?? 0}</strong>
              <small>실패</small>
            </span>
            <span>
              <strong>{queue?.done ?? 0}</strong>
              <small>완료</small>
            </span>
          </div>
          <div className="form-actions">
            <button
              className="primary-button"
              disabled={loading || !indexingConfigured}
              onClick={() => run("process")}
            >
              25건 처리
            </button>
            <button
              className="secondary-button"
              disabled={loading || !queue?.failed}
              onClick={() => run("retry_failed")}
            >
              실패 작업 재시도
            </button>
          </div>
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>Telegram 웹훅</h2>
              <p>
                {telegramStatus?.webhook?.lastError ||
                  (telegramStatus?.configured
                    ? "Bot API 연결 상태를 서버에서 확인합니다."
                    : "환경변수 등록 후 보안 웹훅을 연결합니다.")}
              </p>
            </div>
            <MessageSquareText size={17} />
          </div>
          <div className="queue-metrics">
            <span>
              <strong>{telegramStatus?.configured ? "등록" : "대기"}</strong>
              <small>자격 증명</small>
            </span>
            <span>
              <strong>{telegramStatus?.webhook?.url ? "연결" : "대기"}</strong>
              <small>웹훅</small>
            </span>
            <span>
              <strong>{telegramStatus?.pendingUsers?.length ?? 0}</strong>
              <small>승인 대기 사용자</small>
            </span>
            <span>
              <strong>
                {telegramStatus?.webhook?.lastError ? "오류" : "정상"}
              </strong>
              <small>최근 상태</small>
            </span>
          </div>
          {telegramStatus?.pendingUsers?.length ? (
            <div className="telegram-requests">
              {telegramStatus.pendingUsers.map((user) => (
                <div key={user.external_user_id}>
                  <span>
                    <strong>
                      {user.display_name ||
                        user.username ||
                        `Telegram ${user.external_user_id}`}
                    </strong>
                    <small>
                      @{user.username || "아이디 없음"} · ID{" "}
                      {user.external_user_id}
                    </small>
                  </span>
                  <div>
                    <button
                      className="ghost-button"
                      disabled={loading}
                      onClick={() =>
                        decideTelegram(user.external_user_id, "reject")
                      }
                    >
                      거절
                    </button>
                    <button
                      className="primary-button compact"
                      disabled={loading}
                      onClick={() =>
                        decideTelegram(user.external_user_id, "approve")
                      }
                    >
                      <CheckCircle2 size={13} />
                      승인
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="form-actions">
            <button
              className="primary-button"
              disabled={loading || !telegramStatus?.configured}
              onClick={connectTelegram}
            >
              웹훅 연결·갱신
            </button>
          </div>
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>보안 경계</h2>
              <p>현재 적용된 운영 원칙</p>
            </div>
            <ShieldCheck size={17} />
          </div>
          <ul className="security-checks">
            <li>
              <CheckCircle2 size={14} /> 비밀번호 로그인·세션 유지
            </li>
            <li>
              <CheckCircle2 size={14} /> 활성 구성원·관리자 역할 확인
            </li>
            <li>
              <CheckCircle2 size={14} /> RLS 기반 운영 기록 접근
            </li>
            <li>
              <CheckCircle2 size={14} /> Telegram 미등록 사용자 기본 차단
            </li>
            <li>
              <CheckCircle2 size={14} /> Agent PAT 정본 읽기 전용
            </li>
            <li>
              <CheckCircle2 size={14} /> 수정 이력 자동 감사 로그
            </li>
            <li>
              <CheckCircle2 size={14} /> 회의 녹음 비공개 저장·서명 URL
            </li>
          </ul>
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>외부 연결 준비</h2>
              <p>자격 증명은 OS에 원문 저장하지 않음</p>
            </div>
            <Bot size={17} />
          </div>
          <div className="connection-monitor">
            {connections.map((connection) => (
              <div key={connection.id}>
                <span
                  className={`state-dot ${connection.status === "healthy" ? "" : "demo"}`}
                />
                <span>
                  <strong>{connection.title}</strong>
                  <small>
                    {connection.description ||
                      "설정 위치와 담당자를 기록하세요."}
                  </small>
                </span>
                <em>{connection.status}</em>
              </div>
            ))}
            {!connections.length ? (
              <div className="quiet-state">
                <Bot size={21} />
                <strong>등록된 연결 없음</strong>
                <span>설정 → 연결에서 시스템을 등록하세요.</span>
              </div>
            ) : null}
          </div>
        </article>
      </section>
    </>
  );
}
