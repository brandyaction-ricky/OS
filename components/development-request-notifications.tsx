"use client";

import { ArrowRight, Bell, CheckCircle2, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";
import "./development-notifications.css";

const OPEN_STATUSES = [
  { id: "backlog", label: "접수" },
  { id: "active", label: "진행" },
  { id: "review", label: "검토" },
  { id: "blocked", label: "보류" },
] as const;

type RequestStatus = (typeof OPEN_STATUSES)[number]["id"] | "done";

interface RequestSummary {
  requests: OsRecord[];
  counts: Record<RequestStatus, number>;
  total: number;
  canManage: boolean;
}

function statusLabel(status: string) {
  return OPEN_STATUSES.find((item) => item.id === status)?.label ?? (status === "done" ? "완료" : "접수");
}

export function DevelopmentRequestNotifications({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { accessToken, profile, demo, loading } = useSession();
  const [summary, setSummary] = useState<RequestSummary | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const canManage = profile?.role === "admin";
  const ready = !loading && Boolean(profile && accessToken) && !demo;

  const refresh = useCallback(async () => {
    if (!ready || document.visibilityState === "hidden") return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setRefreshing(true);
    try {
      const query = new URLSearchParams({ summary: "1" });
      if (!canManage) query.set("scope", "mine");
      const response = await fetch(`/api/v1/development-requests?${query}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Request summary unavailable");
      const data: RequestSummary = await response.json();
      if (!data.counts || !Array.isArray(data.requests) ||
        OPEN_STATUSES.some(({ id }) => !Number.isFinite(data.counts[id]))) {
        throw new Error("Invalid request summary");
      }
      if (controller.signal.aborted) return;
      setSummary(data);
      setError(false);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, [accessToken, canManage, ready]);

  useEffect(() => {
    setSummary(null);
    setError(false);
    void refresh();
    const onRefresh = () => void refresh();
    const timer = window.setInterval(onRefresh, 60_000);
    window.addEventListener("focus", onRefresh);
    window.addEventListener("brandy-development-requests-changed", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => {
      requestRef.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener("brandy-development-requests-changed", onRefresh);
      document.removeEventListener("visibilitychange", onRefresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    void refresh();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onOpenChange, open, refresh]);

  const pending = summary && !error && ready
    ? OPEN_STATUSES.reduce((total, { id }) => total + summary.counts[id], 0)
    : null;
  const recentRequests = summary?.requests
    .filter((request) => !canManage || request.status !== "done")
    .sort((a, b) => {
      if (canManage && (a.status === "backlog") !== (b.status === "backlog")) {
        return a.status === "backlog" ? -1 : 1;
      }
      return (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at);
    })
    .slice(0, 5) ?? [];
  const listHref = `/knowledge/development${canManage ? "" : "?scope=mine"}`;

  return (
    <div
      className="development-notifications"
      ref={wrapperRef}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) {
          onOpenChange(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="icon-button development-notifications-trigger"
        aria-label={error ? "수정 요청 현황, 불러오기 실패" : pending === null ? "수정 요청 현황" : `수정 요청 현황, 미완료 ${pending}건`}
        title="수정 요청 현황"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => onOpenChange(!open)}
      >
        <Bell size={18} aria-hidden="true" />
        {pending !== null && pending > 0 ? (
          <span className="development-notifications-badge" aria-hidden="true">{pending > 99 ? "99+" : pending}</span>
        ) : null}
        {error ? <span className="development-notifications-unavailable" aria-hidden="true">!</span> : null}
      </button>
      {open ? (
        <section
          id={panelId}
          ref={panelRef}
          className="development-notifications-panel"
          role="dialog"
          aria-labelledby={`${panelId}-title`}
          tabIndex={-1}
        >
          <header>
            <div>
              <h2 id={`${panelId}-title`}>수정 요청 현황</h2>
              <p>{canManage ? "직원 요청을 확인하고 개발로 연결하세요." : "내가 남긴 요청의 진행 상황입니다."}</p>
            </div>
            <button type="button" className="icon-button" aria-label="수정 요청 현황 닫기" onClick={() => {
              onOpenChange(false);
              triggerRef.current?.focus();
            }}><X size={16} /></button>
          </header>
          {demo ? (
            <div className="development-notifications-state">데모 모드에서는 운영 요청을 확인할 수 없습니다.</div>
          ) : !ready ? (
            <div className="development-notifications-state" role="status">로그인 정보를 확인하고 있습니다.</div>
          ) : error ? (
            <div className="development-notifications-state" role="status">
              <strong>요청 현황을 불러오지 못했습니다.</strong>
              <p>연결을 확인한 뒤 다시 시도해 주세요.</p>
              <button type="button" onClick={() => void refresh()} disabled={refreshing}>
                <RefreshCw size={14} />{refreshing ? "확인 중…" : "다시 불러오기"}
              </button>
            </div>
          ) : summary === null ? (
            <div className="development-notifications-state" role="status">요청 현황을 불러오는 중입니다.</div>
          ) : (
            <>
              <div className="development-notifications-count">
                <span>{canManage ? "미완료 요청" : "내 미완료 요청"}</span>
                <strong>{pending}<small>건</small></strong>
              </div>
              <div className="development-notifications-statuses">
                {OPEN_STATUSES.map(({ id, label }) => (
                  <Link key={id} href={`/knowledge/development?status=${id}${canManage ? "" : "&scope=mine"}`} onClick={() => onOpenChange(false)}>
                    <span>{label}</span><strong>{summary.counts[id]}</strong>
                  </Link>
                ))}
              </div>
              {recentRequests.length ? (
                <div className="development-notifications-list">
                  <p>{canManage ? "최근 요청 · 접수 우선" : "내 최근 요청"}</p>
                  {recentRequests.map((request) => (
                    <Link key={request.id} href={`/knowledge/development?request=${encodeURIComponent(request.id)}`} onClick={() => onOpenChange(false)}>
                      <span className={`development-notifications-status is-${request.status}`}>{statusLabel(request.status)}</span>
                      <strong>{request.title}</strong>
                      <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="development-notifications-state">
                  <CheckCircle2 size={22} />
                  {canManage
                    ? pending ? "전체 요청에서 미완료 항목을 확인해 주세요." : "미완료 요청이 없습니다."
                    : summary.total ? "전체 요청에서 진행 상황을 확인해 주세요." : "아직 남긴 수정 요청이 없습니다."}
                </div>
              )}
            </>
          )}
          <footer>
            <span>{demo ? "운영 연결 필요" : !ready ? "로그인 확인 중" : refreshing ? "현황 확인 중…" : "접속 중 1분마다 갱신"}</span>
            <Link href={listHref} onClick={() => onOpenChange(false)}>{canManage ? "개발 관리 열기" : "내 요청 모두 보기"}<ArrowRight size={14} /></Link>
          </footer>
        </section>
      ) : null}
    </div>
  );
}
