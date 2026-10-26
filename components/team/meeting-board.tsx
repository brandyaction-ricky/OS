"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest, updateRecord, type OsMember } from "@/lib/api-client";
import { formatKpiValue, kpiProgress, kstMonth } from "@/lib/kpi";
import { activeRuns } from "@/lib/kpi-runs";
import type { Meeting } from "@/lib/knowledge/model";
import type { OsRecord } from "@/lib/record-types";
import { teamBusiness } from "@/lib/team/business";
import { taskColumn, taskStatusForColumn, type TeamTaskColumn } from "@/lib/team/status";
import "./meeting-board.css";

export type MeetingNote = { id: string; actor_id: string; note: string; created_at: string };
type BoardKpi = { id: string; title: string; unit: string; target: number | null; current: number | null; metric: "revenue" | "manual"; version: number };
type BoardTab = "open" | "tasks" | "kpi" | "notes";
const COLUMNS: [TeamTaskColumn, string][] = [["todo", "할 일"], ["active", "진행"], ["blocked", "막힘"], ["review", "검토"], ["done", "완료"]];
const clock = (value: string) => new Date(value).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });

// What the team goes through in a meeting, next to the notes: the last meeting's open items, this
// business's open tasks, its KPIs, and one-line notes from each attendee. Notes are append-only
// events on the meeting, so several people can write at once without overwriting each other.
export function MeetingBoard({ meeting, previous, carried, tasks, members, token, canEdit, notes, onNotesChanged, onCarry, onChanged }: {
  meeting: Meeting; previous?: Meeting; carried: string[]; tasks: OsRecord[]; members: OsMember[]; token: string; canEdit: boolean;
  notes: MeetingNote[]; onNotesChanged: () => Promise<void>; onCarry: (text: string) => Promise<void>; onChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState<BoardTab>("open"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  const [kpis, setKpis] = useState<BoardKpi[] | null>(null), [kpiInput, setKpiInput] = useState<Record<string, string>>({}), [kpiReload, setKpiReload] = useState(0);
  const business = teamBusiness(meeting.brand ?? "")?.key, month = (meeting.starts_at ?? meeting.created_at ?? new Date().toISOString()).slice(0, 7);
  const name = (id?: string | null) => members.find(member => member.id === id)?.display_name ?? "담당 미정";
  const openItems = (previous?.metadata.items ?? []).filter(item => item.kind === "open" && item.state !== "discarded");
  const openTasks = tasks.filter(task => task.brand === meeting.brand && taskColumn(task.status) && taskColumn(task.status) !== "done")
    .sort((a, b) => name(a.assignee_id).localeCompare(name(b.assignee_id)) || (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  useEffect(() => {
    if (business !== "myin" && business !== "edu") { setKpis([]); return; }
    type Listed = BoardKpi;
    void apiRequest<{ businesses: { key: string; kpis?: Listed[]; rounds?: { label: string; from: string; to: string; courseTo: string | null; kpis: Listed[] }[] }[] }>(`/api/v1/kpi?month=${month}`, { token })
      .then(result => {
        const found = result.businesses.find(item => item.key === business);
        const day = month === kstMonth() ? today : `${month}-28`;
        setKpis(found?.rounds ? activeRuns(found.rounds, day).flatMap(round => round.kpis.map(kpi => ({ ...kpi, title: `${round.label} · ${kpi.title}` }))) : found?.kpis ?? []);
      }).catch(() => setKpis([]));
  }, [business, month, token, today, kpiReload]);
  async function run(work: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했습니다."); } finally { setBusy(false); }
  }
  const tabs: [BoardTab, string, number][] = [["open", "지난 미결", openItems.length], ["tasks", "업무", openTasks.length], ["kpi", "KPI", kpis?.length ?? 0], ["notes", "메모", notes.length]];
  return <section className="panel tm-board" aria-label="회의 보드">
    <div className="segmented tm-board-tabs">{tabs.map(([key, label, count]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label} <small>{count}</small></button>)}</div>
    {error ? <p className="tm-danger-text" role="alert">{error}</p> : null}
    {tab === "open" ? <div className="tm-board-list">
      {previous ? <small className="tm-muted">이전 회의 · <Link href={`/organization/meetings?meeting=${encodeURIComponent(previous.id)}`}>{previous.title}</Link></small> : null}
      {openItems.length ? openItems.map(item => <div className="tm-board-row" key={item.id}><span>{item.text}</span>
        {carried.includes(item.text) ? <small className="tm-muted">이번 후보에 있음</small>
          : canEdit ? <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void run(() => onCarry(item.text))}>이번 회의로</button> : null}</div>)
        : <p className="tm-muted">{previous ? "남은 미결이 없습니다." : "이전 회의가 없습니다."}</p>}
    </div> : null}
    {tab === "tasks" ? <div className="tm-board-list">
      {openTasks.length ? openTasks.map(task => <div className="tm-board-row" key={task.id}>
        <span><Link href={`/organization/tasks?task=${encodeURIComponent(task.id)}`}>{task.title}</Link><small className="tm-muted">{name(task.assignee_id)}{task.due_date ? ` · ${task.due_date.slice(5)}${task.due_date < today ? " 지남" : ""}` : ""}</small></span>
        <select aria-label={`${task.title} 상태`} value={taskColumn(task.status) ?? "todo"} disabled={busy} onChange={event => void run(async () => {
          await updateRecord(token, { id: task.id, expectedVersion: task.version, status: taskStatusForColumn(event.target.value as TeamTaskColumn, task.status) }); await onChanged(); })}>
          {COLUMNS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>)
        : <p className="tm-muted">진행 중인 업무가 없습니다.</p>}
    </div> : null}
    {tab === "kpi" ? <div className="tm-board-list">
      {kpis === null ? <p className="tm-muted">불러오는 중…</p> : kpis.length ? kpis.map(kpi => { const progress = kpiProgress(kpi.current, kpi.target); return <div className="tm-board-kpi" key={kpi.id}>
        <div className="tm-row"><strong>{kpi.title}</strong><span>{formatKpiValue(kpi.current, kpi.unit)} / {formatKpiValue(kpi.target, kpi.unit)}{progress === null ? "" : ` · ${progress}%`}</span></div>
        <div className="tm-kpi-bar"><i style={{ width: `${Math.min(100, progress ?? 0)}%` }} data-over={progress !== null && progress >= 100 ? "true" : undefined} /></div>
        {kpi.metric === "manual" && canEdit ? <div className="tm-row"><input aria-label={`${kpi.title} 실적`} inputMode="numeric" placeholder="실적" value={kpiInput[kpi.id] ?? ""} onChange={event => setKpiInput(current => ({ ...current, [kpi.id]: event.target.value }))} />
          <button type="button" className="secondary-button compact" disabled={busy || !(kpiInput[kpi.id] ?? "").trim() || Number.isNaN(Number((kpiInput[kpi.id] ?? "").replace(/[,\s]/g, "")))} onClick={() => void run(async () => {
            await apiRequest("/api/v1/kpi", { method: "PATCH", token, body: JSON.stringify({ id: kpi.id, expectedVersion: kpi.version, current: Number(kpiInput[kpi.id].replace(/[,\s]/g, "")) }) });
            setKpiInput(current => ({ ...current, [kpi.id]: "" })); setKpiReload(value => value + 1); })}>저장</button></div> : null}
      </div>; }) : <p className="tm-muted">{business === "myin" || business === "edu" ? "이 기간의 KPI가 없습니다." : "사업을 정하면 KPI가 보입니다."}</p>}
      <Link className="tm-muted" href="/organization/meetings?tab=kpi">KPI 탭 열기 →</Link>
    </div> : null}
    {tab === "notes" ? <div className="tm-board-list">
      {notes.length ? notes.map(item => <div className="tm-board-note" key={item.id}><small className="tm-muted">{name(item.actor_id)} · {clock(item.created_at)}</small><span>{item.note}</span></div>)
        : <p className="tm-muted">참석자가 남긴 메모가 여기에 모이고, AI 정리 때 함께 읽힙니다.</p>}
      {canEdit ? <form className="tm-row" onSubmit={event => { event.preventDefault(); if (note.trim()) void run(async () => {
        await apiRequest("/api/v1/team/task-comments", { method: "POST", token, body: JSON.stringify({ id: meeting.id, text: note.trim() }) }); setNote(""); await onNotesChanged(); }); }}>
        <input aria-label="메모" placeholder="한 줄 메모 (예: 상세페이지 시안 금요일까지)" value={note} maxLength={2000} onChange={event => setNote(event.target.value)} />
        <button type="submit" className="primary-button compact" disabled={busy || !note.trim()}>추가</button></form> : null}
    </div> : null}
  </section>;
}
