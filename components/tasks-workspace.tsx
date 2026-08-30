"use client";

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
  listRecords,
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
  const [mineOnly, setMineOnly] = useState(false);
  const load = useCallback(async () => {
    if (demo) return;
    try {
      const [taskResult, projectResult, meetingResult, memberResult] = await Promise.all([
        listRecords(accessToken, "task", "limit=200"),
        listRecords(accessToken, "project", "limit=200"),
        listRecords(accessToken, "meeting", "limit=200"),
        listMembers(accessToken),
      ]);
      setTasks(taskResult.records);
      setProjects(projectResult.records);
      setMeetings(meetingResult.records);
      setMembers(memberResult.members.filter((member) => member.is_active));
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "업무를 불러오지 못했습니다.",
      );
    }
  }, [accessToken, demo]);
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
      },
    };
    setSaving(true);
    setError("");
    try {
      if (editing)
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
  const visibleTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (sourceFilter === "all" ||
            String(task.metadata.source || "direct") === sourceFilter) &&
          (!mineOnly || task.assignee_id === profile?.id),
      ),
    [mineOnly, profile?.id, sourceFilter, tasks],
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
          <span className="eyebrow">업무 보드</span>
          <h1>업무 관리</h1>
          <p>프로젝트·담당자·기한과 발생 출처를 함께 관리합니다.</p>
        </div>
        <button className="primary-button" onClick={() => open(null)}>
          <Plus size={16} /> 업무 추가
        </button>
      </header>
      {error ? (
        <div className="inline-alert danger">
          <CircleAlert size={16} /> {error}
        </div>
      ) : null}
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
        <button
          className={mineOnly ? "active" : ""}
          onClick={() => setMineOnly((value) => !value)}
        >
          내 업무
        </button>
        {[
          ["all", "전체 출처"],
          ["meeting", "회의"],
          ["direct", "직접"],
          ["planning", "기획"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={sourceFilter === value ? "active" : ""}
            onClick={() => setSourceFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="task-board">
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
      </section>
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
              <span>완료 기준</span>
              <textarea
                name="description"
                required
                rows={5}
                defaultValue={editing?.description ?? ""}
              />
            </label>
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
