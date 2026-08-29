"use client";

import { ArrowLeft, ArrowRight, BarChart3, CalendarRange, CircleAlert, Flag, Plus, Target, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createRecord, listRecords, updateRecord } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

const STATUS_OPTIONS = [
  { value: "planned", label: "예정" },
  { value: "active", label: "진행 중" },
  { value: "blocked", label: "막힘" },
  { value: "done", label: "완료" },
];

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(value: string, delta: number) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function recordMonth(record: OsRecord) {
  const metadataMonth = typeof record.metadata?.periodMonth === "string" ? record.metadata.periodMonth : "";
  return metadataMonth || record.due_date?.slice(0, 7) || record.starts_at?.slice(0, 7) || record.created_at.slice(0, 7);
}

function attainment(record: OsRecord) {
  if (record.metric_target && record.metric_target > 0) return Math.max(0, Math.round(((record.metric_current ?? 0) / record.metric_target) * 100));
  return record.progress;
}

function monthLabel(value: string) {
  const [year, month] = value.split("-");
  return `${year}년 ${Number(month)}월`;
}

export function GoalsWorkspace() {
  const { accessToken, demo, profile } = useSession();
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [month, setMonth] = useState(currentMonth);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<OsRecord | null>(null);
  const [newType, setNewType] = useState<"goal" | "kpi">("goal");
  const [presetParentId, setPresetParentId] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (demo) return;
    setLoading(true);
    try {
      const [goals, kpis] = await Promise.all([listRecords(accessToken, "goal", "limit=200"), listRecords(accessToken, "kpi", "limit=200")]);
      setRecords([...goals.records, ...kpis.records]);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "목표와 KPI를 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, [accessToken, demo]);

  useEffect(() => { load(); }, [load]);

  const monthRecords = useMemo(() => records.filter((record) => recordMonth(record) === month), [month, records]);
  const goals = monthRecords.filter((record) => record.record_type === "goal");
  const kpis = monthRecords.filter((record) => record.record_type === "kpi");
  const average = kpis.length ? Math.round(kpis.reduce((sum, record) => sum + attainment(record), 0) / kpis.length) : 0;
  const blocked = monthRecords.filter((record) => record.status === "blocked").length;
  const completed = kpis.filter((record) => attainment(record) >= 100 || record.status === "done").length;

  const openNew = (type: "goal" | "kpi", parent?: OsRecord) => {
    setEditing(null);
    setPresetParentId(type === "kpi" && parent ? parent.id : "");
    setNewType(type);
    setEditorOpen(true);
  };

  const openEdit = (record: OsRecord) => {
    setEditing(record);
    setPresetParentId("");
    setNewType(record.record_type === "kpi" ? "kpi" : "goal");
    setEditorOpen(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const number = (name: string) => { const value = text(name); return value ? Number(value) : null; };
    const recordType = text("recordType") as "goal" | "kpi";
    const input: Record<string, unknown> = {
      recordType,
      title: text("title"),
      description: text("description"),
      status: text("status"),
      priority: text("priority"),
      brand: text("brand"),
      team: text("team"),
      parentId: recordType === "kpi" ? text("parentId") || null : null,
      dueDate: text("dueDate") || null,
      progress: number("progress") ?? 0,
      metricTarget: number("metricTarget"),
      metricCurrent: number("metricCurrent"),
      metricUnit: text("metricUnit"),
      tags: text("tags").split(",").map((item) => item.trim()).filter(Boolean),
      metadata: { ...(editing?.metadata ?? {}), periodMonth: text("periodMonth") },
    };
    setSaving(true); setError("");
    try {
      if (editing?.id) await updateRecord(accessToken, { ...input, id: editing.id, expectedVersion: editing.version });
      else await createRecord(accessToken, input);
      setEditorOpen(false); setEditing(null); setPresetParentId(""); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };

  return <>
    <header className="page-header">
      <div className="page-title-group"><span className="eyebrow">GOAL SYSTEM</span><h1>목표·KPI</h1><p>회사 목표와 측정 지표를 월별로 연결하고 달성률과 병목을 관리합니다.</p></div>
      <div className="header-actions"><button className="secondary-button" onClick={() => openNew("kpi")}><BarChart3 size={16} /> KPI 추가</button><button className="primary-button" onClick={() => openNew("goal")}><Plus size={16} /> 목표 추가</button></div>
    </header>

    <div className="period-toolbar panel">
      <button className="icon-button" onClick={() => setMonth((value) => shiftMonth(value, -1))} aria-label="이전 달"><ArrowLeft size={16} /></button>
      <label><CalendarRange size={16} /><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /><strong>{monthLabel(month)}</strong></label>
      <button className="icon-button" onClick={() => setMonth((value) => shiftMonth(value, 1))} aria-label="다음 달"><ArrowRight size={16} /></button>
      <button className="ghost-button" onClick={() => setMonth(currentMonth())}>이번 달</button>
    </div>

    {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}

    <section className="metric-grid compact-metrics">
      <div className="metric-card"><div className="metric-top"><span>월 목표</span><span className="metric-icon"><Target size={16} /></span></div><div className="metric-value">{goals.length}</div><div className="metric-caption">{monthLabel(month)} 운영 목표</div></div>
      <div className="metric-card"><div className="metric-top"><span>KPI 달성률</span><span className="metric-icon"><BarChart3 size={16} /></span></div><div className="metric-value">{average}%</div><div className="metric-caption">KPI {kpis.length}개 평균</div></div>
      <div className="metric-card"><div className="metric-top"><span>달성 KPI</span><span className="metric-icon"><Flag size={16} /></span></div><div className="metric-value">{completed}</div><div className="metric-caption good">목표값 100% 이상</div></div>
      <div className="metric-card"><div className="metric-top"><span>막힌 항목</span><span className="metric-icon"><CircleAlert size={16} /></span></div><div className="metric-value">{blocked}</div><div className={`metric-caption ${blocked ? "warn" : "good"}`}>{blocked ? "원인·행동 결정 필요" : "막힌 항목 없음"}</div></div>
    </section>

    <section className="goals-board">
      {loading ? <div className="panel loading-state">월별 목표를 불러오는 중입니다.</div> : goals.length ? goals.map((goal) => {
        const children = kpis.filter((kpi) => kpi.parent_id === goal.id);
        const progress = children.length ? Math.round(children.reduce((sum, kpi) => sum + attainment(kpi), 0) / children.length) : attainment(goal);
        return <article className="panel goal-card" key={goal.id}>
          <header><div><span className={`status-pill status-${goal.status}`}>{STATUS_OPTIONS.find((item) => item.value === goal.status)?.label ?? goal.status}</span><h2>{goal.title}</h2><p>{goal.description || "목표의 성공 기준을 입력하세요."}</p></div><button className="icon-button" onClick={() => openEdit(goal)} aria-label="목표 수정"><ArrowRight size={16} /></button></header>
          <div className="goal-progress"><div><span style={{ width: `${Math.min(progress, 100)}%` }} /></div><strong>{progress}%</strong></div>
          <div className="kpi-list">
            {children.map((kpi) => <button key={kpi.id} onClick={() => openEdit(kpi)}><span><strong>{kpi.title}</strong><small>{kpi.metric_current ?? 0} / {kpi.metric_target ?? 0} {kpi.metric_unit}</small></span><em>{attainment(kpi)}%</em></button>)}
            {!children.length ? <div className="quiet-state"><BarChart3 size={20} /><strong>연결된 KPI 없음</strong><span>목표를 판단할 측정 지표를 추가하세요.</span></div> : null}
          </div>
          <footer><span>{goal.brand || "전체 브랜드"} · {goal.team || profile?.team || "전체 팀"}</span><button className="ghost-button" onClick={() => openNew("kpi", goal)}><Plus size={14} /> 이 목표에 KPI 추가</button></footer>
        </article>;
      }) : <div className="panel empty-state"><div><span><Target /></span><h3>{monthLabel(month)} 목표가 없습니다.</h3><p>월간 목표를 만든 뒤 KPI를 연결하면 달성률이 자동 집계됩니다.</p><button className="primary-button" onClick={() => openNew("goal")}><Plus size={15} /> 목표 추가</button></div></div>}
      {goals.length && kpis.some((kpi) => !kpi.parent_id) ? <article className="panel goal-card unlinked-kpis"><header><div><span className="status-pill">연결 필요</span><h2>독립 KPI</h2><p>아직 상위 목표가 지정되지 않은 지표입니다.</p></div></header><div className="kpi-list">{kpis.filter((kpi) => !kpi.parent_id).map((kpi) => <button key={kpi.id} onClick={() => openEdit(kpi)}><span><strong>{kpi.title}</strong><small>{kpi.metric_current ?? 0} / {kpi.metric_target ?? 0} {kpi.metric_unit}</small></span><em>{attainment(kpi)}%</em></button>)}</div></article> : null}
    </section>

    {editorOpen ? <div className="drawer-backdrop" onMouseDown={() => setEditorOpen(false)}><form className="record-drawer" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <div className="drawer-head"><div><span className="eyebrow">{editing?.id ? "EDIT" : "NEW"}</span><h2>{newType === "kpi" ? "KPI" : "목표"} {editing?.id ? "수정" : "추가"}</h2></div><button type="button" className="icon-button" onClick={() => setEditorOpen(false)}><X size={18} /></button></div>
      <input type="hidden" name="recordType" value={newType} />
      <label><span>기준 월</span><input type="month" name="periodMonth" required defaultValue={(typeof editing?.metadata?.periodMonth === "string" ? editing.metadata.periodMonth : "") || month} /></label>
      <label><span>{newType === "kpi" ? "KPI 이름" : "목표 이름"}</span><input name="title" required maxLength={240} defaultValue={editing?.title ?? ""} placeholder={newType === "kpi" ? "예: 진단 일 판매 20건" : "예: 8월 진단 매출 3,000만원"} /></label>
      <label><span>설명·판단 기준</span><textarea name="description" rows={5} defaultValue={editing?.description ?? ""} placeholder="왜 필요한지, 완료를 무엇으로 판단할지 적어주세요." /></label>
      {newType === "kpi" ? <label><span>연결 목표</span><select name="parentId" defaultValue={editing?.parent_id ?? presetParentId}><option value="">연결하지 않음</option>{goals.map((goal) => <option value={goal.id} key={goal.id}>{goal.title}</option>)}</select></label> : null}
      <div className="form-grid"><label><span>상태</span><select name="status" defaultValue={editing?.status ?? "active"}>{STATUS_OPTIONS.map((status) => <option value={status.value} key={status.value}>{status.label}</option>)}</select></label><label><span>우선순위</span><select name="priority" defaultValue={editing?.priority ?? "normal"}><option value="low">낮음</option><option value="normal">보통</option><option value="high">높음</option><option value="urgent">긴급</option></select></label></div>
      <div className="form-grid three"><label><span>목표값</span><input type="number" step="any" name="metricTarget" defaultValue={editing?.metric_target ?? ""} /></label><label><span>현재값</span><input type="number" step="any" name="metricCurrent" defaultValue={editing?.metric_current ?? ""} /></label><label><span>단위</span><input name="metricUnit" defaultValue={editing?.metric_unit || "%"} placeholder="원, 건, %" /></label></div>
      <div className="form-grid"><label><span>수동 진행률</span><input type="number" min="0" max="100" name="progress" defaultValue={editing?.progress ?? 0} /></label><label><span>마감일</span><input type="date" name="dueDate" defaultValue={editing?.due_date ?? ""} /></label></div>
      <div className="form-grid"><label><span>브랜드</span><input name="brand" defaultValue={editing?.brand ?? ""} placeholder="마이인" /></label><label><span>담당 팀</span><input name="team" defaultValue={editing?.team || profile?.team || ""} /></label></div>
      <label><span>태그</span><input name="tags" defaultValue={editing?.tags?.join(", ") ?? ""} placeholder="월간, 핵심KPI" /></label>
      <div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setEditorOpen(false)}>취소</button><button className="primary-button" disabled={saving}>{saving ? "저장 중…" : "저장"}</button></div>
    </form></div> : null}
  </>;
}
