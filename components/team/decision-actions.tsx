"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listRecordVersions, type OsMember, type RecordVersionSummary } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import type { Meeting } from "@/lib/knowledge/model";
import { TEAM_BUSINESSES, teamBusiness } from "@/lib/team/business";
import { teamCommand } from "@/lib/team/client";
import type { TeamDecision } from "@/lib/team/decisions";
import { CreateTeamTask } from "@/components/team/task-actions";

const LABELS = { effective: "유효", pending: "검수 대기", superseded: "변경됨", cancelled: "폐기" };
const TONES = { effective: "approved", pending: "review", superseded: "draft", cancelled: "failed" };

export function TeamDecisionList({ rows, selectedId, members, tasks, projects, meetings, userId, admin, token, onChanged }: {
  rows: TeamDecision[]; selectedId: string | null; members: OsMember[]; tasks: OsRecord[];
  projects: OsRecord[]; meetings: Meeting[]; userId?: string; admin: boolean; token: string; onChanged: () => Promise<void>;
}) {
  const [filter, setFilter] = useState("all");
  const [business, setBusiness] = useState("all");
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<"supersede" | "drop" | null>(null);
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<RecordVersionSummary[]>([]);
  const visible = rows.filter(row => (filter === "all" || row.status === filter) && (business === "all" || teamBusiness(row.brand)?.key === business) && row.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = rows.find(row => row.id === selectedId);
  const selectedRecordId = selected?.record?.id;
  const linkedTasks = (decisionId: string) => tasks.filter(task => task.metadata.decisionId === decisionId && task.status !== "cancelled");
  const canManage = admin || Boolean(userId && meetings.find(meeting => meeting.id === selected?.meetingId)?.owner_id === userId);
  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    if (selectedRecordId) void listRecordVersions(token, selectedRecordId).then(result => { if (!cancelled) setHistory(result.versions); }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedRecordId, token]);
  async function submit() {
    if (!selected?.record || !action) return;
    setBusy(true); setError("");
    try {
      await teamCommand(token, { action: action === "supersede" ? "decision.supersede" : "decision.drop", id: selected.record.id, expectedVersion: selected.record.version, ...(action === "supersede" ? { text: text.trim() } : {}), reason: reason.trim() });
      setAction(null); setText(""); setReason(""); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "결정을 변경하지 못했습니다."); } finally { setBusy(false); }
  }
  return <>
    <div className="tm-callout" data-tone="info">결정은 ‘무엇을 정했나’만 남깁니다. 검수 전 내용은 회의에서 확인합니다.</div>
    <div className="tm-toolbar"><label className="tm-search"><input aria-label="결정 검색" placeholder="결정 검색" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {[["all", "전체"], ["effective", "유효"], ["pending", "검수 대기"], ["superseded", "변경됨"]].map(([key, label]) => <button className="tm-chip" type="button" aria-pressed={filter === key} key={key} onClick={() => setFilter(key)}>{label}</button>)}
      <select aria-label="결정 사업" value={business} onChange={event => setBusiness(event.target.value)}><option value="all">전체 사업</option>{TEAM_BUSINESSES.map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</select><span className="tm-muted">{visible.length}건</span>
    </div>
    <div className="panel tm-table-wrap">{visible.length ? <table className="data-table"><thead><tr><th>결정</th><th>상태</th><th>사업</th><th>정한 회의</th><th>정한 사람</th><th>연결 업무</th></tr></thead><tbody>{visible.map(row => { const work = linkedTasks(row.id); return <tr key={row.id}><td className="cell-title"><Link className={row.status === "superseded" ? "tm-strike" : undefined} href={`/organization/meetings?tab=decisions&record=${encodeURIComponent(row.id)}`}>{row.text}</Link>{row.record?.metadata.kind === "rule" ? <small> · 운영 규칙</small> : null}</td><td><span className="status-pill" data-status={TONES[row.status]}>{LABELS[row.status]}</span></td><td>{teamBusiness(row.brand)?.label ?? "사업 미지정"}</td><td>{row.meetingId ? <Link href={`/organization/meetings?meeting=${encodeURIComponent(row.meetingId)}`}>{row.meetingTitle}</Link> : "기록 없음"}</td><td>{members.find(member => member.id === row.decidedBy)?.display_name ?? "기록 없음"}</td><td>{work.filter(task => task.status === "done").length}/{work.length}</td></tr>; })}</tbody></table> : <div className="empty-state">표시할 결정이 없습니다.</div>}</div>
    {selected ? <div className="drawer-backdrop"><aside className="record-drawer tm-drawer" role="dialog" aria-modal="true" aria-label="결정 상세"><div className="drawer-head"><h2>결정 상세</h2><Link className="secondary-button compact" href="/organization/meetings?tab=decisions">닫기</Link></div>
      <p className="tm-drawer-title">{selected.text}</p>
      {selected.replacedBy ? <div className="tm-callout" data-tone="warn">이 결정은 변경됐습니다. 새 결정은 <Link href={`/organization/meetings?tab=decisions&record=${encodeURIComponent(selected.replacedBy)}`}>여기에서 확인</Link>하세요.</div> : null}
      <dl className="tm-kv"><dt>상태</dt><dd>{LABELS[selected.status]}</dd><dt>사업</dt><dd>{teamBusiness(selected.brand)?.label ?? "사업 미지정"}</dd><dt>정한 사람</dt><dd>{members.find(member => member.id === selected.decidedBy)?.display_name ?? "기록 없음"}</dd><dt>날짜</dt><dd>{selected.decidedAt ? new Date(selected.decidedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "기록 없음"}</dd><dt>근거 회의</dt><dd>{selected.meetingId ? <Link href={`/organization/meetings?meeting=${encodeURIComponent(selected.meetingId)}`}>{selected.meetingTitle}</Link> : "기록 없음"}</dd></dl>
      {selected.status === "pending" && selected.meetingId ? <Link className="primary-button compact" href={`/organization/meetings?meeting=${encodeURIComponent(selected.meetingId)}&step=review`}>회의에서 검수</Link> : null}
      {selected.record ? <div className="tm-stack"><h3>연결 업무</h3>{linkedTasks(selected.id).map(task => <Link key={task.id} href={`/organization/tasks?task=${encodeURIComponent(task.id)}`}>{task.title} · {task.status === "done" ? "완료" : "진행"}</Link>)}{!linkedTasks(selected.id).length ? <p className="tm-muted">연결된 업무가 없습니다.</p> : null}{selected.status === "effective" ? <CreateTeamTask token={token} members={members} projects={projects} decisionId={selected.id} onChanged={onChanged} /> : null}</div> : null}
      {history.length ? <div className="tm-stack"><h3>이력</h3><ol className="tm-timeline">{history.slice(0, 10).map(entry => <li key={entry.eventId}>{entry.createdAt.slice(0, 10)} · {entry.note || entry.eventType}</li>)}</ol></div> : null}
      {selected.status === "effective" && selected.record && selected.meetingId && canManage ? <div className="tm-row"><button className="secondary-button compact" onClick={() => setAction("supersede")}>결정 변경 기록</button><button className="secondary-button compact" onClick={() => setAction("drop")}>폐기</button></div> : null}
      {action ? <div className="tm-stack">{action === "supersede" ? <label>새 결정 문장<input value={text} maxLength={240} onChange={event => setText(event.target.value)} /></label> : null}<label>사유<input value={reason} onChange={event => setReason(event.target.value)} /></label><button className="primary-button compact" disabled={busy || !reason.trim() || (action === "supersede" && !text.trim())} onClick={() => void submit()}>기록 저장</button></div> : null}
      {error ? <p role="alert" className="tm-danger-text">{error}</p> : null}
    </aside></div> : null}
  </>;
}
