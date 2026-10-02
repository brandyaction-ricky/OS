"use client";
import { useRecordDeepLink } from "./use-record-deep-link";

import { demoRecord } from "@/lib/demo-record";
import { assignTaskBatch, validWorkDate } from "@/lib/task-management";
import { contentOrigin } from "@/lib/content-origin";
import { WorkspaceLoadState } from "./workspace-load-state";
import { PageTitle } from "./page-title";

import {
  CalendarDays,
  CircleAlert,
  Clock3,
  GripVertical,
  ListChecks,
  Plus,
  UserRound,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  createRecord,
  listMembers,
  listAllRecordsOfType,
  updateRecord,
  type OsMember,
} from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

const COLUMNS = [
  { id: "planned", label: "할 일", statuses: ["backlog", "planned"] },
  { id: "active", label: "진행 중", statuses: ["active", "blocked"] },
  { id: "review", label: "검수", statuses: ["review"] },
  { id: "done", label: "완료", statuses: ["done"] },
];

function daysUntilDue(value: string | null, now = new Date()) {
  if (!value) return null;
  const due = value.slice(0, 10).split("-").map(Number);
  if (due.length !== 3 || due.some((item) => !Number.isFinite(item))) return null;
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.round((Date.UTC(due[0], due[1] - 1, due[2]) - today) / 86_400_000);
}

function dueSignal(task: OsRecord) {
  if (task.status === "done") return null;
  const days = daysUntilDue(task.due_date);
  if (days === null) return null;
  if (days < 0) return { tone: "overdue", label: `기한 ${Math.abs(days)}일 초과` };
  if (days === 0) return { tone: "due-today", label: "오늘 마감" };
  if (days <= 2) return { tone: "due-soon", label: `D-${days}` };
  return null;
}

export function TasksWorkspace() {
  const { accessToken, demo, profile } = useSession();
  const [tasks, setTasks] = useState<OsRecord[]>([]);
  const [projects, setProjects] = useState<OsRecord[]>([]);
  const [meetings, setMeetings] = useState<OsRecord[]>([]);
  const [members, setMembers] = useState<OsMember[]>([]);
  const [editing, setEditing] = useState<OsRecord | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [mineOnly, setMineOnly] = useState(true);
  const [unassignedView, setUnassignedView] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchAssignee, setBatchAssignee] = useState("");
  const [batchDue, setBatchDue] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(!demo);
  useRecordDeepLink("task", "task", task => { setEditing(task); setDrawer(true); }, setError);
  const load = useCallback(async () => {
    if (demo) {setMembers([{id:profile?.id||"demo",email:"demo@example.test",display_name:"데모 담당자",role:"member",team:"",is_active:true,affiliation:"",roles:[],onboarding:{},finance_access:false,account_connected:true}]);return;}
    setLoading(true);
    try {
      const [taskResult, projectResult, meetingResult, memberResult] = await Promise.all([
        listAllRecordsOfType(accessToken, "task"),
        listAllRecordsOfType(accessToken, "project"),
        listAllRecordsOfType(accessToken, "meeting"),
        listMembers(accessToken),
      ]);
      setTasks(taskResult.filter(task=>contentOrigin(task)==="own"));
      setSelectedIds(previous=>previous.filter(id=>taskResult.some(task=>task.id===id&&!task.assignee_id)));
      setProjects(projectResult);
      setMeetings(meetingResult);
      setMembers(memberResult.members.filter((member) => member.is_active));
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "업무를 불러오지 못했습니다.",
      );
    }
    finally { setLoading(false); }
  }, [accessToken, demo, profile?.id]);
  useEffect(() => {
    load();
  }, [load]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const input = {
      recordType: "task",
      title: value("title"),
      description: value("description"),
      status: value("status"),
      priority: value("priority"),
      parentId: value("parentId") || null,
      assigneeId: value("assigneeId") || null,
      team: value("team"),
      brand: value("brand"),
      dueDate: value("dueDate") || null,
      progress: Number(value("progress") || 0),
      tags: value("tags")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      metadata: {
        ...(editing?.metadata ?? {}),
        source: value("source") || "direct",
        doneCriteria: value("doneCriteria"),
      },
    };
    setSaving(true);
    setError("");
    try {
      if (demo) {const saved=demoRecord(input,profile?.id||"demo",editing||undefined);setTasks(previous=>[saved,...previous.filter(item=>item.id!==saved.id)]);}
      else if (editing)
        await updateRecord(accessToken, {
          ...input,
          id: editing.id,
          expectedVersion: editing.version,
        });
      else await createRecord(accessToken, input);
      setDrawer(false);
      setEditing(null);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "업무를 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };
  const move = async (id: string, status: string) => {
    const task = tasks.find((item) => item.id === id);
    if (!task || task.status === status) return;
    try {
      if(demo){setTasks(previous=>previous.map(item=>item.id===task.id?{...item,status,version:item.version+1,progress:status==="done"?100:item.progress}:item));return;}
      await updateRecord(accessToken, {
        id: task.id,
        expectedVersion: task.version,
        status,
        progress: status === "done" ? 100 : task.progress,
      });
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "업무 상태를 변경하지 못했습니다.",
      );
    }
  };
  const open = (task: OsRecord | null) => {
    setEditing(task);
    setDrawer(true);
  };
  const projectName = (task: OsRecord) =>
    projects.find((project) => project.id === task.parent_id)?.title ||
    "프로젝트 없음";
  const assigneeName = (task: OsRecord) =>
    members.find((member) => member.id === task.assignee_id)?.display_name ||
    members
      .find((member) => member.id === task.assignee_id)
      ?.email.split("@")[0] ||
    "미지정";
  const unassigned = tasks.filter(task=>!task.assignee_id && (sourceFilter==="all" || String(task.metadata.source||"direct")===sourceFilter));
  const batchAssign = async () => {
    if(saving || !members.some(member=>member.id===batchAssignee&&member.is_active)) return;
    setSaving(true); setError("");
    try {
      const result=await assignTaskBatch(unassigned.filter(task=>selectedIds.includes(task.id)),batchAssignee,batchDue,async input=>{if(!demo)return updateRecord(accessToken,input);const current=tasks.find(task=>task.id===input.id);if(!current)throw new Error("업무 없음");const record=demoRecord(input,profile?.id||"demo",current);setTasks(previous=>previous.map(task=>task.id===record.id?record:task));return {record};});
      setSelectedIds(result.failed); setNotice(`${result.updated.length}개 업무를 지정했습니다.${result.failed.length ? ` ${result.failed.length}개는 저장되지 않았습니다. 최신 내용을 확인한 뒤 다시 시도하세요.` : ""}`); await load();
    } catch(reason) {setError(reason instanceof Error?reason.message:"업무를 지정하지 못했습니다.");}
    finally {setSaving(false);}
  };
  const visibleTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (unassignedView ? !task.assignee_id : Boolean(task.assignee_id)) && (sourceFilter === "all" ||
            String(task.metadata.source || "direct") === sourceFilter) &&
          (unassignedView || !mineOnly || task.assignee_id === profile?.id),
      ),
    [mineOnly, profile?.id, sourceFilter, tasks, unassignedView],
  );
  const taskSummary = useMemo(() => {
    const open = visibleTasks.filter((task) => task.status !== "done");
    return {
      total: visibleTasks.length,
      active: open.filter((task) =>
        ["active", "blocked", "review"].includes(task.status),
      ).length,
      urgent: open.filter((task) => {
        const days = daysUntilDue(task.due_date);
        return days !== null && days <= 2;
      }).length,
      week: open.filter((task) => {
        const days = daysUntilDue(task.due_date);
        return days !== null && days >= 0 && days <= 7;
      }).length,
    };
  }, [visibleTasks]);
  const sourceLabel = (task: OsRecord) => {
    const source = String(task.metadata.source || "direct");
    if (source !== "meeting")
      return source === "planning" ? "기획" : "직접";
    const meetingId = String(task.metadata.meetingId || task.parent_id || "");
    const meeting = meetings.find((item) => item.id === meetingId);
    const date = meeting?.starts_at || meeting?.created_at;
    return date ? `회의 · ${date.slice(0, 10)}` : "회의";
  };
  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <PageTitle />
          <p>프로젝트·담당자·기한과 발생 출처를 함께 관리합니다.</p>
        </div>
        <button className="primary-button" onClick={() => open(null)}>
          <Plus size={16} /> 업무 추가
        </button>
      </header>
      {demo && <p className="field-hint">데모 · 저장한 업무는 현재 화면에서만 유지됩니다.</p>}
      {error ? (
        <div className="inline-alert danger">
          <CircleAlert size={16} /> {error}
        </div>
      ) : null}
      {notice && <p role="status" className="inline-alert">{notice}</p>}
      <WorkspaceLoadState loading={loading} error={error && !tasks.length ? error : undefined} retry={load}>
      <section className="metric-grid compact-metrics task-summary">
        <div className="metric-card">
          <div className="metric-top"><span>전체 업무</span><ListChecks size={16} /></div>
          <div className="metric-value">{taskSummary.total}</div>
          <div className="metric-caption">현재 필터 기준</div>
        </div>
        <div className="metric-card">
          <div className="metric-top"><span>진행 중</span><Clock3 size={16} /></div>
          <div className="metric-value">{taskSummary.active}</div>
          <div className="metric-caption">진행·막힘·검수</div>
        </div>
        <div className="metric-card">
          <div className="metric-top"><span>기한 임박</span><CircleAlert size={16} /></div>
          <div className="metric-value">{taskSummary.urgent}</div>
          <div className="metric-caption warn">초과 또는 2일 이내</div>
        </div>
        <div className="metric-card">
          <div className="metric-top"><span>7일 내 기한</span><CalendarDays size={16} /></div>
          <div className="metric-value">{taskSummary.week}</div>
          <div className="metric-caption">오늘부터 7일</div>
        </div>
      </section>
      <div className="task-filters">
        <button className={!unassignedView && mineOnly ? "active" : ""} aria-pressed={!unassignedView&&mineOnly} onClick={()=>{setMineOnly(true);setUnassignedView(false);}}>내 업무</button>
        <button className={!unassignedView && !mineOnly ? "active" : ""} aria-pressed={!unassignedView&&!mineOnly} onClick={()=>{setMineOnly(false);setUnassignedView(false);}}>팀 업무</button>
        <button className={unassignedView ? "active" : ""} aria-pressed={unassignedView} onClick={()=>setUnassignedView(true)}>분류 대기 {unassigned.length}</button>
        {[
          ["all", "전체 출처"],
          ["meeting", "회의"],
          ["direct", "직접"],
          ["planning", "기획"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={sourceFilter === value ? "active" : ""}
            onClick={() => {setSourceFilter(value);setSelectedIds([]);}}
          >
            {label}
          </button>
        ))}
      </div>
      {unassignedView ? <section className="panel task-triage" aria-label="분류 대기">
        <header><h2>분류 대기</h2><p>담당자가 없는 업무입니다. 한 번에 20개까지 담당자와 기한을 지정하세요.</p></header>
        <div className="task-bulk-controls"><label>일괄 담당자<select value={batchAssignee} onChange={event=>setBatchAssignee(event.target.value)} disabled={saving}><option value="">담당자 선택</option>{members.map(member=><option key={member.id} value={member.id}>{member.display_name||member.email.split("@")[0]}</option>)}</select></label><label>일괄 기한<input type="date" value={batchDue} onChange={event=>setBatchDue(event.target.value)} disabled={saving}/></label><button className="primary-button" disabled={saving||!selectedIds.length||!members.some(member=>member.id===batchAssignee&&member.is_active)||!validWorkDate(batchDue)} onClick={()=>void batchAssign()}>{saving?"지정 중…":`${selectedIds.length}개 지정`}</button></div>
        {unassigned.map(task=><article key={task.id}><input type="checkbox" aria-label={`${task.title} 선택`} checked={selectedIds.includes(task.id)} disabled={saving||(!selectedIds.includes(task.id)&&selectedIds.length>=20)} onChange={event=>setSelectedIds(previous=>event.target.checked?[...previous,task.id]:previous.filter(id=>id!==task.id))}/><button onClick={()=>open(task)}><strong>{task.title}</strong><small>{sourceLabel(task)} · {task.due_date||"기한 미정"}</small></button></article>)}
        {!unassigned.length&&<p>분류할 업무가 없습니다.</p>}
      </section> : <section className="task-board">
        {COLUMNS.map((column) => {
          const items = visibleTasks.filter((task) =>
            column.statuses.includes(task.status),
          );
          return (
            <article
              className="task-column panel"
              key={column.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) =>
                move(event.dataTransfer.getData("text/plain"), column.id)
              }
            >
              <header>
                <strong>{column.label}</strong>
                <span>{items.length}</span>
              </header>
              <div>
                {items.map((task) => {
                  const due = dueSignal(task);
                  return <button
                    draggable
                    key={task.id}
                    className={due ? `task-${due.tone}` : undefined}
                    onDragStart={(event) =>
                      event.dataTransfer.setData("text/plain", task.id)
                    }
                    onClick={() => open(task)}
                  >
                    <GripVertical size={14} />
                    <span>
                      <strong>{task.title}</strong>
                      <small>
                        {due ? (
                          <b className={`due-badge ${due.tone}`}>{due.label}</b>
                        ) : null}
                        <b
                          className={`source-badge source-${String(task.metadata.source || "direct")}`}
                          title={String(task.metadata.meetingId || "") ? "회의에서 생성된 업무" : undefined}
                        >
                          {sourceLabel(task)}
                        </b>
                        {projectName(task)}
                      </small>
                      <em>
                        <UserRound size={11} /> {assigneeName(task)}{" "}
                        <CalendarDays size={11} />{" "}
                        {task.due_date || "기한 없음"}
                      </em>
                    </span>
                    <i className={`priority-mark priority-${task.priority}`} />
                  </button>;
                })}
                {!items.length ? (
                  <div className="task-empty">이 단계의 업무가 없습니다.</div>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>}
      </WorkspaceLoadState>
      {drawer ? (
        <div
          className="drawer-backdrop"
          onMouseDown={() => !saving && setDrawer(false)}
        >
          <form
            className="record-drawer"
            onSubmit={submit}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="drawer-head">
              <div>
                <span className="eyebrow">업무 상세</span>
                <h2>{editing ? "업무 수정" : "새 업무"}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setDrawer(false)}
              >
                <X size={18} />
              </button>
            </div>
            <label>
              <span>업무명</span>
              <input
                name="title"
                required
                defaultValue={editing?.title ?? ""}
              />
            </label>
            <label>
              <span>상세 설명</span>
              <textarea
                name="description"
                required
                rows={5}
                defaultValue={editing?.description ?? ""}
              />
            </label>
            <label><span>완료 기준</span><textarea name="doneCriteria" rows={3} maxLength={2000} defaultValue={String(editing?.metadata.doneCriteria || editing?.description || "")} placeholder="어떤 결과가 나오면 완료인가요?"/></label>
            <div className="form-grid">
              <label>
                <span>발생 출처</span>
                <select
                  name="source"
                  defaultValue={String(editing?.metadata.source || "direct")}
                >
                  <option value="direct">직접 요청</option>
                  <option value="planning">기획안</option>
                  <option value="meeting">회의</option>
                </select>
              </label>
              <label>
                <span>연결 프로젝트</span>
                <select name="parentId" defaultValue={editing?.parent_id ?? ""}>
                  <option value="">프로젝트 없음</option>
                  {editing?.parent_id && !projects.some(project=>project.id===editing.parent_id) && <option value={editing.parent_id}>{meetings.find(meeting=>meeting.id===editing.parent_id)?.title || "기존 연결 유지"}</option>}
                  {projects.map((project) => (
                    <option value={project.id} key={project.id}>
                      {project.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>담당자</span>
              <select
                name="assigneeId"
                defaultValue={editing?.assignee_id ?? ""}
              >
                <option value="">미지정</option>
                {members.map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.display_name || member.email} ·{" "}
                    {member.team || "팀 없음"}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                <span>상태</span>
                <select
                  name="status"
                  defaultValue={editing?.status ?? "planned"}
                >
                  <option value="planned">할 일</option>
                  <option value="active">진행 중</option>
                  <option value="blocked">막힘</option>
                  <option value="review">검수</option>
                  <option value="done">완료</option>
                </select>
              </label>
              <label>
                <span>우선순위</span>
                <select
                  name="priority"
                  defaultValue={editing?.priority ?? "normal"}
                >
                  <option value="low">낮음</option>
                  <option value="normal">보통</option>
                  <option value="high">높음</option>
                  <option value="urgent">긴급</option>
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label>
                <span>기한</span>
                <input
                  type="date"
                  name="dueDate"
                  defaultValue={editing?.due_date ?? ""}
                />
              </label>
              <label>
                <span>진행률</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  name="progress"
                  defaultValue={editing?.progress ?? 0}
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                <span>브랜드</span>
                <input name="brand" defaultValue={editing?.brand ?? ""} />
              </label>
              <label>
                <span>담당 팀</span>
                <input
                  name="team"
                  defaultValue={editing?.team || profile?.team || ""}
                />
              </label>
            </div>
            <label>
              <span>태그</span>
              <input
                name="tags"
                defaultValue={editing?.tags.join(", ") ?? ""}
              />
            </label>
            <div className="drawer-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDrawer(false)}
              >
                취소
              </button>
              <button className="primary-button" disabled={saving}>
                {saving ? "저장 중…" : "업무 저장"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
