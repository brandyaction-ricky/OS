"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleAlert, Plus, Search, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, archiveRecord, listAllRecordsOfType, listMembers, updateRecord, type OsMember } from "@/lib/api-client";
import { CreateTeamMeeting, TeamMeetingDetail, TeamMeetingReview } from "@/components/team/meeting-actions";
import { CreateTeamTask, EditableTaskDrawer, TeamTaskInbox, moveTeamTask } from "@/components/team/task-actions";
import { TeamDecisionList } from "@/components/team/decision-actions";
import { TeamPrepView } from "@/components/team/prep-actions";
import { LegacyMerge } from "@/components/team/legacy-merge";
import { teamDecisions } from "@/lib/team/decisions";
import { teamBusiness } from "@/lib/team/business";
import { TEAM_BUSINESSES } from "@/lib/team/business";
import { taskSource } from "@/lib/team/source";
import { listTeamRange } from "@/lib/team/client";
import type { TeamAbsence } from "@/lib/team/absence";
import type { Meeting } from "@/lib/knowledge/model";
import { resolveMeetingBusiness } from "@/lib/meeting-business";
import type { OsRecord } from "@/lib/record-types";
import { contentOrigin } from "@/lib/content-origin";
import { useSession } from "@/components/session-provider";
import { WorkspaceLoadState } from "@/components/workspace-load-state";

type Section = "meetings" | "tasks" | "schedule" | "people";
type Data = { meetings: Meeting[]; tasks: OsRecord[]; projects: OsRecord[]; members: OsMember[]; decisions: OsRecord[]; publishes: OsRecord[] };
const EMPTY_DATA: Data = { meetings: [], tasks: [], projects: [], members: [], decisions: [], publishes: [] };
const TITLE: Record<Section, string> = { meetings: "회의·결정", tasks: "업무", schedule: "팀 일정", people: "팀 현황" };
const DESCRIPTION: Record<Section, string> = {
  meetings: "회의 기록에서 결정과 후속 업무를 확인합니다.",
  tasks: "내 업무와 팀 업무를 상태별로 확인합니다.",
  schedule: "회의와 업무 마감을 날짜별로 확인합니다. 휴가는 인사에서 관리합니다.",
  people: "구성원별 업무량과 막힌 일을 살펴봅니다.",
};
const GUIDE: Record<Section, readonly [string, string, string]> = {
  meetings: ["다가오는 회의는 ‘다음 회의 준비’에서 안건을 고릅니다", "회의가 끝나면 녹음·메모로 결정·업무 후보를 뽑습니다", "검수에서 담당·기한을 정해 확정합니다"],
  tasks: ["분류함의 담당 미정 업무를 확인합니다", "팀 보드에서 상태별 업무를 살펴봅니다", "내 업무에서 기한과 막힘을 확인합니다"],
  schedule: ["이번 주 회의·마감·부재를 살펴봅니다", "일정을 누르면 그 일의 업무로 이동합니다", "휴가 신청·승인은 인사 노무 관리에서 합니다"],
  people: ["구성원별 열린 업무를 확인합니다", "막힘과 기한 지남을 먼저 살펴봅니다", "이름을 누르면 해당 구성원의 팀 보드로 이동합니다"],
};
const TASK_COLUMNS = [
  { key: "todo", label: "할 일", statuses: ["backlog", "planned", "todo"] },
  { key: "active", label: "진행 중", statuses: ["active", "doing"] },
  { key: "blocked", label: "막힘", statuses: ["blocked"] },
  { key: "review", label: "검수", statuses: ["review"] },
  { key: "done", label: "완료", statuses: ["done"] },
] as const;
const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

function dateLabel(value: string | Date | null | undefined) {
  if (!value) return "날짜 미정";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "날짜 미정" : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short" }).format(date);
}
function dayKey(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
function monday(date: Date) { return addDays(date, -((date.getDay() + 6) % 7)); }
function workspaceRange(section: Section, week: string | null, month: boolean) {
  const selected = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? new Date(`${week}T12:00:00`) : new Date();
  const start = section === "schedule" ? monday(month ? new Date(selected.getFullYear(), selected.getMonth(), 1) : selected) : addDays(new Date(), -14);
  const end = section === "schedule" ? addDays(start, month ? 42 : 7) : addDays(new Date(), 46);
  return { from: dayKey(start), to: dayKey(end) };
}
function personName(members: OsMember[], id: string | null | undefined) {
  if (!id) return "담당 미정";
  return members.find(member => member.id === id)?.display_name ?? "구성원";
}
function statusLabel(status: string) {
  return ({ planned: "예정", backlog: "할 일", todo: "할 일", active: "진행 중", doing: "진행 중", blocked: "막힘", review: "검수", done: "완료", decided: "확정" } as Record<string, string>)[status] ?? "상태 확인";
}
function statusTone(status: string) {
  if (["done", "decided"].includes(status)) return "approved";
  if (status === "blocked") return "failed";
  if (status === "review") return "review";
  if (["active", "doing"].includes(status)) return "scheduled";
  return "draft";
}
function businessLabel(brand: string) { return teamBusiness(brand)?.label ?? "사업 미지정"; }
function businessTone(brand: string) {
  const key = resolveMeetingBusiness(brand)?.wikiFolderSegment;
  return key === "마이인" ? "myin" : key === "브랜디에듀" ? "edu" : "company";
}
function daysUntil(value: string | null | undefined) {
  const key = dayKey(value);
  if (!key) return null;
  return Math.round((Date.parse(`${key}T12:00:00`) - Date.parse(`${dayKey(new Date())}T12:00:00`)) / 86_400_000);
}
function empty(message: string) { return <div className="empty-state"><span>{message}</span></div>; }
function sectionTabs(label: string, items: Array<{ label: string; href: string; active: boolean; count?: number }>) {
  return <nav className="workspace-tabs" aria-label={label}>{items.map(item => <Link key={item.href} href={item.href} aria-current={item.active ? "page" : undefined}>{item.label}{item.count !== undefined ? <span className="tm-tab-count">{item.count}</span> : null}</Link>)}</nav>;
}

export function TeamWorkspaceV1({ section }: { section: Section }) {
  const params = useSearchParams();
  const { accessToken, demo, profile, loading: sessionLoading } = useSession();
  const [search, setSearch] = useState("");
  const [guideClosed, setGuideClosed] = useState(false);
  // Selection, tabs and client-side filters reuse the loaded workspace.
  const scheduleWeek = section === "schedule" ? params.get("week") : null;
  const scheduleMonth = section === "schedule" && params.get("view") === "month";
  const loadKey = JSON.stringify([accessToken, demo, sessionLoading, profile?.id, profile?.role, profile?.memberKind, profile?.isActive, profile?.team, profile?.personKind, profile?.isSharedAccount, section, scheduleWeek, scheduleMonth]);
  const currentLoadKey = useRef(loadKey); currentLoadKey.current = loadKey;
  const generation = useRef(0);
  const absenceGeneration = useRef(0);
  const [snapshot, setSnapshot] = useState<{ key: string; data: Data } | null>(null);
  const [loadStatus, setLoadStatus] = useState({ key: loadKey, loading: !demo, error: "" });
  const [absenceState, setAbsenceState] = useState<{ key: string; rows: TeamAbsence[]; loading: boolean; error: string }>({ key: loadKey, rows: [], loading: !demo, error: "" });
  // Never render a prior account, permission scope or schedule range while its replacement loads.
  const data = snapshot?.key === loadKey ? snapshot.data : EMPTY_DATA;
  const loading = loadStatus.key === loadKey ? loadStatus.loading : !demo;
  const error = loadStatus.key === loadKey ? loadStatus.error : "";
  const absences = absenceState.key === loadKey ? absenceState.rows : [];
  const absenceError = absenceState.key === loadKey ? absenceState.error : "";
  const absenceLoading = absenceState.key === loadKey ? absenceState.loading : !demo;
  const absenceNotice = absenceError ? "확인 필요" : absenceLoading ? "확인 중" : "";
  const loadAbsences = useCallback(async () => {
    if (loadKey !== currentLoadKey.current) return;
    const request = ++absenceGeneration.current;
    const current = () => request === absenceGeneration.current && loadKey === currentLoadKey.current;
    if (demo || sessionLoading || !accessToken || !profile?.id || profile.isActive === false || (section !== "people" && section !== "schedule")) {
      setAbsenceState({ key: loadKey, rows: [], loading: false, error: "" });
      return;
    }
    setAbsenceState({ key: loadKey, rows: [], loading: true, error: "" });
    const { from, to } = workspaceRange(section, scheduleWeek, scheduleMonth);
    try {
      const result = await apiRequest<{ absences: TeamAbsence[] }>(`/api/v1/hr/absences?from=${from}&to=${to}`, { token: accessToken });
      if (current()) setAbsenceState({ key: loadKey, rows: result.absences, loading: false, error: "" });
    } catch {
      if (current()) setAbsenceState({ key: loadKey, rows: [], loading: false, error: "부재 일정을 확인하지 못했습니다." });
    }
  }, [accessToken, demo, sessionLoading, profile?.id, profile?.isActive, section, scheduleWeek, scheduleMonth, loadKey]);
  const load = useCallback(async () => {
    if (loadKey !== currentLoadKey.current) return;
    const request = ++generation.current;
    const current = () => request === generation.current && loadKey === currentLoadKey.current;
    void loadAbsences();
    if (demo || sessionLoading || !accessToken || !profile?.id || profile.isActive === false) {
      setSnapshot({ key: loadKey, data: EMPTY_DATA });
      setLoadStatus({ key: loadKey, loading: !demo && sessionLoading, error: "" });
      return;
    }
    setLoadStatus({ key: loadKey, loading: true, error: "" });
    try {
      if (section === "meetings") {
        const [result, tasks, members, decisions, projects] = await Promise.all([
          apiRequest<{meetings: Meeting[]}>("/api/v1/team/meetings", { token: accessToken }),
          listAllRecordsOfType(accessToken, "task"), listMembers(accessToken), listAllRecordsOfType(accessToken, "decision"), listAllRecordsOfType(accessToken, "project"),
        ]);
        if (!current()) return;
        setSnapshot({ key: loadKey, data: { meetings: result.meetings, tasks: tasks.filter(task => contentOrigin(task) === "own"), projects, members: members.members.filter(member => member.is_active && !member.is_shared_account && member.member_kind !== "partner"), decisions, publishes: [] } });
      } else {
        const { from, to } = workspaceRange(section, scheduleWeek, scheduleMonth);
        const [tasks, members, meetings, publishes, projects] = await Promise.all([
          section === "schedule" ? listTeamRange(accessToken, "task", from, to) : listAllRecordsOfType(accessToken, "task"),
          section === "people" || section === "tasks" ? listMembers(accessToken).then(result => result.members) : Promise.resolve([]),
          section === "schedule" || section === "tasks" ? apiRequest<{meetings: Meeting[]}>("/api/v1/team/meetings", { token: accessToken }).then(result => result.meetings) : Promise.resolve([]),
          section === "schedule" ? listTeamRange(accessToken, "content_publish", from, to) : Promise.resolve([]),
          section === "tasks" ? listAllRecordsOfType(accessToken, "project") : Promise.resolve([]),
        ]);
        if (!current()) return;
        setSnapshot({ key: loadKey, data: { tasks: tasks.filter(task => contentOrigin(task) === "own"), projects, members: members.filter(member => member.is_active && !member.is_shared_account && member.member_kind !== "partner"), meetings, decisions: [], publishes: publishes.filter(item => contentOrigin(item) === "own") } });
      }
      setLoadStatus({ key: loadKey, loading: false, error: "" });
    } catch (cause) {
      if (!current()) return;
      setSnapshot({ key: loadKey, data: EMPTY_DATA });
      setLoadStatus({ key: loadKey, loading: false, error: cause instanceof Error ? cause.message : "팀 화면을 불러오지 못했습니다." });
    }
  }, [accessToken, demo, sessionLoading, profile?.id, profile?.isActive, section, scheduleWeek, scheduleMonth, loadKey, loadAbsences]);
  useEffect(() => { void load(); const requests = generation, absenceRequests = absenceGeneration; return () => { requests.current++; absenceRequests.current++; }; }, [load]);

  const activeTab = params.get("tab") ?? "records";
  const meetingId = params.get("meeting");
  const selectedMeeting = data.meetings.find(meeting => meeting.id === meetingId);
  const selectedTask = data.tasks.find(task => task.id === params.get("task"));
  const meetingRows = useMemo(() => data.meetings.filter(meeting => !meeting.metadata.migratedTo && meeting.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => (b.starts_at ?? b.updated_at).localeCompare(a.starts_at ?? a.updated_at)), [data.meetings, search]);
  const decisionRows = useMemo(() => teamDecisions(data.decisions, data.meetings), [data.decisions, data.meetings]);
  const tasks = useMemo(() => data.tasks.filter(task => task.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [data.tasks, search]);
  const today = new Date();
  const requestedWeek = params.get("week");
  const weekDate = requestedWeek && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) ? new Date(`${requestedWeek}T12:00:00`) : today;
  const weekStart = monday(Number.isNaN(weekDate.getTime()) ? today : weekDate);
  const view = params.get("view") ?? (section === "tasks" ? "my" : "week");

  return <div className="tm-root">
    <header className="page-header"><div className="page-title-group"><h1 className="page-title" data-ui="page-title">{TITLE[section]}</h1><p>{DESCRIPTION[section]}</p></div><div className="header-actions">
      {section === "meetings" && accessToken && !demo ? <CreateTeamMeeting token={accessToken} projects={data.projects} onChanged={load} /> : null}
      {section === "tasks" && accessToken && !demo ? <CreateTeamTask token={accessToken} members={data.members} projects={data.projects} onChanged={load} /> : null}
      {section === "schedule" ? <><Link className="secondary-button compact" href="/hr/my-leave">휴가 신청</Link><Link className="primary-button compact" href="/organization/meetings"><Plus size={15}/> 회의 잡기</Link></> : null}
    </div></header>
    {!guideClosed ? <section className="guide-strip" aria-label="이 화면에서 할 일"><div className="guide-heading guide-strip-head"><CircleAlert size={16}/><strong className="guide-strip-title">이 화면에서 할 일</strong><span className="guide-strip-next">화면 개편 미리보기</span><button className="icon-button guide-strip-close" type="button" aria-label="안내 닫기" onClick={()=>setGuideClosed(true)}><X size={14}/></button></div><ol className="guide-strip-items">{GUIDE[section].map((step,index)=><li className="guide-item" key={step}><span className="guide-no">{index+1}</span><span>{step}</span></li>)}</ol></section> : null}
    {section === "meetings" ? sectionTabs("회의·결정 보기", [
      { label: "회의 기록", href: "/organization/meetings", active: !["decisions", "prep"].includes(activeTab), count: data.meetings.filter(meeting => meeting.status === "review").length },
      { label: "결정 로그", href: "/organization/meetings?tab=decisions", active: activeTab === "decisions", count: decisionRows.filter(row => row.status === "effective").length },
      { label: "다음 회의 준비", href: "/organization/meetings?tab=prep", active: activeTab === "prep" },
    ]) : null}
    {section === "tasks" ? sectionTabs("업무 화면 탭", [
      { label: "내 업무", href: "/organization/tasks?view=my", active: view === "my" },
      { label: "팀 보드", href: "/organization/tasks?view=board", active: view === "board" },
      { label: "분류함", href: "/organization/tasks?view=inbox", active: view === "inbox", count: data.tasks.filter(task => !task.assignee_id).length },
    ]) : null}
    <WorkspaceLoadState loading={loading} error={error} retry={() => void load()}>
      {(section === "schedule" || section === "people") && absenceError ? <div className="tm-callout" data-tone="warn" role="alert"><CircleAlert size={16}/><div className="tm-callout-body"><strong>{absenceError}</strong><small>회의·업무 정보는 표시됩니다. 부재 여부는 아직 확인되지 않았습니다.</small></div><div className="tm-callout-actions"><button className="secondary-button compact" type="button" onClick={() => void loadAbsences()}>부재 다시 불러오기</button></div></div> : null}
      {(section === "schedule" || section === "people") && absenceLoading ? <p className="tm-muted" role="status">부재 일정을 불러오는 중입니다.</p> : null}
      {section === "meetings" ? <>
        {activeTab !== "prep" && activeTab !== "decisions" ? <label className="tm-search"><Search size={15} /><input aria-label="회의 검색" placeholder="회의 검색" value={search} onChange={event => setSearch(event.target.value)} /></label> : null}
        {selectedMeeting && activeTab !== "decisions" && accessToken ? params.get("step") === "review" && !selectedMeeting.legacy ? <TeamMeetingReview key={`${selectedMeeting.id}:${selectedMeeting.version}`} meeting={selectedMeeting} token={accessToken} userId={profile?.id} admin={profile?.role === "admin"} members={data.members} tasks={data.tasks} onChanged={load} /> : <TeamMeetingDetail key={`${selectedMeeting.id}:${selectedMeeting.version}`} meeting={selectedMeeting} meetings={data.meetings} tasks={data.tasks} token={accessToken} userId={profile?.id} admin={profile?.role === "admin"} members={data.members} projects={data.projects} onChanged={load} /> : activeTab === "decisions" && accessToken ? <TeamDecisionList rows={decisionRows} selectedId={params.get("record")} members={data.members} tasks={data.tasks} projects={data.projects} meetings={data.meetings} userId={profile?.id} admin={profile?.role === "admin"} token={accessToken} onChanged={load} /> : activeTab === "prep" && accessToken ? <TeamPrepView meetings={data.meetings} token={accessToken} onChanged={load} /> : <MeetingList meetings={meetingRows} filter={params.get("f") ?? "all"} records={[...data.tasks,...data.decisions]} token={accessToken} userId={profile?.id} admin={profile?.role === "admin"} onChanged={load} />}
      </> : null}
      {section === "tasks" ? <>
        <label className="tm-search"><Search size={15} /><input aria-label="업무 검색" placeholder="업무 검색" value={search} onChange={event => setSearch(event.target.value)} /></label>
        {view === "board" ? <TaskBoard tasks={tasks} members={data.members} owner={params.get("owner")} token={accessToken} onChanged={load} /> : view === "inbox" && accessToken ? <TeamTaskInbox tasks={tasks.filter(task => !task.assignee_id && !["done", "cancelled"].includes(task.status))} allTasks={tasks} meetings={data.meetings} members={data.members} userId={profile?.id} admin={profile?.role === "admin"} token={accessToken} onChanged={load} /> : <MyTasks tasks={tasks} members={data.members} userId={profile?.id} requested={params.get("mine") === "requested"} token={accessToken} onChanged={load} />}
        {selectedTask && accessToken ? <EditableTaskDrawer key={`${selectedTask.id}:${selectedTask.version}`} task={selectedTask} members={data.members} projects={data.projects} token={accessToken} onChanged={load} /> : null}
      </> : null}
      {section === "schedule" ? <ScheduleView meetings={data.meetings} tasks={data.tasks} publishes={data.publishes} absences={absences} absenceNotice={absenceNotice} weekStart={weekStart} view={view === "month" ? "month" : "week"} /> : null}
      {section === "people" ? <PeopleView members={data.members} tasks={data.tasks} absences={absences} absenceNotice={absenceNotice} /> : null}
    </WorkspaceLoadState>
  </div>;
}

function MeetingList({ meetings, filter, records, token, userId, admin, onChanged }: { meetings: Meeting[]; filter: string; records: OsRecord[]; token: string | null; userId?: string; admin: boolean; onChanged: () => Promise<void> }) {
  const [archiveBusy, setArchiveBusy] = useState(false), [archiveError, setArchiveError] = useState("");
  const blankLegacy = meetings.filter(meeting => meeting.legacy && !meeting.title.trim() && !meeting.description.trim() && !meeting.metadata.summary?.trim() && !meeting.metadata.agenda.trim() && !records.some(record => record.parent_id === meeting.id || record.metadata.meetingId === meeting.id));
  async function archiveBlank(meeting: Meeting) {
    if (!token || !(admin || meeting.owner_id === userId) || !window.confirm("내용 없는 이전 회의 기록을 보관할까요? 기록은 삭제되지 않습니다.")) return;
    setArchiveBusy(true); setArchiveError("");
    try { await archiveRecord(token, meeting.id); await onChanged(); }
    catch (cause) { setArchiveError(cause instanceof Error ? cause.message : "회의를 보관하지 못했습니다."); }
    finally { setArchiveBusy(false); }
  }
  const filters = [
    { key: "all", label: "전체", matches: () => true },
    { key: "review", label: "검수 필요", matches: (meeting: Meeting) => meeting.status === "review" },
    { key: "planned", label: "예정·진행", matches: (meeting: Meeting) => ["planned", "active"].includes(meeting.status) },
    { key: "done", label: "확정", matches: (meeting: Meeting) => meeting.status === "done" },
  ];
  const rows = meetings.filter(meeting => (filters.find(item => item.key === filter) ?? filters[0]).matches(meeting));
  const thisMonday = dayKey(monday(new Date()));
  const nextMonday = dayKey(addDays(monday(new Date()),7));
  const lastMonday = dayKey(addDays(monday(new Date()),-7));
  const groups = [
    { label: "다가오는 회의", matches: (meeting: Meeting) => dayKey(meeting.starts_at) >= nextMonday },
    { label: "이번 주", matches: (meeting: Meeting) => dayKey(meeting.starts_at) >= thisMonday && dayKey(meeting.starts_at) < nextMonday },
    { label: "지난 주", matches: (meeting: Meeting) => dayKey(meeting.starts_at) >= lastMonday && dayKey(meeting.starts_at) < thisMonday },
    { label: "그 이전", matches: (meeting: Meeting) => dayKey(meeting.starts_at) < lastMonday },
  ];
  return <>
    {token ? <LegacyMerge meetings={meetings} records={records} token={token} onChanged={onChanged} /> : null}
    {blankLegacy.length ? <div className="tm-callout" data-tone="warn"><strong>내용 없는 이전 회의 {blankLegacy.length}건</strong><div className="tm-callout-actions">{blankLegacy.map(meeting => <button key={meeting.id} type="button" className="secondary-button compact" disabled={archiveBusy || !(admin || meeting.owner_id === userId)} onClick={() => void archiveBlank(meeting)}>기록 보관</button>)}</div></div> : null}
    {archiveError ? <p className="tm-danger-text" role="alert">{archiveError}</p> : null}
    <div className="tm-toolbar">{filters.map(item => <Link key={item.key} className="tm-chip" aria-current={filter === item.key ? "page" : undefined} href={item.key === "all" ? "/organization/meetings" : `/organization/meetings?f=${item.key}`}>{item.label} <b>{meetings.filter(item.matches).length}</b></Link>)}</div>
    {rows.length ? groups.map(group => { const section = rows.filter(group.matches); return section.length ? <section key={group.label}><h2 className="tm-section-head">{group.label} <span className="tm-count">{section.length}</span></h2><div className="tm-meeting-list">{section.map(meeting => {
      const brand = (meeting as Meeting & { brand?: string }).brand ?? "";
      const candidateDecisions = meeting.metadata.items.filter(item => item.kind === "decision" && item.state !== "discarded");
      const candidateTasks = meeting.metadata.items.filter(item => item.kind === "task" && item.state !== "discarded");
      const decisions = records.filter(record => record.record_type === "decision" && record.status !== "cancelled" && (record.parent_id === meeting.id || record.metadata.meetingId === meeting.id));
      const tasks = records.filter(record => record.record_type === "task" && record.status !== "cancelled" && (record.parent_id === meeting.id || record.metadata.meetingId === meeting.id));
      return <Link className="tm-meeting-row" key={meeting.id} href={`/organization/meetings?meeting=${encodeURIComponent(meeting.id)}`}><div><div className="tm-meeting-title"><span className="status-pill" data-status={statusTone(meeting.status)}>{meeting.status === "review" ? "검수 필요" : statusLabel(meeting.status)}</span>{meeting.title}{meeting.legacy ? <span className="tm-legacy-tag">이전 기록</span> : null}</div><div className="tm-meeting-meta"><span className="tm-biz" data-biz={businessTone(brand)}>{businessLabel(brand)}</span><span>{dateLabel(meeting.starts_at)}</span><span>참석 {meeting.attendees.length}명</span>{meeting.metadata.visibility === "attendees" ? <span>참석자만</span> : null}</div><p className="tm-meeting-summary">{meeting.metadata.summary || meeting.metadata.agenda || "요약이 없습니다."}</p></div><span className="tm-count-pair">{meeting.status === "review" ? <span>후보 <b>{candidateDecisions.length+candidateTasks.length}</b> · 아직 반영 안 됨</span> : meeting.status === "planned" ? <span>안건 <b>{meeting.metadata.agenda.split("\n").filter(Boolean).length}</b></span> : <><span>결정 <b>{decisions.length}</b></span><span>업무 <b>{tasks.length}</b></span></>}</span><span className="tm-row-action">{meeting.status === "review" ? "검수하기" : meeting.status === "planned" ? "안건 준비" : "자세히 보기"} →</span></Link>;
    })}</div></section> : null; }) : empty("조건에 맞는 회의가 없습니다.")}
  </>;
}
function MyTasks({ tasks, members, userId, requested, token, onChanged }: { tasks: OsRecord[]; members: OsMember[]; userId: string | undefined; requested: boolean; token: string | null; onChanged: () => Promise<void> }) {
  const [taskError, setTaskError] = useState("");
  async function toggle(task: OsRecord) {
    if (!token) return;
    setTaskError("");
    try { await updateRecord(token, { id: task.id, expectedVersion: task.version, status: task.status === "done" ? "planned" : "done" }); await onChanged(); }
    catch (cause) { setTaskError(cause instanceof Error ? cause.message : "업무 상태를 바꾸지 못했습니다."); }
  }
  const assigned = tasks.filter(task => task.assignee_id === userId);
  const created = tasks.filter(task => task.created_by === userId && task.metadata.source === "direct");
  const rows = (requested ? created : assigned).slice().sort((a,b)=>(a.due_date??"9999").localeCompare(b.due_date??"9999"));
  const groups = [
    { label: "기한 지남", filter: (task: OsRecord) => (daysUntil(task.due_date) ?? 0) < 0 && task.status !== "done" },
    { label: "3일 이내", filter: (task: OsRecord) => { const days=daysUntil(task.due_date); return days!==null && days>=0 && days<=3 && task.status!=="done"; } },
    { label: "7일 이내", filter: (task: OsRecord) => { const days=daysUntil(task.due_date); return days!==null && days>3 && days<=7 && task.status!=="done"; } },
    { label: "이후 · 기한 없음", filter: (task: OsRecord) => (daysUntil(task.due_date)===null || (daysUntil(task.due_date)??0)>7) && task.status!=="done" },
    { label: "최근 완료", filter: (task: OsRecord) => task.status==="done" && (daysUntil(task.updated_at)??-999)>=-7 },
  ];
  return <><div className="tm-toolbar"><Link className="tm-chip" aria-current={!requested?"page":undefined} href="/organization/tasks?view=my">내가 담당 <b>{assigned.length}</b></Link><Link className="tm-chip" aria-current={requested?"page":undefined} href="/organization/tasks?view=my&mine=requested">내가 요청함 <b>{created.length}</b></Link></div>{taskError ? <p role="alert" className="tm-danger-text">{taskError}</p> : null}{rows.length ? groups.map(group => { const membersOfGroup=rows.filter(group.filter); return membersOfGroup.length ? <section className="panel" key={group.label}><div className="card-head"><strong className="card-title">{group.label}</strong><span className="tm-muted">{membersOfGroup.length}</span></div>{membersOfGroup.map(task => <div className="tm-task-row" key={task.id}><button type="button" className="tm-check" role="checkbox" aria-label={`${task.title} 완료`} aria-checked={task.status === "done"} onClick={() => void toggle(task)}>{task.status==="done"?"✓":""}</button><Link className="tm-task-main" href={`/organization/tasks?view=my${requested?"&mine=requested":""}&task=${encodeURIComponent(task.id)}`}><span className="tm-task-title">{task.title}</span><span className="tm-task-meta"><span className="tm-biz" data-biz={businessTone(task.brand)}>{businessLabel(task.brand)}</span><span>{personName(members,task.assignee_id)}</span></span></Link><span className="status-pill" data-status={statusTone(task.status)}>{statusLabel(task.status)}</span><span className="tm-due" data-state={(daysUntil(task.due_date)??0)<0?"over":"normal"}>{dateLabel(task.due_date)}</span></div>)}</section> : null; }) : empty(requested?"내가 요청한 업무가 없습니다.":"담당 중인 업무가 없습니다.")}</>;
}
function TaskBoard({ tasks, members, owner, token, onChanged }: { tasks: OsRecord[]; members: OsMember[]; owner: string | null; token: string | null; onChanged: () => Promise<void> }) {
  const [business, setBusiness] = useState("all"), [source, setSource] = useState("all"), [layout, setLayout] = useState<"board" | "list">("board");
  const visible = tasks.filter(task => (!owner || task.assignee_id === owner) && (business === "all" || teamBusiness(task.brand)?.key === business) && (source === "all" || taskSource(task) === source));
  const [dropTarget, setDropTarget] = useState<string | null>(null), [moveError, setMoveError] = useState("");
  async function drop(event: React.DragEvent, column: typeof TASK_COLUMNS[number]) {
    event.preventDefault(); setDropTarget(null); setMoveError("");
    const task = tasks.find(row => row.id === event.dataTransfer.getData("text/plain"));
    if (!task || !token) return;
    const reason = column.key === "blocked" ? window.prompt("막힘 사유를 입력해 주세요.") : undefined;
    if (column.key === "blocked" && !reason?.trim()) return;
    try { await moveTeamTask(task, column.key, token, reason ?? undefined); await onChanged(); }
    catch (cause) { setMoveError(cause instanceof Error ? cause.message : "업무 상태를 바꾸지 못했습니다."); }
  }
  return <><div className="tm-toolbar"><span className="tm-muted">사업</span><button className="tm-chip" aria-pressed={business === "all"} onClick={() => setBusiness("all")}>전체</button>{TEAM_BUSINESSES.map(item => <button className="tm-chip" aria-pressed={business === item.key} onClick={() => setBusiness(item.key)} key={item.key}>{item.label}</button>)}<span className="tm-muted">담당</span><Link className="tm-chip" aria-current={!owner ? "page" : undefined} href="/organization/tasks?view=board">전체</Link>{members.map(member => <Link className="tm-chip" aria-current={owner===member.id?"page":undefined} href={`/organization/tasks?view=board&owner=${encodeURIComponent(member.id)}`} key={member.id}>{member.display_name}</Link>)}<select aria-label="업무 출처" value={source} onChange={event => setSource(event.target.value)}><option value="all">전체 출처</option><option value="meeting">회의</option><option value="direct">직접 요청</option><option value="planning">기획안</option><option value="telegram">텔레그램 피드백</option></select><button className="tm-chip" onClick={() => {setBusiness("all");setSource("all");}}>필터 지우기</button><span className="tm-spacer"/><button className="tm-chip" aria-pressed={layout === "board"} onClick={() => setLayout("board")}>보드</button><button className="tm-chip" aria-pressed={layout === "list"} onClick={() => setLayout("list")}>목록</button></div>{moveError ? <p role="alert" className="tm-danger-text">{moveError}</p> : null}{layout === "list" ? <div className="panel tm-table-wrap"><table className="data-table"><thead><tr><th>업무</th><th>상태</th><th>사업</th><th>담당</th><th>기한</th></tr></thead><tbody>{visible.slice().sort((a,b) => TASK_COLUMNS.findIndex(col => col.statuses.includes(a.status as never)) - TASK_COLUMNS.findIndex(col => col.statuses.includes(b.status as never)) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")).map(task => <tr key={task.id}><td className="cell-title"><Link href={`/organization/tasks?view=board&task=${encodeURIComponent(task.id)}`}>{task.title}</Link></td><td>{statusLabel(task.status)}</td><td>{businessLabel(task.brand)}</td><td>{personName(members,task.assignee_id)}</td><td>{dateLabel(task.due_date)}</td></tr>)}</tbody></table></div> : <div className="task-board">{TASK_COLUMNS.map(column => { const rows = visible.filter(task => (column.statuses as readonly string[]).includes(task.status)); return <section className="tm-column" key={column.key} data-drop-target={dropTarget===column.key} onDragOver={event => {event.preventDefault();setDropTarget(column.key);}} onDragLeave={() => setDropTarget(null)} onDrop={event => void drop(event,column)}><header><span className="tm-col-dot" data-status={column.key} />{column.label}<span className="tm-count">{rows.length}</span></header>{rows.map(task => <Link className="tm-task-card" draggable href={`/organization/tasks?view=board${owner?`&owner=${encodeURIComponent(owner)}`:""}&task=${encodeURIComponent(task.id)}`} onDragStart={event => event.dataTransfer.setData("text/plain",task.id)} key={task.id}><span className="tm-task-card-title">{task.title}</span>{task.status === "blocked" && task.metadata.blockedReason ? <small className="tm-danger-text">{String(task.metadata.blockedReason)}</small> : null}<span className="tm-task-card-meta"><span className="tm-biz" data-biz={businessTone(task.brand)}>{businessLabel(task.brand)}</span><span className="tm-avatar" title={personName(members,task.assignee_id)}>{personName(members,task.assignee_id).slice(0,1)}</span></span><span className="tm-due">{dateLabel(task.due_date)}</span></Link>)}</section>; })}</div>}</>;
}
function ScheduleView({ meetings, tasks, publishes, absences, absenceNotice, weekStart, view }: { meetings: Meeting[]; tasks: OsRecord[]; publishes: OsRecord[]; absences: TeamAbsence[]; absenceNotice: string; weekStart: Date; view: "week" | "month" }) {
  const [layers, setLayers] = useState({ meeting: true, due: true, absence: true, publish: true });
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const start = view === "month" ? monday(new Date(weekStart.getFullYear(),weekStart.getMonth(),1)) : weekStart;
  const monthLength = new Date(weekStart.getFullYear(), weekStart.getMonth() + 1, 0).getDate();
  const monthOffset = (new Date(weekStart.getFullYear(), weekStart.getMonth(), 1).getDay() + 6) % 7;
  const days = Array.from({length:view==="month"?Math.ceil((monthOffset + monthLength) / 7) * 7:7},(_,index)=>addDays(start,index));
  const previous = view === "month" ? new Date(weekStart.getFullYear(),weekStart.getMonth()-1,1) : addDays(weekStart,-7);
  const next = view === "month" ? new Date(weekStart.getFullYear(),weekStart.getMonth()+1,1) : addDays(weekStart,7);
  const monthLabel = new Intl.DateTimeFormat("ko-KR", {year:"numeric",month:"long"}).format(weekStart);
  const rangeLabel = view === "month" ? monthLabel : `${dateLabel(weekStart)} ~ ${dateLabel(addDays(weekStart,6))}`;
  const href = (date: Date) => `/organization/schedule?view=${view}&week=${dayKey(date)}`;
  return <><div className="tm-stats"><div className="metric"><div className="metric-label">회의</div><div className="metric-value">{meetings.filter(meeting=>days.some(date=>dayKey(date)===dayKey(meeting.starts_at))).length}</div></div><div className="metric"><div className="metric-label">업무 마감</div><div className="metric-value">{tasks.filter(task=>days.some(date=>dayKey(date)===dayKey(task.due_date))).length}</div></div><div className="metric"><div className="metric-label">부재 인원</div><div className="metric-value">{absenceNotice || new Set(absences.filter(absence=>days.some(date=>dayKey(date)>=absence.start&&dayKey(date)<=absence.end)).map(absence=>absence.name)).size}</div></div><div className="metric"><div className="metric-label">발행</div><div className="metric-value">{publishes.filter(item=>days.some(date=>dayKey(date)===dayKey(item.starts_at))).length}</div></div></div><div className="tm-toolbar"><Link className="secondary-button compact" aria-label="이전 기간" href={href(previous)}><ChevronLeft size={16}/></Link><Link className="secondary-button compact" href={`/organization/schedule?view=${view}`}>오늘</Link><strong className="tm-range">{rangeLabel}</strong><Link className="secondary-button compact" aria-label="다음 기간" href={href(next)}><ChevronRight size={16}/></Link><span className="tm-spacer"/><Link className="tm-chip" aria-current={view==="week"?"page":undefined} href={`/organization/schedule?view=week&week=${dayKey(weekStart)}`}>주</Link><Link className="tm-chip" aria-current={view==="month"?"page":undefined} href={`/organization/schedule?view=month&week=${dayKey(weekStart)}`}>월</Link></div><div className="tm-toolbar">{([{key:"meeting",label:"회의"},{key:"due",label:"업무 마감"},{key:"absence",label:"부재"},{key:"publish",label:"발행"}] as const).map(layer=><button type="button" className="tm-layer" data-kind={layer.key} disabled={layer.key === "absence" && Boolean(absenceNotice)} aria-pressed={layers[layer.key]} key={layer.key} onClick={()=>setLayers(current=>({...current,[layer.key]:!current[layer.key]}))}>{layer.label}</button>)}</div><div className={view==="month"?"tm-month":"tm-week"}>{view==="month"?WEEKDAYS.map(day=><div className="tm-month-head" key={day}>{day}</div>):null}{days.map(date=>{const key=dayKey(date);const dayMeetings=layers.meeting?meetings.filter(meeting=>dayKey(meeting.starts_at)===key):[];const dayTasks=layers.due?tasks.filter(task=>dayKey(task.due_date)===key):[];const dayAbsences=layers.absence?absences.filter(absence=>key>=absence.start&&key<=absence.end):[];const dayPublishes=layers.publish?publishes.filter(item=>dayKey(item.starts_at)===key):[];
    const events = [
      ...dayMeetings.map(meeting=><Link key={`m:${meeting.id}`} className="tm-event" data-kind="meeting" href={`/organization/meetings?meeting=${encodeURIComponent(meeting.id)}`}>{meeting.title}</Link>),
      ...dayTasks.map(task=><Link key={`t:${task.id}`} className="tm-event" data-kind="due" href={`/organization/tasks?task=${encodeURIComponent(task.id)}`}>{task.title}</Link>),
      ...dayAbsences.map((absence,index)=><span key={`a:${absence.name}:${index}`} className="tm-event" data-kind="absence" title="인사에서 관리하는 부재">{absence.name} 부재{absence.part==="am"?" · 오전":absence.part==="pm"?" · 오후":""}</span>),
      ...dayPublishes.map(item=><Link key={`p:${item.id}`} className="tm-event" data-kind="publish" href="/automation/calendar">{item.title}</Link>),
    ];
    const collapsed = view==="month" && expandedDay!==key && events.length>3;
    return <div key={key} className={view==="month"?"tm-month-cell":"tm-day"} data-today={key===dayKey(new Date())} data-outside={view==="month"&&date.getMonth()!==weekStart.getMonth()}><div className="tm-day-head"><b>{date.getDate()}</b>{view==="week"?<span>{WEEKDAYS[(date.getDay()+6)%7]}</span>:null}</div>{collapsed?events.slice(0,3):events}{collapsed?<button type="button" className="tm-more" aria-label={`${key} 일정 ${events.length-3}개 더 보기`} onClick={()=>setExpandedDay(key)}>+{events.length-3}</button>:view==="month"&&expandedDay===key&&events.length>3?<button type="button" className="tm-more" onClick={()=>setExpandedDay(null)}>접기</button>:null}</div>;})}</div><p className="tm-muted">부재는 인사에서 관리하며, 팀 일정에는 이름과 시간대만 표시합니다.</p></>;
}
function PeopleView({ members, tasks, absences, absenceNotice }: { members: OsMember[]; tasks: OsRecord[]; absences: TeamAbsence[]; absenceNotice: string }) {
  const people = [...new Map(members.map(member => [member.id, member])).values()];
  const active = tasks.filter(task => !["done", "archived", "cancelled"].includes(task.status));
  const overdue = active.filter(task => (daysUntil(task.due_date) ?? 0) < 0);
  const dueSoon = active.filter(task => { const days = daysUntil(task.due_date); return days !== null && days >= 0 && days <= 7; });
  const metrics = [
    { label: "진행 중", value: active.length },
    { label: "막힘", value: active.filter(task => task.status === "blocked").length },
    { label: "기한 지남", value: overdue.length },
    { label: "7일 안 마감", value: dueSoon.length },
  ];
  return <>
    <div className="tm-stats">{metrics.map(metric => <div className="metric" key={metric.label}><div className="metric-label">{metric.label}</div><div className="metric-value">{metric.value}</div></div>)}</div>
    <div className="panel tm-table-wrap">{people.length ? <table className="data-table"><thead><tr><th>구성원</th><th>열린 업무</th><th>진행 중</th><th>막힘</th><th>기한 지남</th><th>7일 안 마감</th><th>2주 안 부재</th><th>최근 완료</th></tr></thead><tbody>{people.map(member => {
      const own = active.filter(task => task.assignee_id === member.id);
      const recentDone = tasks.filter(task => task.assignee_id === member.id && task.status === "done" && (daysUntil(task.updated_at) ?? -999) >= -7).length;
      const role = member.role === "admin" ? "관리자" : member.role === "lead" ? "리드" : "팀원";
      const twoWeeks = dayKey(addDays(new Date(),14));
      const absenceCount = absenceNotice || absences.filter(absence => absence.name === member.display_name && absence.start <= twoWeeks && absence.end >= dayKey(new Date())).length;
      return <tr key={member.id}><td className="cell-title"><Link className="tm-person" href={`/organization/tasks?view=board&owner=${encodeURIComponent(member.id)}`}><span className="tm-avatar">{member.display_name.slice(0,1)}</span><span>{member.display_name}<small className="tm-muted"> · {role}</small></span></Link></td><td>{own.length}</td><td>{own.filter(task => ["active", "doing"].includes(task.status)).length}</td><td>{own.filter(task => task.status === "blocked").length}</td><td>{own.filter(task => (daysUntil(task.due_date) ?? 0) < 0).length}</td><td>{own.filter(task => { const days = daysUntil(task.due_date); return days !== null && days >= 0 && days <= 7; }).length}</td><td>{absenceCount}</td><td>{recentDone}</td></tr>;
    })}</tbody></table> : empty("표시할 팀원이 없습니다.")}</div>
    <p className="tm-muted"><Users size={14}/> 계정·권한과 인사 상세 정보는 이 화면에 없습니다. 부재는 인사 데이터에서 읽기 전용으로 표시합니다.</p>
  </>;
}
