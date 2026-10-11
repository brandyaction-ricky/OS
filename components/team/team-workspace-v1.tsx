"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Plus, Search, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, listAllRecordsOfType, listMembers, type OsMember } from "@/lib/api-client";
import { meetingDecisions } from "@/lib/knowledge/meetings";
import type { Meeting } from "@/lib/knowledge/model";
import { resolveMeetingBusiness } from "@/lib/meeting-business";
import type { OsRecord } from "@/lib/record-types";
import { contentOrigin } from "@/lib/content-origin";
import { useSession } from "@/components/session-provider";
import { WorkspaceLoadState } from "@/components/workspace-load-state";

type Section = "meetings" | "tasks" | "schedule" | "people";
type Data = { meetings: Meeting[]; tasks: OsRecord[]; members: OsMember[] };
const EMPTY_DATA: Data = { meetings: [], tasks: [], members: [] };
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
function businessLabel(brand: string) { return resolveMeetingBusiness(brand)?.label ?? (brand || "전체"); }
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
function sectionTabs(items: Array<{ label: string; href: string; active: boolean; count?: number }>) {
  return <nav className="workspace-tabs" aria-label="화면 보기">{items.map(item => <Link key={item.href} href={item.href} aria-current={item.active ? "page" : undefined}>{item.label}{item.count !== undefined ? <span className="tm-tab-count">{item.count}</span> : null}</Link>)}</nav>;
}

export function TeamWorkspaceV1({ section }: { section: Section }) {
  const params = useSearchParams();
  const { accessToken, demo, profile } = useSession();
  const [data, setData] = useState<Data>(EMPTY_DATA);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [guideClosed, setGuideClosed] = useState(false);
  const load = useCallback(async () => {
    if (demo) { setData(EMPTY_DATA); setLoading(false); return; }
    if (!accessToken) return;
    setLoading(true);
    try {
      if (section === "meetings") {
        const result = await apiRequest<{meetings: Meeting[]}>("/api/v1/team/meetings", { token: accessToken });
        setData({ meetings: result.meetings, tasks: [], members: [] });
      } else {
        const [tasks, members, meetings] = await Promise.all([
          listAllRecordsOfType(accessToken, "task"),
          section === "people" || section === "tasks" ? listMembers(accessToken).then(result => result.members) : Promise.resolve([]),
          section === "schedule" ? apiRequest<{meetings: Meeting[]}>("/api/v1/team/meetings", { token: accessToken }).then(result => result.meetings) : Promise.resolve([]),
        ]);
        setData({ tasks: tasks.filter(task => contentOrigin(task) === "own"), members: members.filter(member => member.is_active && !member.is_shared_account), meetings });
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "팀 화면을 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, [accessToken, demo, section]);
  useEffect(() => { void load(); }, [load]);

  const activeTab = params.get("tab") ?? "records";
  const meetingId = params.get("meeting");
  const selectedMeeting = data.meetings.find(meeting => meeting.id === meetingId);
  const selectedTask = data.tasks.find(task => task.id === params.get("task"));
  const meetingRows = useMemo(() => data.meetings.filter(meeting => meeting.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => (b.starts_at ?? b.updated_at).localeCompare(a.starts_at ?? a.updated_at)), [data.meetings, search]);
  const decisionRows = useMemo(() => meetingDecisions(data.meetings).filter(row => row.item.text.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [data.meetings, search]);
  const tasks = useMemo(() => data.tasks.filter(task => task.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [data.tasks, search]);
  const today = new Date();
  const requestedWeek = params.get("week");
  const weekDate = requestedWeek && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) ? new Date(`${requestedWeek}T12:00:00`) : today;
  const weekStart = monday(Number.isNaN(weekDate.getTime()) ? today : weekDate);
  const view = params.get("view") ?? (section === "tasks" ? "my" : "week");

  return <div className="tm-root">
    <header className="page-header"><div className="page-title-group"><h1 className="page-title" data-ui="page-title">{TITLE[section]}</h1><p>{DESCRIPTION[section]}</p></div><div className="header-actions">
      {section === "meetings" ? <button className="primary-button compact" disabled title="기능 구현 단계에서 제공"><Plus size={15} /> 회의 기록</button> : null}
      {section === "tasks" ? <button className="primary-button compact" disabled title="기능 구현 단계에서 제공"><Plus size={15} /> 업무 추가</button> : null}
      {section === "schedule" ? <><Link className="secondary-button compact" href="/hr/my-leave">휴가 신청</Link><button className="primary-button compact" disabled title="기능 구현 단계에서 제공"><Plus size={15}/> 회의 잡기</button></> : null}
    </div></header>
    {!guideClosed ? <section className="guide-strip" aria-label="이 화면에서 할 일"><div className="guide-heading guide-strip-head"><CircleAlert size={16}/><strong className="guide-strip-title">이 화면에서 할 일</strong><span className="guide-strip-next">화면 개편 미리보기</span><button className="icon-button guide-strip-close" type="button" aria-label="안내 닫기" onClick={()=>setGuideClosed(true)}><X size={14}/></button></div><ol className="guide-strip-items">{GUIDE[section].map((step,index)=><li className="guide-item" key={step}><span className="guide-no">{index+1}</span><span>{step}</span></li>)}</ol></section> : null}
    {section === "meetings" ? sectionTabs([
      { label: "회의 기록", href: "/organization/meetings", active: !["decisions", "prep"].includes(activeTab), count: data.meetings.filter(meeting => meeting.status === "review").length },
      { label: "결정 로그", href: "/organization/meetings?tab=decisions", active: activeTab === "decisions", count: decisionRows.length },
      { label: "다음 회의 준비", href: "/organization/meetings?tab=prep", active: activeTab === "prep" },
    ]) : null}
    {section === "tasks" ? sectionTabs([
      { label: "내 업무", href: "/organization/tasks?view=my", active: view === "my" },
      { label: "팀 보드", href: "/organization/tasks?view=board", active: view === "board" },
      { label: "분류함", href: "/organization/tasks?view=inbox", active: view === "inbox", count: data.tasks.filter(task => !task.assignee_id).length },
    ]) : null}
    <WorkspaceLoadState loading={loading} error={error} retry={() => void load()}>
      {section === "meetings" ? <>
        {activeTab !== "prep" ? <label className="tm-search"><Search size={15} /><input aria-label={activeTab === "decisions" ? "결정 검색" : "회의 검색"} placeholder={activeTab === "decisions" ? "결정 검색" : "회의 검색"} value={search} onChange={event => setSearch(event.target.value)} /></label> : null}
        {selectedMeeting && activeTab !== "decisions" ? params.get("step") === "review" ? <MeetingReview meeting={selectedMeeting} /> : <>{selectedMeeting.status === "review" ? <Link className="secondary-button compact" href={`/organization/meetings?meeting=${encodeURIComponent(selectedMeeting.id)}&step=review`}>검수하기</Link> : null}<MeetingDetail meeting={selectedMeeting} /></> : activeTab === "decisions" ? <DecisionList rows={decisionRows} selectedId={params.get("record")} /> : activeTab === "prep" ? <PrepView meetings={data.meetings} /> : <MeetingList meetings={meetingRows} filter={params.get("f") ?? "all"} />}
      </> : null}
      {section === "tasks" ? <>
        <label className="tm-search"><Search size={15} /><input aria-label="업무 검색" placeholder="업무 검색" value={search} onChange={event => setSearch(event.target.value)} /></label>
        {view === "board" ? <TaskBoard tasks={tasks} members={data.members} owner={params.get("owner")} /> : view === "inbox" ? <TaskInbox tasks={tasks.filter(task => !task.assignee_id && task.status !== "done")} /> : <MyTasks tasks={tasks} members={data.members} userId={profile?.id} requested={params.get("mine") === "requested"} />}
        {selectedTask ? <TaskDrawer task={selectedTask} members={data.members} /> : null}
      </> : null}
      {section === "schedule" ? <ScheduleView meetings={data.meetings} tasks={data.tasks} weekStart={weekStart} view={view === "month" ? "month" : "week"} /> : null}
      {section === "people" ? <PeopleView members={data.members} tasks={data.tasks} /> : null}
    </WorkspaceLoadState>
  </div>;
}

function MeetingList({ meetings, filter }: { meetings: Meeting[]; filter: string }) {
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
  const duplicateKeys = new Map<string,number>();
  for (const meeting of meetings.filter(item => item.legacy)) {
    const key = `${dayKey(meeting.starts_at)}:${meeting.title.trim().toLocaleLowerCase()}`;
    duplicateKeys.set(key,(duplicateKeys.get(key)??0)+1);
  }
  const duplicates = [...duplicateKeys.values()].filter(count=>count>1).length;
  return <>
    {duplicates ? <div className="tm-callout" data-tone="warn"><CircleAlert size={16}/><div className="tm-callout-body"><strong>중복 가능 회의 {duplicates}쌍</strong><small>병합은 담당자가 두 기록을 비교한 뒤 실행합니다.</small></div><div className="tm-callout-actions"><button type="button" className="secondary-button compact" disabled title="기능 구현 단계에서 제공">비교 후 병합</button></div></div> : null}
    <div className="tm-toolbar">{filters.map(item => <Link key={item.key} className="tm-chip" aria-current={filter === item.key ? "page" : undefined} href={item.key === "all" ? "/organization/meetings" : `/organization/meetings?f=${item.key}`}>{item.label} <b>{meetings.filter(item.matches).length}</b></Link>)}</div>
    {rows.length ? groups.map(group => { const section = rows.filter(group.matches); return section.length ? <section key={group.label}><h2 className="tm-section-head">{group.label} <span className="tm-count">{section.length}</span></h2><div className="tm-meeting-list">{section.map(meeting => {
      const brand = (meeting as Meeting & { brand?: string }).brand ?? "";
      const decisions = meeting.metadata.items.filter(item => item.kind === "decision" && item.state !== "discarded");
      const tasks = meeting.metadata.items.filter(item => item.kind === "task" && item.state !== "discarded");
      return <Link className="tm-meeting-row" key={meeting.id} href={`/organization/meetings?meeting=${encodeURIComponent(meeting.id)}`}><div><div className="tm-meeting-title"><span className="status-pill" data-status={statusTone(meeting.status)}>{meeting.status === "review" ? "검수 필요" : statusLabel(meeting.status)}</span>{meeting.title}{meeting.legacy ? <span className="tm-legacy-tag">이전 기록</span> : null}</div><div className="tm-meeting-meta"><span className="tm-biz" data-biz={businessTone(brand)}>{businessLabel(brand)}</span><span>{dateLabel(meeting.starts_at)}</span>{meeting.metadata.visibility === "attendees" ? <span>참석자만</span> : null}</div><p className="tm-meeting-summary">{meeting.metadata.summary || meeting.metadata.agenda || "요약이 없습니다."}</p></div><span className="tm-count-pair">{meeting.status === "review" ? <span>후보 <b>{decisions.length+tasks.length}</b> · 아직 반영 안 됨</span> : <><span>결정 <b>{decisions.length}</b></span><span>업무 <b>{tasks.length}</b></span></>}</span><span className="tm-row-action">{meeting.status === "review" ? "검수하기" : meeting.status === "planned" ? "안건 준비" : "자세히 보기"} →</span></Link>;
    })}</div></section> : null; }) : empty("조건에 맞는 회의가 없습니다.")}
  </>;
}
function MeetingDetail({ meeting }: { meeting: Meeting }) {
  const params = useSearchParams();
  const tab = params.get("t") ?? "sum";
  const items = meeting.metadata.items.filter(item => item.state !== "discarded");
  const base = `/organization/meetings?meeting=${encodeURIComponent(meeting.id)}`;
  return <><Link className="tm-back" href="/organization/meetings">← 회의 기록</Link><div className="tm-detail-head"><div className="tm-grow"><h2 className="tm-detail-title">{meeting.title}</h2><div className="tm-meeting-meta"><span>{dateLabel(meeting.starts_at)}</span><span className="status-pill" data-status={statusTone(meeting.status)}>{statusLabel(meeting.status)}</span></div></div></div>{sectionTabs([{label:"요약",href:base,active:tab==="sum"},{label:"결정",href:`${base}&t=dec`,active:tab==="dec",count:items.filter(item=>item.kind==="decision").length},{label:"업무",href:`${base}&t=task`,active:tab==="task",count:items.filter(item=>item.kind==="task").length},{label:"원문",href:`${base}&t=raw`,active:tab==="raw"}])}<div className="tm-detail-grid"><section className="panel panel-pad"><h3 className="card-title">{tab === "sum" ? "회의 요약" : tab === "raw" ? "회의 원문" : tab === "dec" ? "결정" : "후속 업무"}</h3>{tab === "sum" || tab === "raw" ? <p className="body-text" style={{ whiteSpace: "pre-wrap" }}>{tab === "sum" ? meeting.metadata.summary || "요약이 없습니다." : meeting.description || "원문이 없습니다."}</p> : items.filter(item => item.kind === (tab === "dec" ? "decision" : "task")).length ? <ul className="tm-bullets">{items.filter(item => item.kind === (tab === "dec" ? "decision" : "task")).map(item => <li key={item.id}>{item.text}</li>)}</ul> : empty("등록된 항목이 없습니다.")}</section><aside className="panel tm-side"><div className="tm-side-section"><h3>회의 정보</h3><dl className="tm-kv"><dt>공유</dt><dd>{meeting.metadata.visibility === "team" ? "팀 공유" : "참석자"}</dd><dt>상태</dt><dd>{statusLabel(meeting.status)}</dd><dt>수정</dt><dd>{dateLabel(meeting.updated_at)}</dd></dl></div><div className="tm-side-section"><h3>안건</h3><p className="body-text">{meeting.metadata.agenda || "안건이 없습니다."}</p></div></aside></div></>;
}
function MeetingReview({ meeting }: { meeting: Meeting }) {
  const rows = meeting.metadata.items.filter(item => item.state !== "discarded");
  const counts = { decisions: rows.filter(item => item.kind === "decision").length, tasks: rows.filter(item => item.kind === "task").length };
  return <><Link className="tm-back" href={`/organization/meetings?meeting=${encodeURIComponent(meeting.id)}`}>← 회의 상세</Link><h2 className="tm-detail-title">추출 검수 · {meeting.title}</h2><div className="tm-stepper" aria-label="회의 처리 단계">{["원문", "AI 요약", "추출 검수", "확정"].map((label,index)=><span className="tm-step" data-state={index<2?"done":index===2?"now":"next"} key={label}><span className="tm-step-no">{index<2?"✓":index+1}</span>{label}{index<3?<span className="tm-step-line"/>:null}</span>)}</div><div className="tm-detail-grid"><section className="tm-review-list">{rows.length ? rows.map(item=><article className="tm-review-item" data-kind={item.kind} key={item.id}><div className="tm-review-head"><span className="status-pill" data-status={item.kind === "decision" ? "review" : "draft"}>{item.kind === "decision" ? "결정" : "업무"}</span><span className="tm-muted">{item.state === "pending" ? "검수 대기" : "확인됨"}</span></div><p>{item.text}</p>{item.kind === "task" ? <div className="tm-review-fields"><span>담당 {item.ownerId ? "지정됨" : "미정"}</span><span>기한 {dateLabel(item.dueOn)}</span></div> : null}</article>) : empty("검수할 후보가 없습니다.")}</section><aside className="panel tm-side"><div className="tm-side-section"><h3>원문 요약</h3><p className="body-text">{meeting.metadata.summary || "요약이 없습니다."}</p></div><div className="tm-side-section"><h3>분류 기준</h3><p className="body-text">결정은 확정할 내용, 업무는 실행할 일을 뜻합니다.</p></div></aside></div><div className="tm-sticky-bar"><div className="tm-sticky-summary"><span>결정 <b>{counts.decisions}</b> → 결정 로그</span><span>업무 <b>{counts.tasks}</b> → 팀 보드</span></div><button type="button" className="primary-button compact" disabled title="기능 구현 단계에서 제공">확정하고 반영</button></div></>;
}
function DecisionList({ rows, selectedId }: { rows: ReturnType<typeof meetingDecisions>; selectedId: string | null }) {
  const selected = rows.find(row => row.item.id === selectedId);
  return <><div className="tm-callout" data-tone="info"><CircleAlert size={16}/><div className="tm-callout-body">결정은 ‘무엇을 정했나’만 남깁니다. 확인 전 내용은 원래 회의에서 검수합니다.</div></div><div className="panel tm-table-wrap">{rows.length ? <table className="data-table"><thead><tr><th>결정</th><th>상태</th><th>정한 회의</th><th>날짜</th></tr></thead><tbody>{rows.map(({ meeting, item, confirmed }) => <tr key={`${meeting.id}:${item.id}`}><td className="cell-title"><Link href={`/organization/meetings?tab=decisions&record=${encodeURIComponent(item.id)}`}>{item.text}</Link></td><td><span className="status-pill" data-status={confirmed ? "approved" : "review"}>{confirmed ? "유효" : "검수 대기"}</span></td><td><Link href={`/organization/meetings?meeting=${encodeURIComponent(meeting.id)}&t=dec`}>{meeting.title}</Link></td><td>{dateLabel(item.confirmedAt ?? meeting.starts_at)}</td></tr>)}</tbody></table> : empty("표시할 결정이 없습니다.")}</div>{selected ? <div className="drawer-backdrop"><aside className="record-drawer tm-drawer" role="dialog" aria-modal="true" aria-label="결정 상세"><div className="drawer-head"><h2>결정 상세</h2><Link className="secondary-button compact" href="/organization/meetings?tab=decisions">닫기</Link></div><p className="tm-drawer-title">{selected.item.text}</p><dl className="tm-kv"><dt>상태</dt><dd>{selected.confirmed?"유효":"검수 대기"}</dd><dt>정한 회의</dt><dd><Link href={`/organization/meetings?meeting=${encodeURIComponent(selected.meeting.id)}&t=dec`}>{selected.meeting.title}</Link></dd><dt>날짜</dt><dd>{dateLabel(selected.item.confirmedAt ?? selected.meeting.starts_at)}</dd></dl><p className="tm-muted">변경 기록과 실행 업무 연결은 다음 단계에서 제공됩니다.</p></aside></div> : null}</>;
}
function PrepView({ meetings }: { meetings: Meeting[] }) {
  const upcoming = meetings.filter(meeting => meeting.status === "planned" || meeting.status === "active").sort((a,b)=>(a.starts_at??"").localeCompare(b.starts_at??""));
  const pending = meetingDecisions(meetings).filter(row => !row.confirmed);
  return <><div className="tm-callout" data-tone="info"><CalendarDays size={16} /><div className="tm-callout-body"><strong>다음 회의 준비</strong><small>예정된 회의와 미확정 결정을 확인합니다. 자료 생성 기능은 다음 단계에서 연결됩니다.</small></div></div><section className="panel tm-prep-section"><div className="card-head"><strong className="card-title">예정된 회의</strong><span className="tm-count">{upcoming.length}</span></div>{upcoming.length ? upcoming.map(meeting => <div className="tm-prep-row" key={meeting.id}><span className="tm-grow"><Link href={`/organization/meetings?meeting=${encodeURIComponent(meeting.id)}`}>{meeting.title}</Link></span><span className="tm-muted">{dateLabel(meeting.starts_at)}</span></div>) : empty("예정된 회의가 없습니다.")}</section><section className="panel tm-prep-section"><div className="card-head"><strong className="card-title">검수가 남은 결정</strong><span className="tm-count">{pending.length}</span></div>{pending.length ? pending.map(({meeting,item}) => <div className="tm-prep-row" key={`${meeting.id}:${item.id}`}><span className="tm-grow">{item.text}</span><Link href={`/organization/meetings?meeting=${encodeURIComponent(meeting.id)}&t=dec`}>회의 보기</Link></div>) : empty("검수가 남은 결정이 없습니다.")}</section></>;
}
function MyTasks({ tasks, members, userId, requested }: { tasks: OsRecord[]; members: OsMember[]; userId: string | undefined; requested: boolean }) {
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
  return <><div className="tm-toolbar"><Link className="tm-chip" aria-current={!requested?"page":undefined} href="/organization/tasks?view=my">내가 담당 <b>{assigned.length}</b></Link><Link className="tm-chip" aria-current={requested?"page":undefined} href="/organization/tasks?view=my&mine=requested">내가 요청함 <b>{created.length}</b></Link></div>{rows.length ? groups.map(group => { const membersOfGroup=rows.filter(group.filter); return membersOfGroup.length ? <section className="panel" key={group.label}><div className="card-head"><strong className="card-title">{group.label}</strong><span className="tm-muted">{membersOfGroup.length}</span></div>{membersOfGroup.map(task => <Link className="tm-task-row" href={`/organization/tasks?view=my${requested?"&mine=requested":""}&task=${encodeURIComponent(task.id)}`} key={task.id}><span className="tm-check" aria-hidden="true">{task.status==="done"?"✓":""}</span><span className="tm-task-main"><span className="tm-task-title">{task.title}</span><span className="tm-task-meta"><span className="tm-biz" data-biz={businessTone(task.brand)}>{businessLabel(task.brand)}</span><span>{personName(members,task.assignee_id)}</span></span></span><span className="status-pill" data-status={statusTone(task.status)}>{statusLabel(task.status)}</span><span className="tm-due" data-state={(daysUntil(task.due_date)??0)<0?"over":"normal"}>{dateLabel(task.due_date)}</span></Link>)}</section> : null; }) : empty(requested?"내가 요청한 업무가 없습니다.":"담당 중인 업무가 없습니다.")}</>;
}
function TaskBoard({ tasks, members, owner }: { tasks: OsRecord[]; members: OsMember[]; owner: string | null }) {
  const visible = owner ? tasks.filter(task => task.assignee_id === owner) : tasks;
  return <><div className="tm-toolbar"><span className="tm-muted">담당</span><Link className="tm-chip" aria-current={!owner ? "page" : undefined} href="/organization/tasks?view=board">전체</Link>{members.map(member => <Link className="tm-chip" aria-current={owner===member.id?"page":undefined} href={`/organization/tasks?view=board&owner=${encodeURIComponent(member.id)}`} key={member.id}>{member.display_name}</Link>)}</div><div className="task-board">{TASK_COLUMNS.map(column => { const rows = visible.filter(task => (column.statuses as readonly string[]).includes(task.status)); return <section className="tm-column" key={column.key}><header><span className="tm-col-dot" data-status={column.key} />{column.label}<span className="tm-count">{rows.length}</span></header>{rows.map(task => <Link className="tm-task-card" href={`/organization/tasks?view=board${owner?`&owner=${encodeURIComponent(owner)}`:""}&task=${encodeURIComponent(task.id)}`} key={task.id}><span className="tm-task-card-title">{task.title}</span><span className="tm-task-card-meta"><span className="tm-biz" data-biz={businessTone(task.brand)}>{businessLabel(task.brand)}</span><span className="tm-avatar" title={personName(members,task.assignee_id)}>{personName(members,task.assignee_id).slice(0,1)}</span></span><span className="tm-due">{dateLabel(task.due_date)}</span></Link>)}</section>; })}</div></>;
}
function TaskInbox({ tasks }: { tasks: OsRecord[] }) {
  return <section className="panel"><div className="tm-inbox-group-head">담당 미정 업무 <span className="tm-count">{tasks.length}</span></div>{tasks.length ? tasks.map(task => <div className="tm-inbox-row" key={task.id}><div className="tm-task-main"><Link href={`/organization/tasks?view=inbox&task=${encodeURIComponent(task.id)}`}>{task.title}</Link><div className="tm-task-meta"><span className="tm-biz" data-biz={businessTone(task.brand)}>{businessLabel(task.brand)}</span><span>{dateLabel(task.due_date)}</span></div></div><span className="status-pill" data-status={statusTone(task.status)}>{statusLabel(task.status)}</span></div>) : empty("분류할 업무가 없습니다.")}</section>;
}
function TaskDrawer({ task, members }: { task: OsRecord; members: OsMember[] }) {
  const params = useSearchParams();
  const next = new URLSearchParams(params.toString()); next.delete("task");
  return <div className="drawer-backdrop"><aside className="record-drawer tm-drawer" aria-label="업무 상세" role="dialog" aria-modal="true"><div className="drawer-head"><h2>{task.title}</h2><Link className="secondary-button compact" href={`/organization/tasks?${next}`}>닫기</Link></div><dl className="tm-kv"><dt>상태</dt><dd>{statusLabel(task.status)}</dd><dt>담당</dt><dd>{personName(members,task.assignee_id)}</dd><dt>마감</dt><dd>{dateLabel(task.due_date)}</dd><dt>사업</dt><dd>{businessLabel(task.brand)}</dd></dl><section className="tm-block"><h3>업무 내용</h3><p style={{ whiteSpace:"pre-wrap" }}>{task.description || "내용이 없습니다."}</p></section><p className="tm-muted">수정 기능은 다음 단계에서 연결됩니다.</p></aside></div>;
}
function ScheduleView({ meetings, tasks, weekStart, view }: { meetings: Meeting[]; tasks: OsRecord[]; weekStart: Date; view: "week" | "month" }) {
  const [layers, setLayers] = useState({ meeting: true, due: true, absence: true, publish: true });
  const start = view === "month" ? monday(new Date(weekStart.getFullYear(),weekStart.getMonth(),1)) : weekStart;
  const monthLength = new Date(weekStart.getFullYear(), weekStart.getMonth() + 1, 0).getDate();
  const monthOffset = (new Date(weekStart.getFullYear(), weekStart.getMonth(), 1).getDay() + 6) % 7;
  const days = Array.from({length:view==="month"?Math.ceil((monthOffset + monthLength) / 7) * 7:7},(_,index)=>addDays(start,index));
  const previous = view === "month" ? new Date(weekStart.getFullYear(),weekStart.getMonth()-1,1) : addDays(weekStart,-7);
  const next = view === "month" ? new Date(weekStart.getFullYear(),weekStart.getMonth()+1,1) : addDays(weekStart,7);
  const monthLabel = new Intl.DateTimeFormat("ko-KR", {year:"numeric",month:"long"}).format(weekStart);
  const rangeLabel = view === "month" ? monthLabel : `${dateLabel(weekStart)} ~ ${dateLabel(addDays(weekStart,6))}`;
  const href = (date: Date) => `/organization/schedule?view=${view}&week=${dayKey(date)}`;
  return <><div className="tm-stats"><div className="metric"><div className="metric-label">회의</div><div className="metric-value">{meetings.filter(meeting=>days.some(date=>dayKey(date)===dayKey(meeting.starts_at))).length}</div></div><div className="metric"><div className="metric-label">업무 마감</div><div className="metric-value">{tasks.filter(task=>days.some(date=>dayKey(date)===dayKey(task.due_date))).length}</div></div><div className="metric"><div className="metric-label">부재 인원</div><div className="metric-value">—</div></div><div className="metric"><div className="metric-label">발행</div><div className="metric-value">—</div></div></div><div className="tm-toolbar"><Link className="secondary-button compact" aria-label="이전 기간" href={href(previous)}><ChevronLeft size={16}/></Link><Link className="secondary-button compact" href={`/organization/schedule?view=${view}`}>오늘</Link><strong className="tm-range">{rangeLabel}</strong><Link className="secondary-button compact" aria-label="다음 기간" href={href(next)}><ChevronRight size={16}/></Link><span className="tm-spacer"/><Link className="tm-chip" aria-current={view==="week"?"page":undefined} href={`/organization/schedule?view=week&week=${dayKey(weekStart)}`}>주</Link><Link className="tm-chip" aria-current={view==="month"?"page":undefined} href={`/organization/schedule?view=month&week=${dayKey(weekStart)}`}>월</Link></div><div className="tm-toolbar">{([{key:"meeting",label:"회의"},{key:"due",label:"업무 마감"},{key:"absence",label:"부재"},{key:"publish",label:"발행"}] as const).map(layer=><button type="button" className="tm-layer" data-kind={layer.key} aria-pressed={layers[layer.key]} key={layer.key} onClick={()=>setLayers(current=>({...current,[layer.key]:!current[layer.key]}))}>{layer.label}</button>)}</div><div className={view==="month"?"tm-month":"tm-week"}>{view==="month"?WEEKDAYS.map(day=><div className="tm-month-head" key={day}>{day}</div>):null}{days.map(date=>{const key=dayKey(date);const dayMeetings=layers.meeting?meetings.filter(meeting=>dayKey(meeting.starts_at)===key):[];const dayTasks=layers.due?tasks.filter(task=>dayKey(task.due_date)===key):[];return <div key={key} className={view==="month"?"tm-month-cell":"tm-day"} data-today={key===dayKey(new Date())} data-outside={view==="month"&&date.getMonth()!==weekStart.getMonth()}><div className="tm-day-head"><b>{date.getDate()}</b>{view==="week"?<span>{WEEKDAYS[(date.getDay()+6)%7]}</span>:null}</div>{dayMeetings.map(meeting=><Link key={meeting.id} className="tm-event" data-kind="meeting" href={`/organization/meetings?meeting=${encodeURIComponent(meeting.id)}`}>{meeting.title}</Link>)}{dayTasks.map(task=><Link key={task.id} className="tm-event" data-kind="due" href={`/organization/tasks?task=${encodeURIComponent(task.id)}`}>{task.title}</Link>)}</div>;})}</div><p className="tm-muted">부재 정보는 인사 데이터 연결 후 읽기 전용으로 표시됩니다.</p></>;
}
function PeopleView({ members, tasks }: { members: OsMember[]; tasks: OsRecord[] }) {
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
      return <tr key={member.id}><td className="cell-title"><Link className="tm-person" href={`/organization/tasks?view=board&owner=${encodeURIComponent(member.id)}`}><span className="tm-avatar">{member.display_name.slice(0,1)}</span><span>{member.display_name}<small className="tm-muted"> · {role}</small></span></Link></td><td>{own.length}</td><td>{own.filter(task => ["active", "doing"].includes(task.status)).length}</td><td>{own.filter(task => task.status === "blocked").length}</td><td>{own.filter(task => (daysUntil(task.due_date) ?? 0) < 0).length}</td><td>{own.filter(task => { const days = daysUntil(task.due_date); return days !== null && days >= 0 && days <= 7; }).length}</td><td>—</td><td>{recentDone}</td></tr>;
    })}</tbody></table> : empty("표시할 팀원이 없습니다.")}</div>
    <p className="tm-muted"><Users size={14}/> 계정·권한과 인사 정보는 이 화면에 없습니다. 부재는 인사 데이터 연결 후 표시됩니다.</p>
  </>;
}
