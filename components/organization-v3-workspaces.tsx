"use client";
import { generationJobLabel } from "@/lib/content-generation-mode";
import { sampleSummary } from "@/lib/channel-metrics";
import { useRecordDeepLink } from "./use-record-deep-link";

import { PageTitle } from "./page-title";

import {
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ExternalLink,
  Plane,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  createRecord,
  getHealth,
  listAllRecords,
  listMembers,
  listRecords,
  updateRecord,
  type OsMember,
} from "@/lib/api-client";
import {
  BRANDYACTION_ROSTER,
  memberMatchesRoster,
} from "@/lib/company-roster";
import { safeWebUrl } from "@/lib/development-handoff";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

function monday(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - ((value.getDay() + 6) % 7));
  return value;
}
function dateKey(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}
function meta(record: OsRecord, key: string) {
  return record.metadata[key];
}

export function WeeklyScheduleWorkspace() {
  const { accessToken, demo } = useSession();
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!demo)
      listAllRecords(accessToken, "limit=500")
        .then((result) => setRecords(result.records))
        .catch((reason) => setError(reason.message));
  }, [accessToken, demo]);
  const start = monday();
  const startTime = start.getTime();
  const endTime = startTime + 7 * 86_400_000;
  const events = useMemo(
    () =>
      records
        .flatMap((record) => {
          const source =
            record.record_type === "task"
              ? record.due_date
              : record.record_type === "contract"
                ? record.due_date
                : record.starts_at;
          const at = source ? new Date(source) : null;
          if (!at || at.getTime() < startTime || at.getTime() >= endTime)
            return [];
          const type = (
            {
              meeting: "회의",
              leave_request: "휴가",
              task: "업무 마감",
              content_publish: "발행",
              contract: "계약 만료",
            } as Record<string, string>
          )[record.record_type];
          return type ? [{ record, type, at }] : [];
        })
        .sort((a, b) => a.at.getTime() - b.at.getTime()),
    [endTime, records, startTime],
  );
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    return day;
  });
  const away = events.filter(
    (event) => event.type === "휴가" && event.record.status === "approved",
  );
  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <PageTitle />
          <p>회의·휴가·업무 마감·발행·계약 만료를 한곳에서 확인합니다.</p>
        </div>
      </header>
      {error ? (
        <div className="inline-alert danger">
          <CircleAlert size={16} />
          {error}
        </div>
      ) : null}
      <section className="metric-grid compact-metrics">
        <div className="metric-card">
          <div className="metric-top">
            <span>회의</span>
            <CalendarDays size={16} />
          </div>
          <div className="metric-value">
            {events.filter((e) => e.type === "회의").length}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>자리 비움</span>
            <Plane size={16} />
          </div>
          <div className="metric-value">{away.length}</div>
          <div className="metric-caption warn">승인된 휴가</div>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>마감</span>
            <Clock3 size={16} />
          </div>
          <div className="metric-value">
            {
              events.filter(
                (e) => e.type === "업무 마감" || e.type === "계약 만료",
              ).length
            }
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>발행</span>
            <Sparkles size={16} />
          </div>
          <div className="metric-value">
            {events.filter((e) => e.type === "발행").length}
          </div>
        </div>
      </section>
      {away.length ? (
        <div className="inline-alert warning">
          <Plane size={16} />
          이번 주 자리 비움:{" "}
          {away
            .map((event) =>
              String(meta(event.record, "memberName") || event.record.title),
            )
            .join(", ")}
        </div>
      ) : null}
      <section className="week-board">
        {days.map((day) => (
          <article className="panel" key={day.toISOString()}>
            <header>
              <strong>
                {new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(
                  day,
                )}
              </strong>
              <span>
                {day.getMonth() + 1}/{day.getDate()}
              </span>
            </header>
            <div>
              {events
                .filter(
                  (event) => event.at.toDateString() === day.toDateString(),
                )
                .map((event) => (
                  <div
                    className={`week-event event-${event.record.record_type}`}
                    key={event.record.id}
                  >
                    <span>{event.type}</span>
                    <strong>{event.record.title}</strong>
                    <small>
                      {event.record.team || event.record.brand || "회사 공통"}
                    </small>
                  </div>
                ))}
              {!events.some(
                (event) => event.at.toDateString() === day.toDateString(),
              ) ? (
                <p>일정 없음</p>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function isContentAiJob(job: OsRecord) {
  return Boolean(
    meta(job, "contentAction") ||
      meta(job, "sourceId") ||
      meta(job, "contentId") ||
      meta(job, "generationMode") ||
      meta(job, "generatedBy") === "claude-queue" ||
      job.tags.includes("콘텐츠"),
  );
}

export function AiOperationsWorkspace({ contentOnly = false }: { contentOnly?: boolean } = {}) {
  const { accessToken, demo } = useSession();
  const [jobs, setJobs] = useState<OsRecord[]>([]);
  const [health, setHealth] = useState<Awaited<
    ReturnType<typeof getHealth>
  > | null>(null);
  const [error, setError] = useState("");
  const [selectedJob, setSelectedJob] = useState<OsRecord | null>(null);
  useEffect(() => {
    if (demo) return;
    Promise.all([listRecords(accessToken, "ai_job", "limit=100&excludeKind=development_request"), getHealth()])
      .then(([result, status]) => {
        setJobs(contentOnly ? result.records.filter(isContentAiJob) : result.records);
        setHealth(status);
      })
      .catch((reason) => setError(reason.message));
  }, [accessToken, contentOnly, demo]);
  const systems = [
    [
      "회의 녹음→전사·요약",
      health?.auth === "ready" ? "ready" : "blocked",
      "사람 확인 후 결정·미결·업무 저장",
    ],
    [
      "회사 정본 검색",
      health?.database === "ready" ? "ready" : "blocked",
      health?.embeddings === "ready" ? "하이브리드 검색" : "키워드 검색",
    ],
    [
      "텔레그램 폰 캡처",
      health?.telegram === "ready" ? "ready" : "blocked",
      "인박스·raw·후기·썸네일 기록",
    ],
    [
      "문서 즉시 색인",
      health?.embeddings === "ready" ? "ready" : "waiting",
      health?.embeddings === "ready" ? "저장 이벤트 처리" : "OpenAI 키 대기",
    ],
  ];
  useRecordDeepLink("job", "ai_job", setSelectedJob, setError);
  const selectedJobSourceUrl = safeWebUrl(selectedJob?.source_url);
  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <PageTitle />
          <p>
            {contentOnly
              ? "콘텐츠 생성 요청의 대기·진행·검수 상태를 확인합니다."
              : "AI가 회사 정본을 읽고 반복 작업을 수행하며, 사람은 확인하고 결정합니다."}
          </p>
        </div>
      </header>
      {error ? (
        <div className="inline-alert danger">
          <CircleAlert size={16} />
          {error}
        </div>
      ) : null}
      {!contentOnly ? <><div className="section-intro"><div><span className="eyebrow">1단계</span><h2>회사 공용 자동 작업</h2><p>내부 정리는 자동으로 실행하고, 민감·대외 작업은 사람의 최종 확정을 기다립니다.</p></div></div>
      <section className="ai-system-grid">
        {systems.map(([title, status, description]) => (
          <article className="panel" key={title}>
            <span className={`state-dot ${status}`} />
            <Bot size={19} />
            <div>
              <strong>{title}</strong>
              <p>{description}</p>
            </div>
            <em className={status}>{status === "ready" ? "작동" : "연결 대기"}</em>
          </article>
        ))}
      </section>
      <div className="section-intro"><div><span className="eyebrow">2단계</span><h2>개인 AI 통로</h2><p>직원별 Claude Code·텔레그램·Agent PAT가 같은 회사 정본과 권한 범위를 사용합니다.</p></div></div></> : null}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>사람이 요청한 AI 작업</h2>
            <p>{contentOnly ? "콘텐츠 생성 요청의 진행·검수 상태" : "GPT·Codex·Claude 요청서의 진행·검수 상태"}</p>
          </div>
          <span className="count-badge">{jobs.length}</span>
        </div>
        <div className="activity-list">
          {jobs.map((job) => (
            <button type="button" className="ai-job-item" key={job.id} onClick={() => setSelectedJob(job)} aria-label={`${job.title} 상세 열기`}>
              <span className="document-symbol">
                <Sparkles size={15} />
              </span>
              <span className="activity-main">
                <strong>{job.title}</strong>
                <small>{job.description || "요청 내용 없음"}</small>
              </span>
              <span
                className={`status-pill status-${job.status}`}
                role="status"
                aria-label={`작업 상태: ${generationJobLabel(job)}`}
              >
                {generationJobLabel(job)}
              </span>
            </button>
          ))}
          {!jobs.length ? (
            <div className="quiet-state">
              <Bot />
              <strong>등록된 AI 작업 없음</strong>
              <span>{contentOnly ? "콘텐츠 화면에서 생성 요청을 보내면 여기에 모입니다." : "AI 작업에서 요청서를 등록하면 여기에 모입니다."}</span>
            </div>
          ) : null}
        </div>
      </section>
      {selectedJob ? <div className="drawer-backdrop" onMouseDown={() => setSelectedJob(null)}>
        <aside className="record-drawer" role="dialog" aria-label="AI 작업 상세" onMouseDown={(event) => event.stopPropagation()}>
          <div className="drawer-head"><div><span className="eyebrow">AI 작업 상세</span><h2>{selectedJob.title}</h2></div><button type="button" className="icon-button" aria-label="AI 작업 상세 닫기" onClick={() => setSelectedJob(null)}><X size={18} /></button></div>
          <div className="ai-job-detail">
            <div className="record-meta"><span>{selectedJob.brand || "전체 브랜드"}</span><span>{selectedJob.team || "담당 팀 미지정"}</span><span>{generationJobLabel(selectedJob)}</span></div>
            <section><h3>요청 내용</h3><p>{selectedJob.description || "요청 내용이 없습니다."}</p></section>
            {selectedJob.status === "blocked" ? <section className="inline-alert warning"><CircleAlert size={16} /><span>{health?.contentAi === "ready" ? "AI 연결은 현재 준비됐습니다. 기존 막힘 작업은 자동 재실행되지 않으므로 원본 작업 화면에서 다시 실행하세요." : "AI 연결 설정을 확인한 뒤 원본 작업 화면에서 다시 실행하세요."}</span></section> : null}
            <section><h3>최근 상태</h3><p>{selectedJob.stage || "세부 단계 미입력"} · {new Date(selectedJob.updated_at).toLocaleString("ko-KR")}</p></section>
            <div className="drawer-actions">
              {selectedJobSourceUrl ? <a className="secondary-button" href={selectedJobSourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> 결과·원본 링크</a> : null}
              {meta(selectedJob, "contentAction") || meta(selectedJob, "sourceId") || meta(selectedJob, "contentId") ? <Link className="primary-button" href={`${contentOnly ? "/automation/review" : "/content/automation"}${String(meta(selectedJob, "sourceId") || meta(selectedJob, "contentId") || selectedJob.parent_id || "") ? `?sourceId=${encodeURIComponent(String(meta(selectedJob, "sourceId") || meta(selectedJob, "contentId") || selectedJob.parent_id))}` : ""}`}><Sparkles size={14} /> 원본 콘텐츠 열기</Link> : null}
              {selectedJob.status === "blocked" ? <Link className="secondary-button" href="/settings/connections">연결 상태 확인</Link> : null}
            </div>
            {!selectedJobSourceUrl && !meta(selectedJob, "contentAction") && !meta(selectedJob, "sourceId") && !meta(selectedJob, "contentId") ? <p className="inline-alert">연결된 원본이나 결과 링크가 없습니다. 요청 등록 화면에서 출처 링크를 추가해 주세요.</p> : null}
          </div>
        </aside>
      </div> : null}
    </>
  );
}

export function LeaveWorkspace() {
  const { accessToken, demo, profile } = useSession();
  const [balances, setBalances] = useState<OsRecord[]>([]);
  const [requests, setRequests] = useState<OsRecord[]>([]);
  const [members, setMembers] = useState<OsMember[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [balanceDrawer, setBalanceDrawer] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (demo) return;
    try {
      const [balanceRows, requestRows, memberRows] = await Promise.all([
        listRecords(accessToken, "leave_balance", "limit=200"),
        listRecords(accessToken, "leave_request", "limit=200"),
        listMembers(accessToken),
      ]);
      setBalances(balanceRows.records);
      setRequests(requestRows.records);
      setMembers(memberRows.members.filter((item) => item.is_active));
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "연차 정보를 불러오지 못했습니다.",
      );
    }
  }, [accessToken, demo]);
  useEffect(() => {
    load();
  }, [load]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const memberId = String(form.get("memberId") || profile?.id || "");
    const member = members.find((item) => item.id === memberId);
    const days = Number(form.get("days") || 0);
    setBusy(true);
    try {
      await createRecord(accessToken, {
        recordType: "leave_request",
        title: `${member?.display_name || "구성원"} ${String(form.get("type"))}`,
        description: String(form.get("reason") || ""),
        status: "pending",
        assigneeId: memberId || null,
        startsAt: new Date(String(form.get("start"))).toISOString(),
        endsAt: new Date(String(form.get("end"))).toISOString(),
        metricCurrent: days,
        metricUnit: "일",
        metadata: {
          memberId,
          memberName: member?.display_name || member?.email || "",
          leaveType: String(form.get("type")),
          days,
        },
      });
      setDrawer(false);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "휴가를 신청하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };
  const grantBalance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const memberId=String(form.get("memberId")||""); const member=members.find(item=>item.id===memberId); const days=Number(form.get("days")||0); setBusy(true);
    try { const existing=balances.find(item=>String(meta(item,"memberId"))===memberId); if(existing) await updateRecord(accessToken,{id:existing.id,expectedVersion:existing.version,metricTarget:days,metricCurrent:days,progress:0,metadata:{...existing.metadata,memberId,memberName:member?.display_name||member?.email||""}}); else await createRecord(accessToken,{recordType:"leave_balance",title:member?.display_name||member?.email||"구성원",status:"active",assigneeId:memberId,metricTarget:days,metricCurrent:days,metricUnit:"일",metadata:{memberId,memberName:member?.display_name||member?.email||""}}); setBalanceDrawer(false); await load(); }
    catch(reason){setError(reason instanceof Error?reason.message:"연차를 부여하지 못했습니다.");}finally{setBusy(false);}
  };
  const decide = async (request: OsRecord, status: "approved" | "rejected") => {
    setBusy(true);
    try {
      await updateRecord(accessToken, {
        id: request.id,
        expectedVersion: request.version,
        status,
      });
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "승인 상태를 변경하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };
  const pending = requests.filter((item) => item.status === "pending").length;
  const remaining = sampleSummary(balances.flatMap(item =>
    typeof item.metric_current === "number" ? [item.metric_current] : []));
  const rosterBalances = BRANDYACTION_ROSTER.map((rosterMember) => {
    const account = members.find((member) =>
      memberMatchesRoster(member, rosterMember.name),
    );
    const balance = balances.find((item) => {
      const memberId = String(meta(item, "memberId") || item.assignee_id || "");
      const memberName = String(meta(item, "memberName") || item.title || "");
      return memberId === account?.id || memberName.includes(rosterMember.name);
    });
    return { ...rosterMember, account, balance };
  });
  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <PageTitle />
          <p>잔여 연차와 신청·승인·자동 차감을 관리합니다.</p>
        </div>
        <button className="primary-button" onClick={() => setDrawer(true)}>
          <Plus size={16} />
          휴가 신청
        </button>
      </header>
      <div className="inline-alert warning" role="status">
        인사 노무 관리로 옮기는 중입니다. 새 휴가는 인사 노무 관리에서 입력하세요.{" "}
        <Link href="/hr/leave">휴가 관리로 이동</Link>
      </div>
      {error ? (
        <div className="inline-alert danger">
          <CircleAlert size={16} />
          {error}
        </div>
      ) : null}
      <section className="metric-grid compact-metrics">
        <div className="metric-card">
          <div className="metric-top">
            <span>승인 대기</span>
            <Clock3 size={16} />
          </div>
          <div className="metric-value">{pending}</div>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>잔여 연차 중앙값</span>
            <Plane size={16} />
          </div>
          <div className="metric-value">{remaining.median === null ? "미등록" : `${remaining.median.toFixed(1)}일`}</div>
          <small>{remaining.n ? `범위 ${remaining.min}–${remaining.max}일 · n=${remaining.n}개 등록 기록` : "등록된 잔여 연차 기록이 없습니다."}</small>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>이번 달 휴가</span>
            <CalendarDays size={16} />
          </div>
          <div className="metric-value">
            {
              requests.filter(
                (item) =>
                  dateKey(item.starts_at).startsWith(
                    new Date().toISOString().slice(0, 7),
                  ) && item.status === "approved",
              ).length
            }
          </div>
        </div>
      </section>
      <section className="leave-layout">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>구성원별 잔여</h2>
              <p>부여·사용·잔여 일수</p>
            </div>
            {profile?.role==="admin"?<button className="secondary-button compact" onClick={()=>setBalanceDrawer(true)}><Plus size={14}/>연차 부여</button>:null}
          </div>
          <div className="leave-balances">
            {rosterBalances.map(({ name, account, balance }) => {
              const total = balance ? Number(balance.metric_target || 0) : 0;
              const remaining = balance
                ? Number(balance.metric_current || 0)
                : 0;
              return (
                <div key={name} className={!balance ? "unregistered" : undefined}>
                  <span>
                    <strong>{name}</strong>
                    <small>
                      {balance
                        ? `총 ${total}일 · 사용 ${Math.max(0, total - remaining)}일`
                        : account
                          ? "연차 부여 정보 없음"
                          : "계정 연결 전 · 연차 부여 정보 없음"}
                    </small>
                  </span>
                  <div>
                    <i
                      style={{
                        width: `${total ? (remaining / total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <em>{balance ? `${remaining}일` : "미등록"}</em>
                </div>
              );
            })}
          </div>
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>휴가 신청</h2>
              <p>신청→승인→잔여 자동 차감</p>
            </div>
          </div>
          <div className="leave-requests">
            {requests.map((item) => (
              <div key={item.id}>
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {dateKey(item.starts_at)} ~ {dateKey(item.ends_at)} ·{" "}
                    {Number(meta(item, "days") || item.metric_current || 0)}일
                  </small>
                </span>
                <span className={`status-pill status-${item.status}`}>
                  {item.status === "pending"
                    ? "승인 대기"
                    : item.status === "approved"
                      ? "승인"
                      : "반려"}
                </span>
                {item.status === "pending" && profile?.role === "admin" ? (
                  <div>
                    <button
                      className="ghost-button"
                      disabled={busy}
                      onClick={() => decide(item, "rejected")}
                    >
                      반려
                    </button>
                    <button
                      className="primary-button compact"
                      disabled={busy}
                      onClick={() => decide(item, "approved")}
                    >
                      <CheckCircle2 size={13} />
                      승인
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </article>
      </section>
      {balanceDrawer?<div className="drawer-backdrop" onMouseDown={()=>!busy&&setBalanceDrawer(false)}><form className="record-drawer" onSubmit={grantBalance} onMouseDown={event=>event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">연차 잔여</span><h2>연차 부여·재설정</h2></div><button type="button" className="icon-button" onClick={()=>setBalanceDrawer(false)}><X size={18}/></button></div><label><span>구성원</span><select name="memberId" required>{members.map(member=><option value={member.id} key={member.id}>{member.display_name||member.email}</option>)}</select></label><label><span>총 부여 일수</span><input name="days" type="number" min="0" step="0.5" defaultValue="15" required/></label><div className="inline-alert warning">기존 잔여가 있으면 총 부여일과 잔여일을 입력값으로 재설정합니다.</div><div className="drawer-actions"><button type="button" className="secondary-button" onClick={()=>setBalanceDrawer(false)}>취소</button><button className="primary-button" disabled={busy}>저장</button></div></form></div>:null}
      {drawer ? (
        <div
          className="drawer-backdrop"
          onMouseDown={() => !busy && setDrawer(false)}
        >
          <form
            className="record-drawer"
            onSubmit={submit}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="drawer-head">
              <div>
                <span className="eyebrow">휴가 신청</span>
                <h2>휴가 신청</h2>
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
              <span>신청자</span>
              <select name="memberId" defaultValue={profile?.id}>
                {members.map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.display_name || member.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>구분</span>
              <select name="type">
                <option>연차</option>
                <option>반차</option>
                <option>경조휴가</option>
                <option>기타</option>
              </select>
            </label>
            <div className="form-grid">
              <label>
                <span>시작일</span>
                <input type="date" name="start" required />
              </label>
              <label>
                <span>종료일</span>
                <input type="date" name="end" required />
              </label>
            </div>
            <label>
              <span>사용 일수</span>
              <input type="number" min="0.5" step="0.5" name="days" required />
            </label>
            <label>
              <span>사유</span>
              <textarea name="reason" rows={4} />
            </label>
            <div className="drawer-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDrawer(false)}
              >
                취소
              </button>
              <button className="primary-button" disabled={busy}>
                신청 저장
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
