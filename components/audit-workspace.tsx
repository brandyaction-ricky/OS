"use client";

import {
  Activity,
  Bot,
  CircleAlert,
  Clock3,
  FileClock,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  auditEventLabel,
  auditFieldLabels,
  auditRecordLabel,
  auditStatusLabel,
} from "@/lib/audit-labels";
import { useSession } from "./session-provider";

interface AuditEvent {
  id: string;
  subject_id: string;
  subject_type: string;
  title: string;
  actor_id: string | null;
  actor_type: "user" | "agent";
  actor_name: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  changed_fields: string[];
  created_at: string;
}

export function AuditWorkspace() {
  const { accessToken, demo } = useSession();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");

  useEffect(() => {
    if (demo) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch("/api/v1/audit", {
      headers: { authorization: `Bearer ${accessToken}` },
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message);
        return body;
      })
      .then((body) => {
        setEvents(body.events);
        setError("");
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "감사 로그를 불러오지 못했습니다."),
      )
      .finally(() => setLoading(false));
  }, [accessToken, demo]);

  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <span className="eyebrow">감사 기록</span>
          <h1>감사 로그</h1>
          <p>운영 기록의 생성·수정·보관 이력을 되돌릴 수 있는 근거로 남깁니다.</p>
        </div>
      </header>
      {error ? (
        <div className="inline-alert danger"><CircleAlert size={16} />{error}</div>
      ) : null}
      <section className="panel audit-panel">
        <div className="panel-header">
          <div><h2>최근 변경</h2><p>최신 100건 · 읽기 전용</p></div>
          <span className="count-badge">{loading ? "확인 중" : events.length}</span>
        </div>
        {loading ? (
          <div className="settings-loading-state audit-loading" aria-live="polite" aria-busy="true">
            <LoaderCircle className="spin" size={22} />
            <div><strong>변경 이력을 불러오는 중입니다.</strong><p>기록 수를 확인한 뒤 표시합니다.</p></div>
          </div>
        ) : events.length ? (
          <div className="audit-list">
            {events.map((event) => {
              const recordType = event.subject_type;
              const fields = auditFieldLabels(event.changed_fields);
              const transition =
                event.from_status !== event.to_status
                  ? ` · 상태: ${auditStatusLabel(event.from_status, recordType)} → ${auditStatusLabel(event.to_status, recordType)}`
                  : "";
              return (
                <div key={event.id}>
                  <span className="audit-icon">
                    {event.actor_type === "agent" ? <Bot size={15} /> : event.event_type === "created" ? <Activity size={15} /> : <FileClock size={15} />}
                  </span>
                  <span>
                    <strong>{event.title}</strong>
                    <small>
                      {auditRecordLabel(recordType)} · {auditEventLabel(event.event_type)}
                      {fields.length ? ` · 변경: ${fields.join("·")}` : ""}
                      {transition}
                      {` · 실행: ${event.actor_name}`}
                    </small>
                  </span>
                  <time><Clock3 size={12} />{new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(event.created_at))}</time>
                </div>
              );
            })}
          </div>
        ) : error ? null : (
          <div className="empty-state">
            <div><FileClock /><h3>아직 변경 이력이 없습니다.</h3><p>운영 기록을 만들거나 수정하면 자동으로 쌓입니다.</p></div>
          </div>
        )}
      </section>
    </>
  );
}
