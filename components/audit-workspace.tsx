"use client";

import {
  Activity,
  Bot,
  CircleAlert,
  Clock3,
  FileClock,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
  note: string;
  created_at: string;
}

function dayValue(value: string) { return value.slice(0, 10); }

export function AuditWorkspace() {
  const { accessToken, demo } = useSession();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("all");
  const [actor, setActor] = useState("all");
  const [recordType, setRecordType] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<AuditEvent | null>(null);

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

  const visible = useMemo(() => events.filter((event) => {
    const needle = query.trim().toLocaleLowerCase("ko");
    if (needle && ![event.title, event.actor_name, event.note, ...event.changed_fields].join(" ").toLocaleLowerCase("ko").includes(needle)) return false;
    if (action !== "all" && event.event_type !== action) return false;
    if (actor !== "all" && event.actor_name !== actor) return false;
    if (recordType !== "all" && event.subject_type !== recordType) return false;
    if (from && dayValue(event.created_at) < from) return false;
    if (to && dayValue(event.created_at) > to) return false;
    return true;
  }), [action, actor, events, from, query, recordType, to]);
  const actors = [...new Set(events.map((event) => event.actor_name))].sort((a, b) => a.localeCompare(b, "ko"));
  const recordTypes = [...new Set(events.map((event) => event.subject_type))].sort();

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
          <span className="count-badge">{loading ? "확인 중" : `${visible.length}/${events.length}`}</span>
        </div>
        <div className="audit-filters">
          <label className="audit-search"><Search size={14} /><input aria-label="감사 로그 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="기록·실행자·변경 내용 검색" /></label>
          <select aria-label="감사 동작 필터" value={action} onChange={(event) => setAction(event.target.value)}><option value="all">모든 동작</option>{[...new Set(events.map((event) => event.event_type))].map((item) => <option key={item} value={item}>{auditEventLabel(item)}</option>)}</select>
          <select aria-label="감사 실행자 필터" value={actor} onChange={(event) => setActor(event.target.value)}><option value="all">모든 실행자</option>{actors.map((item) => <option key={item}>{item}</option>)}</select>
          <select aria-label="감사 기록 유형 필터" value={recordType} onChange={(event) => setRecordType(event.target.value)}><option value="all">모든 기록 유형</option>{recordTypes.map((item) => <option key={item} value={item}>{auditRecordLabel(item)}</option>)}</select>
          <label><span>시작</span><input aria-label="감사 시작일" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span>종료</span><input aria-label="감사 종료일" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
        {loading ? (
          <div className="settings-loading-state audit-loading" aria-live="polite" aria-busy="true">
            <LoaderCircle className="spin" size={22} />
            <div><strong>변경 이력을 불러오는 중입니다.</strong><p>기록 수를 확인한 뒤 표시합니다.</p></div>
          </div>
        ) : visible.length ? (
          <div className="audit-list">
            {visible.map((event) => {
              const recordType = event.subject_type;
              const fields = auditFieldLabels(event.changed_fields);
              const transition =
                event.from_status !== event.to_status
                  ? ` · 상태: ${auditStatusLabel(event.from_status, recordType)} → ${auditStatusLabel(event.to_status, recordType)}`
                  : "";
              return (
                <button type="button" key={event.id} onClick={() => setSelected(event)}>
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
                </button>
              );
            })}
          </div>
        ) : error ? null : (
          <div className="empty-state">
            <div><FileClock /><h3>{events.length ? "조건에 맞는 변경 이력이 없습니다." : "아직 변경 이력이 없습니다."}</h3><p>{events.length ? "검색어나 필터 조건을 바꿔보세요." : "운영 기록을 만들거나 수정하면 자동으로 쌓입니다."}</p></div>
          </div>
        )}
      </section>
      {selected ? <div className="drawer-backdrop" onMouseDown={() => setSelected(null)}><section className="record-drawer audit-detail" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">변경 상세</span><h2>{selected.title}</h2></div><button type="button" className="icon-button" aria-label="감사 상세 닫기" onClick={() => setSelected(null)}><X size={18} /></button></div><dl><div><dt>실행자</dt><dd>{selected.actor_name} · {selected.actor_type === "agent" ? "AI 에이전트" : "구성원"}</dd></div><div><dt>동작</dt><dd>{auditEventLabel(selected.event_type)}</dd></div><div><dt>기록 유형</dt><dd>{auditRecordLabel(selected.subject_type)}</dd></div><div><dt>상태 변경</dt><dd>{selected.from_status !== selected.to_status ? `${auditStatusLabel(selected.from_status, selected.subject_type)} → ${auditStatusLabel(selected.to_status, selected.subject_type)}` : "상태 변경 없음"}</dd></div><div><dt>변경 필드</dt><dd>{auditFieldLabels(selected.changed_fields).join(", ") || "세부 필드 기록 없음"}</dd></div><div><dt>변경 사유</dt><dd>{selected.note || "기록된 사유 없음"}</dd></div><div><dt>실행 시각</dt><dd>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "medium" }).format(new Date(selected.created_at))}</dd></div></dl></section></div> : null}
    </>
  );
}
