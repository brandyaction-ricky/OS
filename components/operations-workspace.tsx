"use client";

import { Archive, ArrowUpRight, CalendarDays, CheckCircle2, CircleAlert, History, Plus, RotateCcw, Search, Target, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { archiveRecord, createRecord, listRecords, listRecordVersions, restoreRecordVersion, updateRecord, type RecordVersionSummary } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import type { WorkspaceConfig } from "@/lib/workspace-config";
import { useSession } from "./session-provider";

const priorityLabel = { low: "낮음", normal: "보통", high: "높음", urgent: "긴급" };

function dateLabel(value: string | null) {
  if (!value) return "기한 없음";
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function metricValue(record: OsRecord, mode?: WorkspaceConfig["metricMode"]) {
  if (mode === "amount") return record.amount == null ? "금액 미입력" : `${Number(record.amount).toLocaleString("ko-KR")} ${record.currency}`;
  if (mode === "target") return `${record.metric_current ?? 0} / ${record.metric_target ?? 0} ${record.metric_unit}`;
  if (mode === "schedule") return record.starts_at ? new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(record.starts_at)) : dateLabel(record.due_date);
  return `${record.progress}%`;
}

export function OperationsWorkspace({ config }: { config: WorkspaceConfig }) {
  const { demo, accessToken, profile } = useSession();
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<OsRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<RecordVersionSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = async () => {
    if (demo) return;
    setLoading(true);
    try {
      const response = await listRecords(accessToken, config.recordType);
      setRecords(response.records);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "목록을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [accessToken, config.recordType, demo]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => records.filter((record) => {
    const matchesQuery = !query || `${record.title} ${record.description} ${record.brand} ${record.team}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (statusFilter === "all" || record.status === statusFilter);
  }), [query, records, statusFilter]);

  const completed = records.filter((record) => ["done", "published", "decided", "healthy", "loyal"].includes(record.status)).length;
  const blocked = records.filter((record) => ["blocked", "warning", "churned", "disconnected"].includes(record.status)).length;
  const dueSoon = records.filter((record) => record.due_date && new Date(record.due_date).getTime() <= Date.now() + 7 * 86_400_000).length;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const number = (name: string) => { const value = String(form.get(name) ?? "").trim(); return value ? Number(value) : null; };
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const input: Record<string, unknown> = {
      recordType: config.recordType,
      title: text("title"), description: text("description"), status: text("status"), priority: text("priority"),
      brand: text("brand"), team: text("team"), dueDate: text("dueDate") || null,
      progress: number("progress") ?? 0, metricTarget: number("metricTarget"), metricCurrent: number("metricCurrent"),
      metricUnit: text("metricUnit"), amount: number("amount"), currency: "KRW",
      sourceUrl: text("sourceUrl") || null,
      tags: text("tags").split(",").map((item) => item.trim()).filter(Boolean),
      startsAt: text("startsAt") ? new Date(text("startsAt")).toISOString() : null,
    };
    setSaving(true); setError("");
    try {
      if (editing) await updateRecord(accessToken, { ...input, id: editing.id, expectedVersion: editing.version });
      else await createRecord(accessToken, input);
      setEditorOpen(false); setEditing(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };

  const openEdit = (record: OsRecord) => { setEditing(record); setEditorOpen(true); };
  const archive = async (record: OsRecord) => {
    if (!window.confirm(`“${record.title}”을 보관할까요?`)) return;
    try { await archiveRecord(accessToken, record.id); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "보관하지 못했습니다."); }
  };
  const openHistory = async (record: OsRecord) => {
    try { setEditing(record); setVersions((await listRecordVersions(accessToken, record.id)).versions); setHistoryOpen(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "변경 이력을 불러오지 못했습니다."); }
  };
  const restore = async (version: number) => {
    if (!editing || !window.confirm(`v${version} 내용으로 되돌릴까요? 현재 내용도 이력에 남습니다.`)) return;
    try { await restoreRecordVersion(accessToken, editing.id, version, editing.version); setHistoryOpen(false); setEditing(null); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "이전 버전으로 되돌리지 못했습니다."); }
  };

  return <>
    <header className="page-header">
      <div className="page-title-group"><span className="eyebrow">{config.eyebrow}</span><h1>{config.title}</h1><p>{config.description}</p></div>
      <button className="primary-button" onClick={() => { setEditing(null); setEditorOpen(true); }}><Plus size={16} /> {config.singular} 추가</button>
    </header>

    {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}

    <section className="metric-grid compact-metrics">
      <div className="metric-card"><div className="metric-top"><span>전체</span><span className="metric-icon"><Target size={16} /></span></div><div className="metric-value">{records.length}</div><div className="metric-caption">등록된 {config.singular}</div></div>
      <div className="metric-card"><div className="metric-top"><span>완료·정상</span><span className="metric-icon"><CheckCircle2 size={16} /></span></div><div className="metric-value">{completed}</div><div className="metric-caption good">실행이 끝난 항목</div></div>
      <div className="metric-card"><div className="metric-top"><span>주의 필요</span><span className="metric-icon"><CircleAlert size={16} /></span></div><div className="metric-value">{blocked}</div><div className={`metric-caption ${blocked ? "warn" : "good"}`}>{blocked ? "확인할 항목이 있습니다" : "막힌 항목 없음"}</div></div>
      <div className="metric-card"><div className="metric-top"><span>7일 내 기한</span><span className="metric-icon"><CalendarDays size={16} /></span></div><div className="metric-value">{dueSoon}</div><div className="metric-caption">오늘 포함 예정 업무</div></div>
    </section>

    <section className="panel records-panel">
      <div className="records-toolbar">
        <div className="search-field"><Search size={16} /><input aria-label={`${config.singular} 검색`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`${config.singular} 검색`} /></div>
        <select aria-label={`${config.singular} 상태 필터`} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">모든 상태</option>{config.statuses.map((status) => <option value={status.value} key={status.value}>{status.label}</option>)}</select>
        <span className="records-count">{filtered.length}개</span>
      </div>
      {loading ? <div className="loading-state">운영 기록을 불러오는 중입니다.</div> : filtered.length ? <div className="record-list">
        {filtered.map((record) => {
          const status = config.statuses.find((item) => item.value === record.status)?.label ?? record.status;
          return <article className="record-row" key={record.id} onClick={() => openEdit(record)}>
            <span className={`priority-mark priority-${record.priority}`} />
            <div className="record-main"><div><strong>{record.title}</strong><span className={`status-pill status-${record.status}`}>{status}</span></div><p>{record.description || config.helper}</p><div className="record-meta"><span>{record.brand || "전체 브랜드"}</span><span>{record.team || profile?.team || "전체 팀"}</span><span>{dateLabel(record.due_date)}</span>{record.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}</div></div>
            <div className="record-measure"><strong>{metricValue(record, config.metricMode)}</strong><small>{priorityLabel[record.priority]}</small></div>
            <button className="icon-button" onClick={(event) => { event.stopPropagation(); openHistory(record); }} aria-label="변경 이력"><History size={16} /></button>
            <button className="icon-button" onClick={(event) => { event.stopPropagation(); archive(record); }} aria-label="보관"><Archive size={16} /></button>
            <ArrowUpRight size={15} />
          </article>;
        })}
      </div> : <div className="empty-state"><div><span><Target /></span><h3>{config.empty}</h3><p>{config.helper}</p><button className="primary-button" onClick={() => { setEditing(null); setEditorOpen(true); }}><Plus size={15} /> {config.singular} 추가</button></div></div>}
    </section>

    {editorOpen ? <div className="drawer-backdrop" onMouseDown={() => setEditorOpen(false)}><form className="record-drawer" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <div className="drawer-head"><div><span className="eyebrow">{editing ? "수정" : "새 항목"}</span><h2>{editing ? config.singular + " 수정" : "새 " + config.singular}</h2></div><button type="button" className="icon-button" onClick={() => setEditorOpen(false)}><X size={18} /></button></div>
      <label><span>제목</span><input name="title" required maxLength={240} defaultValue={editing?.title} placeholder={`${config.singular} 제목`} /></label>
      <label><span>설명·완료 기준</span><textarea name="description" rows={6} defaultValue={editing?.description} placeholder={config.helper} /></label>
      <div className="form-grid"><label><span>상태</span><select name="status" defaultValue={editing?.status ?? config.defaultStatus}>{config.statuses.map((status) => <option value={status.value} key={status.value}>{status.label}</option>)}</select></label><label><span>우선순위</span><select name="priority" defaultValue={editing?.priority ?? "normal"}><option value="low">낮음</option><option value="normal">보통</option><option value="high">높음</option><option value="urgent">긴급</option></select></label></div>
      <div className="form-grid"><label><span>브랜드</span><input name="brand" defaultValue={editing?.brand} placeholder="예: 마이인" /></label><label><span>담당 팀</span><input name="team" defaultValue={editing?.team ?? profile?.team} placeholder="예: 콘텐츠" /></label></div>
      <div className="form-grid"><label><span>기한</span><input type="date" name="dueDate" defaultValue={editing?.due_date ?? ""} /></label><label><span>예정 시각</span><input type="datetime-local" name="startsAt" defaultValue={editing?.starts_at?.slice(0, 16) ?? ""} /></label></div>
      <div className="form-grid three"><label><span>진행률</span><input type="number" min="0" max="100" name="progress" defaultValue={editing?.progress ?? 0} /></label><label><span>목표값</span><input type="number" step="any" name="metricTarget" defaultValue={editing?.metric_target ?? ""} /></label><label><span>현재값</span><input type="number" step="any" name="metricCurrent" defaultValue={editing?.metric_current ?? ""} /></label></div>
      <div className="form-grid"><label><span>단위</span><input name="metricUnit" defaultValue={editing?.metric_unit ?? config.defaultUnit ?? ""} placeholder="%, 건, 조회" /></label><label><span>금액</span><input type="number" step="any" name="amount" defaultValue={editing?.amount ?? ""} /></label></div>
      <label><span>출처·결과 링크</span><input type="url" name="sourceUrl" defaultValue={editing?.source_url ?? ""} placeholder="https://" /></label>
      <label><span>태그</span><input name="tags" defaultValue={editing?.tags.join(", ")} placeholder="쉼표로 구분" /></label>
      <div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setEditorOpen(false)}>취소</button><button className="primary-button" disabled={saving}>{saving ? "저장 중…" : editing ? "변경 저장" : "등록"}</button></div>
    </form></div> : null}
    {historyOpen && editing ? <div className="drawer-backdrop" onMouseDown={() => setHistoryOpen(false)}><aside className="record-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">버전·감사</span><h2>{editing.title} 변경 이력</h2></div><button className="icon-button" onClick={() => setHistoryOpen(false)}><X size={18} /></button></div><div className="version-list">{versions.map((item) => <article key={item.eventId}><div><strong>v{item.version} · {item.eventType === "restored" ? "복원" : item.eventType === "created" ? "생성" : item.eventType === "archived" ? "휴지통 이동" : "수정"}</strong><small>{new Date(item.createdAt).toLocaleString("ko-KR")}</small><p>{item.note || (item.changedFields.length ? `${item.changedFields.join(", ")} 변경` : "변경 내용 저장")}</p></div>{item.version !== editing.version ? <button className="secondary-button" onClick={() => restore(item.version)}><RotateCcw size={14} /> 이 버전 복원</button> : <span className="count-badge">현재</span>}</article>)}{!versions.length ? <div className="list-empty">저장된 변경 이력이 없습니다.</div> : null}</div></aside></div> : null}
  </>;
}
