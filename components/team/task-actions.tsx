"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest, archiveRecord, createRecord, updateRecord, type OsMember } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { TEAM_BUSINESSES, teamBrand, teamBusiness } from "@/lib/team/business";
import { teamCommand } from "@/lib/team/client";
import { wordSimilarity } from "@/lib/team/duplicates";
import type { Meeting } from "@/lib/knowledge/model";
import { taskStatusForColumn, type TeamTaskColumn } from "@/lib/team/status";
import { taskSource } from "@/lib/team/source";

function errorMessage(error: unknown) { return error instanceof Error ? error.message : "업무를 저장하지 못했습니다."; }
type TaskActivity = { id: number; actor_id: string | null; event_type: string; note: string; created_at: string };

export function CreateTeamTask({ token, members, projects, onChanged, decisionId }: { token: string; members: OsMember[]; projects: OsRecord[]; onChanged: () => Promise<void>; decisionId?: string }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [title, setTitle] = useState(""), [assignee, setAssignee] = useState(""), [business, setBusiness] = useState(""), [projectId, setProjectId] = useState(""), [priority, setPriority] = useState("normal"), [doneCriteria, setDoneCriteria] = useState(""), [due, setDue] = useState(""), [description, setDescription] = useState("");
  async function save() {
    setBusy(true); setError("");
    try {
      await createRecord(token, { recordType: "task", title: title.trim(), assigneeId: assignee, brand: teamBrand(business), dueDate: due || null, description, priority, status: "planned", metadata: { source: "direct", ...(projectId ? { projectId } : {}), ...(doneCriteria.trim() ? { doneCriteria: doneCriteria.trim() } : {}), ...(decisionId ? { decisionId } : {}) } });
      await onChanged(); setOpen(false); setTitle(""); setAssignee(""); setBusiness(""); setProjectId(""); setPriority("normal"); setDoneCriteria(""); setDue(""); setDescription("");
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <><button className="primary-button compact" type="button" onClick={() => setOpen(true)}>＋ 업무 추가</button>{open ? <div className="modal-backdrop"><section className="form-modal" role="dialog" aria-modal="true" aria-label="업무 추가"><div className="drawer-head"><h2>업무 추가</h2><button className="secondary-button compact" onClick={() => setOpen(false)}>닫기</button></div><div className="tm-modal-body"><label>업무명 <span className="tm-required">필수</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={240} /></label><label>담당 <span className="tm-required">필수</span><select value={assignee} onChange={event => setAssignee(event.target.value)}><option value="">담당 선택</option>{members.map(member => <option value={member.id} key={member.id}>{member.display_name}</option>)}</select></label><label>사업 <span className="tm-required">필수</span><select value={business} onChange={event => setBusiness(event.target.value)}><option value="">사업 선택</option>{TEAM_BUSINESSES.map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label><label>프로젝트<select value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">프로젝트 없음</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><label>기한<input type="date" value={due} onChange={event => setDue(event.target.value)} /></label><details><summary>완료 기준 · 우선순위 · 설명</summary><label>완료 기준<textarea value={doneCriteria} maxLength={2000} onChange={event => setDoneCriteria(event.target.value)} rows={3} /></label><label>우선순위<select value={priority} onChange={event => setPriority(event.target.value as OsRecord["priority"])}><option value="low">낮음</option><option value="normal">보통</option><option value="high">높음</option><option value="urgent">긴급</option></select></label><label>설명<textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} /></label></details>{error ? <p className="tm-danger-text" role="alert">{error}</p> : null}<button className="primary-button compact" disabled={busy || !title.trim() || !assignee || !business} onClick={() => void save()}>업무 저장</button></div></section></div> : null}</>;
}

export function EditableTaskDrawer({ task, token, members, projects, onChanged }: { task: OsRecord; token: string; members: OsMember[]; projects: OsRecord[]; onChanged: () => Promise<void> }) {
  const params = useSearchParams();
  const next = new URLSearchParams(params.toString()); next.delete("task");
  const [status, setStatus] = useState(task.status), [assignee, setAssignee] = useState(task.assignee_id ?? ""), [due, setDue] = useState(task.due_date ?? ""), [business, setBusiness] = useState(teamBusiness(task.brand)?.key ?? ""), [projectId, setProjectId] = useState(String(task.metadata.projectId ?? "")), [priority, setPriority] = useState(task.priority), [doneCriteria, setDoneCriteria] = useState(String(task.metadata.doneCriteria ?? "")), [reason, setReason] = useState(String(task.metadata.blockedReason ?? ""));
  const [description, setDescription] = useState(task.description), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [activity, setActivity] = useState<TaskActivity[]>([]), [comment, setComment] = useState(""), [commentBusy, setCommentBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ activity: TaskActivity[] }>(`/api/v1/team/task-comments?id=${encodeURIComponent(task.id)}`, { token })
      .then(result => { if (!cancelled) setActivity(result.activity); })
      .catch(() => { if (!cancelled) setError("활동 기록을 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [task.id, token]);
  async function addComment() {
    if (!comment.trim()) return;
    setCommentBusy(true); setError("");
    try {
      await apiRequest("/api/v1/team/task-comments", { method: "POST", token, body: JSON.stringify({ id: task.id, text: comment.trim() }) });
      const result = await apiRequest<{ activity: TaskActivity[] }>(`/api/v1/team/task-comments?id=${encodeURIComponent(task.id)}`, { token });
      setActivity(result.activity); setComment("");
    } catch (cause) { setError(errorMessage(cause)); } finally { setCommentBusy(false); }
  }
  async function save() {
    if (status === "blocked" && !reason.trim()) { setError("막힘 사유를 입력해 주세요."); return; }
    setBusy(true); setError("");
    try {
      await updateRecord(token, { id: task.id, expectedVersion: task.version, status, assigneeId: assignee || null, dueDate: due || null, brand: teamBrand(business) ?? task.brand, priority, description, metadata: { ...task.metadata, projectId: projectId || null, doneCriteria: doneCriteria.trim(), blockedReason: status === "blocked" ? reason.trim() : task.metadata.blockedReason } });
      await onChanged();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <div className="drawer-backdrop"><aside className="record-drawer tm-drawer" role="dialog" aria-modal="true" aria-label="업무 상세"><div className="drawer-head"><h2>{task.title}</h2><Link className="secondary-button compact" href={`/organization/tasks?${next}`}>닫기</Link></div><div className="tm-field-grid"><span>상태</span><select aria-label="업무 상태" value={status} onChange={event => setStatus(event.target.value)}><option value={taskStatusForColumn("todo", task.status)}>할 일</option><option value="active">진행 중</option><option value="blocked">막힘</option><option value="review">검수</option><option value="done">완료</option></select><span>담당</span><select aria-label="업무 담당" value={assignee} onChange={event => setAssignee(event.target.value)}><option value="">미정 · 분류함</option>{members.map(member => <option value={member.id} key={member.id}>{member.display_name}</option>)}</select><span>기한</span><input aria-label="업무 기한" type="date" value={due} onChange={event => setDue(event.target.value)} /><span>사업</span><select aria-label="업무 사업" value={business} onChange={event => setBusiness(event.target.value)}><option value="">사업 미지정</option>{TEAM_BUSINESSES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select><span>프로젝트</span><select aria-label="업무 프로젝트" value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">프로젝트 없음</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select><span>우선순위</span><select aria-label="업무 우선순위" value={priority} onChange={event => setPriority(event.target.value as OsRecord["priority"])}><option value="low">낮음</option><option value="normal">보통</option><option value="high">높음</option><option value="urgent">긴급</option></select></div>{status === "blocked" ? <label className="tm-stack">막힘 사유<input value={reason} onChange={event => setReason(event.target.value)} /></label> : null}<label className="tm-stack">완료 기준<textarea value={doneCriteria} maxLength={2000} onChange={event => setDoneCriteria(event.target.value)} rows={3} /></label><label className="tm-stack">업무 내용<textarea value={description} onChange={event => setDescription(event.target.value)} rows={5} /></label><div className="tm-block"><h3>출처</h3><p>{taskSource(task) === "meeting" ? "회의" : taskSource(task) === "telegram" ? "텔레그램 피드백" : taskSource(task) === "planning" ? "기획안" : "직접 요청"}</p>{task.parent_id && taskSource(task) === "meeting" ? <Link href={`/organization/meetings?meeting=${encodeURIComponent(task.parent_id)}`}>근거 회의 열기</Link> : null}</div><div className="tm-block"><h3>활동·댓글</h3>{activity.length ? <ol className="tm-timeline">{activity.map(entry => <li key={entry.id}>{new Date(entry.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · {entry.event_type === "comment" ? entry.note : entry.note || (entry.event_type === "task_merge" ? "중복 업무 병합" : "업무 변경")}</li>)}</ol> : <p className="tm-muted">활동 기록이 없습니다.</p>}<label className="tm-stack">댓글<textarea value={comment} maxLength={2000} rows={3} onChange={event => setComment(event.target.value)} /></label><button type="button" className="secondary-button compact" disabled={commentBusy || !comment.trim()} onClick={() => void addComment()}>댓글 등록</button></div>{error ? <p className="tm-danger-text" role="alert">{error}</p> : null}<button className="primary-button compact" disabled={busy} onClick={() => void save()}>변경 저장</button></aside></div>;
}

export async function moveTeamTask(task: OsRecord, column: TeamTaskColumn, token: string, blockedReason?: string) {
  if (column === "blocked" && !blockedReason?.trim()) throw new Error("막힘 사유를 입력해 주세요.");
  return updateRecord(token, { id: task.id, expectedVersion: task.version, status: taskStatusForColumn(column, task.status), ...(column === "blocked" ? { metadata: { ...task.metadata, blockedReason: blockedReason?.trim() } } : {}) });
}

export function TeamTaskInbox({ tasks, allTasks, meetings, members, userId, admin, token, onChanged }: {
  tasks: OsRecord[]; allTasks: OsRecord[]; meetings: Meeting[]; members: OsMember[];
  userId?: string; admin: boolean; token: string; onChanged: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [assignee, setAssignee] = useState("");
  const [business, setBusiness] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const groups = new Map<string, OsRecord[]>();
  for (const task of tasks) {
    const meetingId = task.parent_id && meetings.some(meeting => meeting.id === task.parent_id) ? task.parent_id : null;
    const key = meetingId ?? "direct";
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  function duplicateOf(task: OsRecord) {
    return allTasks.filter(other => other.id !== task.id && other.brand === task.brand && !["done", "cancelled"].includes(other.status) && wordSimilarity(other.title, task.title) >= 0.6)
      .sort((a, b) => wordSimilarity(b.title, task.title) - wordSimilarity(a.title, task.title))[0];
  }
  async function assignOne(task: OsRecord, memberId: string) {
    if (!memberId) return;
    setBusy(true); setError("");
    try { await updateRecord(token, { id: task.id, expectedVersion: task.version, assigneeId: memberId }); await onChanged(); }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function assign() {
    setBusy(true); setError("");
    try {
      const rows = tasks.filter(task => selected.includes(task.id));
      if (!rows.length || rows.length > 20 || !assignee) throw new Error("업무 1~20개와 담당자를 선택해 주세요.");
      const failures: string[] = [];
      for (const task of rows) {
        try { await updateRecord(token, { id: task.id, expectedVersion: task.version, assigneeId: assignee, ...(due ? { dueDate: due } : {}), ...(business ? { brand: teamBrand(business) } : {}) }); }
        catch { failures.push(task.id); }
      }
      setSelected(failures); await onChanged();
      if (failures.length) setError(`${failures.length}건을 저장하지 못했습니다. 남은 항목을 확인해 주세요.`);
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function merge(task: OsRecord, target: OsRecord) {
    if (!window.confirm(`‘${task.title}’을 ‘${target.title}’에 합칠까요? 현재 업무는 보관되고 이력은 남습니다.`)) return;
    setBusy(true); setError("");
    try { await teamCommand(token, { action: "task.merge", id: task.id, expectedVersion: task.version, targetId: target.id, targetVersion: target.version }); await onChanged(); }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function notTask(task: OsRecord) {
    if (!window.confirm("이 항목을 업무 아님으로 보관할까요? 삭제되지 않습니다.")) return;
    setBusy(true); setError("");
    try { await updateRecord(token, { id: task.id, expectedVersion: task.version, metadata: { ...task.metadata, notTask: true } }); await archiveRecord(token, task.id); await onChanged(); }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <section className="panel">
    <div className="tm-inbox-group-head">담당 미정 업무 <span className="tm-count">{tasks.length}</span></div>
    {tasks.length ? [...groups].map(([group, rows]) => {
      const meeting = meetings.find(item => item.id === group);
      return <div key={group}>
        <div className="tm-inbox-group-head">{meeting ? <Link href={`/organization/meetings?meeting=${encodeURIComponent(meeting.id)}`}>{meeting.title}</Link> : "직접 요청 · 그 외"}<span className="tm-count">{rows.length}</span></div>
        {rows.map(task => {
          const similar = duplicateOf(task);
          const canMerge = similar && (admin || (task.owner_id === userId || task.assignee_id === userId) && (similar.owner_id === userId || similar.assignee_id === userId));
          return <div className="tm-inbox-row" key={task.id}>
            <input type="checkbox" aria-label={`${task.title} 선택`} checked={selected.includes(task.id)} onChange={event => setSelected(current => event.target.checked ? [...current, task.id] : current.filter(id => id !== task.id))} />
            <div className="tm-task-main"><Link href={`/organization/tasks?view=inbox&task=${encodeURIComponent(task.id)}`}>{task.title}</Link><div className="tm-task-meta"><span>{teamBusiness(task.brand)?.label ?? "사업 미지정"}</span><span>{task.due_date ?? "기한 미정"}</span>{meeting ? <span>회의 후속</span> : null}</div>
              {similar ? <small className="tm-muted">중복 의심 · <Link href={`/organization/tasks?view=inbox&task=${encodeURIComponent(similar.id)}`}>{similar.title}</Link></small> : null}
            </div>
            <div className="tm-inbox-actions"><select aria-label={`${task.title} 담당 지정`} defaultValue="" disabled={busy} onChange={event => void assignOne(task, event.target.value)}><option value="">담당 지정</option>{members.map(member => <option key={member.id} value={member.id}>{member.display_name}</option>)}</select>{similar ? <button type="button" className="secondary-button compact" disabled={busy || !canMerge} title={!canMerge ? "두 업무의 작성자·담당자 또는 관리자만 합칠 수 있습니다." : undefined} onClick={() => void merge(task, similar)}>합치기</button> : null}<button type="button" className="secondary-button compact" disabled={busy} onClick={() => void notTask(task)}>업무 아님</button></div>
          </div>;
        })}
      </div>;
    }) : <div className="empty-state">분류할 업무가 없습니다.</div>}
    {selected.length ? <div className="tm-sticky-bar"><strong>{selected.length}개 선택</strong><select aria-label="일괄 담당" value={assignee} onChange={event => setAssignee(event.target.value)}><option value="">담당 선택</option>{members.map(member => <option key={member.id} value={member.id}>{member.display_name}</option>)}</select><input type="date" aria-label="일괄 기한" value={due} onChange={event => setDue(event.target.value)} /><select aria-label="일괄 사업" value={business} onChange={event => setBusiness(event.target.value)}><option value="">사업 유지</option>{TEAM_BUSINESSES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select><button className="primary-button compact" disabled={busy || !assignee || selected.length > 20} onClick={() => void assign()}>배정</button></div> : null}
    {error ? <p className="tm-danger-text" role="alert">{error}</p> : null}
  </section>;
}
