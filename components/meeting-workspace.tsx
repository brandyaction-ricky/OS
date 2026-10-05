"use client";
import { useRecordDeepLink } from "./use-record-deep-link";

import { useSearchParams } from "next/navigation";
import {meetingTabHref} from "@/lib/fullscreen-tabs";
import { contentOrigin } from "@/lib/content-origin";
import { demoRecord } from "@/lib/demo-record";
import { makeMeetingReview, meetingReviewErrors, similarMeetings, readMeetingReview, normalizeMeetingTerms, matchMeetingAssignee, type MeetingReviewItem, type ReviewMember } from "@/lib/meeting-review";
import { customMeetingTerms, type MeetingTerm } from "@/lib/meeting-term-settings";
import { MeetingReviewEditor } from "./meeting-review-editor";
import { WorkspaceLoadState } from "./workspace-load-state";
import { OperationsWorkspace } from "./operations-workspace";
import { WORKSPACE_CONFIGS } from "@/lib/workspace-config";
import { PageTitle } from "./page-title";

import {
  AudioLines,
  Bot,
  CalendarCheck,
  CalendarDays,
  CircleAlert,
  FileAudio,
  GitBranch,
  Mic,
  Play,
  Plus,
  Square,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  createDocument,
  createRecord,
  getMeetingRecordingUrl,
  listAllRecordsOfType,
  listMembers,
  prepareMeeting,
  summarizeMeeting,
  transcribeMeeting,
  updateRecord,
  type MeetingSummaryResult,
} from "@/lib/api-client";
import { PRIMARY_MEETING_BUSINESSES, resolveMeetingBusiness } from "@/lib/meeting-business";
import { buildMeetingRawDocument, buildMeetingSummaryDocument } from "@/lib/meeting-documents";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

function meta(record: OsRecord | null, key: string) {
  const value = record?.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function dateTime(value: string | null) {
  if (!value) return "일정 미정";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function nowLocalInput() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function suggestMeetingTitle(brand: string) {
  const label = resolveMeetingBusiness(brand)?.label || brand.trim();
  const dateLabel = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
  }).format(new Date());
  return label ? `${label} 회의 · ${dateLabel}` : `${dateLabel} 회의`;
}

export function MeetingWorkspace({initialTab="meetings"}:{initialTab?:"meetings"|"decisions"} = {}) {
  const { accessToken, demo, profile } = useSession();
  const params = useSearchParams();
  const decisionsTab = (params.get("tab") ?? initialTab) === "decisions";
  const [members, setMembers] = useState<ReviewMember[]>([]);
  const [meetingTerms, setMeetingTerms] = useState<MeetingTerm[]>([]);
  const [reviewItems, setReviewItems] = useState<MeetingReviewItem[]>([]);
  const [manualDecisions, setManualDecisions] = useState("");
  const [manualTasks, setManualTasks] = useState("");
  const [loading, setLoading] = useState(!demo);
  const [notice, setNotice] = useState("");
  const [comparison, setComparison] = useState<OsRecord | null>(null);
  const savingRef = useRef(false);
  const reviewDetailsRef = useRef<HTMLDetailsElement>(null);
  const [meetings, setMeetings] = useState<OsRecord[]>([]);
  const [decisions, setDecisions] = useState<OsRecord[]>([]);
  const [tasks, setTasks] = useState<OsRecord[]>([]);
  const [editing, setEditing] = useState<OsRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [startsAtDraft, setStartsAtDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("planned");
  const titleEditedRef = useRef(false);
  const [summary, setSummary] = useState("");
  const [summaryMode, setSummaryMode] = useState<"ai" | "local" | "">("");
  const [transcript, setTranscript] = useState("");
  const [structured, setStructured] = useState<MeetingSummaryResult | null>(
    null,
  );
  const [prep, setPrep] = useState<Array<{
    label: string;
    result: Awaited<ReturnType<typeof prepareMeeting>>;
  }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const load = useCallback(async () => {
    if (demo) {setMembers([{id:profile?.id||"demo",display_name:"데모 담당자",email:"demo@example.test",is_active:true}]);return;}
    setLoading(true);
    try {
      const [meetingResult, decisionResult, taskResult, memberResult, settingResult] = await Promise.all([
        listAllRecordsOfType(accessToken, "meeting"),
        listAllRecordsOfType(accessToken, "decision"),
        listAllRecordsOfType(accessToken, "task"),
        listMembers(accessToken),
        listAllRecordsOfType(accessToken, "company_setting").catch(() => []),
      ]);
      setMeetings(meetingResult.filter(item=>contentOrigin(item)==="own"));
      setDecisions(decisionResult.filter(item=>contentOrigin(item)==="own"));
      setTasks(taskResult.filter(item=>contentOrigin(item)==="own"));
      setMembers(memberResult.members.filter(member=>member.is_active));
      setMeetingTerms(customMeetingTerms(settingResult));
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "회의 기록을 불러오지 못했습니다.",
      );
    }
    finally {setLoading(false);}
  }, [accessToken, demo, profile?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(()=>{setReviewItems(previous=>previous.map(item=>!item.assigneeId&&item.assigneeHint?{...item,assigneeId:matchMeetingAssignee(item.assigneeHint,members)}:item));},[members]);

  const openNew = () => {
    setEditing(null); setReviewItems([]); setManualDecisions(""); setManualTasks(""); setComparison(null);
    setTitle(suggestMeetingTitle(""));
    setBrand("");
    titleEditedRef.current = false;
    setStartsAtDraft(nowLocalInput());
    setStatusDraft("active");
    setSummary("");
    setSummaryMode("");
    setTranscript("");
    setStructured(null);
    setRecordedBlob(null);
    setDrawerOpen(true);
  };
  const openEdit = (meeting: OsRecord) => {
    setEditing(meeting); setManualDecisions(""); setManualTasks(""); setComparison(null);
    setReviewItems(readMeetingReview(meeting.metadata.reviewItems) ?? makeMeetingReview({decisions:Array.isArray(meeting.metadata.decisions)?meeting.metadata.decisions.map(String):[],pending:Array.isArray(meeting.metadata.pending)?meeting.metadata.pending.map(String):[],todos:Array.isArray(meeting.metadata.todos)?meeting.metadata.todos as MeetingSummaryResult["todos"]:[]},members,undefined,meetingTerms));
    setTitle(meeting.title);
    setBrand(meeting.brand ?? "");
    titleEditedRef.current = true;
    setStartsAtDraft(meeting.starts_at ? new Date(new Date(meeting.starts_at).getTime()-new Date(meeting.starts_at).getTimezoneOffset()*60000).toISOString().slice(0,16) : "");
    setStatusDraft(meeting.status);
    setSummary(meta(meeting, "summary"));
    setSummaryMode(meta(meeting, "summaryMode") as "ai" | "local" | "");
    setTranscript(meta(meeting, "transcript"));
    setStructured({
      summary: meta(meeting, "summary"),
      mode: (meta(meeting, "summaryMode") || "local") as "ai" | "local",
      decisions: Array.isArray(meeting.metadata.decisions)
        ? meeting.metadata.decisions.map(String)
        : [],
      pending: Array.isArray(meeting.metadata.pending)
        ? meeting.metadata.pending.map(String)
        : [],
      todos: Array.isArray(meeting.metadata.todos)
        ? (meeting.metadata.todos as MeetingSummaryResult["todos"])
        : [],
    });
    setRecordedBlob(null);
    setDrawerOpen(true);
  };

  useRecordDeepLink("meeting", "meeting", openEdit, setError);
  const startRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 32_000,
      });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        if (blob.size > 4_000_000) {
          setError(
            "녹음이 4MB를 넘었습니다. 약 15분 단위로 나누어 녹음해 주세요.",
          );
          return;
        }
        setRecordedBlob(blob);
        void transcribeBlob(blob);
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("마이크 권한을 허용해야 회의를 녹음할 수 있습니다.");
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const extractFromText = async (text: string) => {
    if (text.trim().length < 20) return;
    setBusy(true);
    setError("");
    try {
      const result: MeetingSummaryResult = demo ? {summary:text,mode:"local",decisions:[],pending:text.split("\n").filter(Boolean),todos:[]} : await summarizeMeeting(accessToken, text, startsAtDraft.slice(0,10));
      setSummary(normalizeMeetingTerms(result.summary, meetingTerms));
      setSummaryMode(result.mode);
      setStructured(result);
      setReviewItems(makeMeetingReview(result,members,undefined,meetingTerms));
      if (result.decisions.length || result.pending.length || result.todos.length) reviewDetailsRef.current?.setAttribute("open", "");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "회의를 요약하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  const makeSummary = () => extractFromText(transcript);

  // 녹음 종료 → 전사 → (20자 이상이면) 결정·미해결·업무 추출까지 이어서 끝낸다.
  // 실패해도 앞 단계 결과(녹음/전사)는 남아있어 수동 재시도 버튼으로 이어갈 수 있다.
  const transcribeBlob = async (blob: Blob) => {
    setBusy(true);
    setError("");
    try {
      const result = await transcribeMeeting(accessToken, blob);
      setTranscript(result.transcript);
      setRecordedBlob(null);
      await extractFromText(result.transcript);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "녹음을 전사하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  const makeTranscript = () => recordedBlob && transcribeBlob(recordedBlob);

  const loadPrep = async () => {
    setBusy(true);
    setError("");
    try {
      const results = await Promise.all(
        PRIMARY_MEETING_BUSINESSES.map(async (business) => ({
          label: business.label,
          result: await prepareMeeting(accessToken, business.recordBrand),
        })),
      );
      setPrep(results);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "회의 준비 자료를 불러오지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  const playRecording = async (path: string) => {
    try {
      const { url } = await getMeetingRecordingUrl(accessToken, path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "녹음을 열지 못했습니다.",
      );
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    const errors=meetingReviewErrors(reviewItems,members);
    if(errors.length || manualDecisions.trim() || manualTasks.trim()){setError(errors[0]||"직접 입력한 내용을 검수에 추가해 주세요.");return;}
    savingRef.current=true;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    setBusy(true);
    setError("");
    try {
      const recordingPath = meta(editing, "recordingPath");
      const reviewed = { decisions:reviewItems.filter(item=>item.kind==="decision").map(item=>item.title.trim()), pending:reviewItems.filter(item=>item.kind==="pending").map(item=>item.title.trim()), todos:reviewItems.filter(item=>item.kind==="task").map(item=>({title:item.title.trim(),assignee:members.find(member=>member.id===item.assigneeId)?.display_name||"",assigneeId:item.assigneeId,dueDate:item.dueDate,dueLabel:item.dueDate,doneCriteria:item.doneCriteria,reviewId:item.id})) };
      const input = {
        recordType: "meeting",
        title: value("title"),
        description: value("agenda"),
        status: value("status"),
        priority: "normal",
        team: value("team"),
        brand: value("brand"),
        startsAt: value("startsAt")
          ? new Date(value("startsAt")).toISOString()
          : null,
        tags: value("participants")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        metadata: {
          ...(editing?.metadata ?? {}),
          participants: value("participants"),
          recordingPath,
          transcript,
          summary,
          summaryMode,
          decisions: reviewed.decisions,
          pending: reviewed.pending,
          todos: reviewed.todos,
          reviewItems,
          extractionDraft: structured,
        },
      };
      let meeting: OsRecord;
      if (demo) meeting=demoRecord(input,profile?.id||"demo",editing||undefined);
      else if (editing)
        ({ record: meeting } = await updateRecord(accessToken, {
          ...input,
          id: editing.id,
          expectedVersion: editing.version,
        }));
      else ({ record: meeting } = await createRecord(accessToken, input));

      // Keep the saved parent version for a retry after a partial child failure.
      setEditing(meeting);
      if(demo)setMeetings(previous=>[meeting,...previous.filter(item=>item.id!==meeting.id)]);
      const [freshDecisions,freshTasks]=demo?[decisions,tasks]:await Promise.all([listAllRecordsOfType(accessToken,"decision"),listAllRecordsOfType(accessToken,"task")]);
      const existingDecisionTitles=new Set(freshDecisions.filter(item=>(item.metadata.meetingId||item.parent_id)===meeting.id).map(item=>item.title));
      for(const title of [...new Set(reviewed.decisions)].filter(title=>!existingDecisionTitles.has(title))) {
        const body={recordType: "decision", parentId: meeting.id,title,description:`회의: ${meeting.title}`,status:"decided",team:meeting.team,brand:meeting.brand,metadata:{meetingId:meeting.id,source:"meeting"}};
        const record=demo?demoRecord(body,profile?.id||"demo"):(await createRecord(accessToken,body)).record;
        setDecisions(previous=>[record,...previous]);existingDecisionTitles.add(title);
      }
      const linkedTasks=freshTasks.filter(item=>(item.metadata.meetingId||item.parent_id)===meeting.id);
      for(const todo of reviewed.todos) {
        const existing=linkedTasks.find(item=>item.metadata.extractionReviewId===todo.reviewId || item.title===todo.title);
        const body={recordType: "task", parentId: meeting.id,title:todo.title,description:existing?.description||`회의 후속 업무: ${meeting.title}`,status:existing?.status||"planned",team:meeting.team,brand:meeting.brand,assigneeId:todo.assigneeId,dueDate:todo.dueDate,metadata:{...existing?.metadata,meetingId:meeting.id,source:"meeting",assigneeName:todo.assignee,doneCriteria:todo.doneCriteria,extractionReviewId:todo.reviewId,extractionReviewed:true}};
        if(existing && existing.assignee_id===todo.assigneeId && existing.due_date===todo.dueDate && existing.metadata.doneCriteria===todo.doneCriteria)continue;
        const record=demo?demoRecord({...body,parentId:existing?.parent_id??meeting.id},profile?.id||"demo",existing):existing?(await updateRecord(accessToken,{...body,parentId:existing.parent_id,id:existing.id,expectedVersion:existing.version})).record:(await createRecord(accessToken,body)).record;
        setTasks(previous=>[record,...previous.filter(item=>item.id!==record.id)]);if(existing)linkedTasks.splice(linkedTasks.indexOf(existing),1,record);else linkedTasks.push(record);
      }

      // 지식 문서함 반영 — 텔레그램 /회의기록과 같은 두 문서(원문 01_Raw/주간회의,
      // 요약 02_Wiki/{사업}/운영/주간회의요약)를 만든다. 요약이 있고, 사업(브랜드)을
      // 알아볼 수 있고, 이 회의가 아직 문서함에 안 올라간 경우에만 한 번 실행한다.
      // 실패해도 회의·결정·업무 저장은 이미 끝난 상태로 둔다(부가 기능).
      const existingDocuments = meeting.metadata?.knowledgeDocuments as
        | { rawId?: string; summaryId?: string }
        | undefined;
      const business = resolveMeetingBusiness(meeting.brand);
      if (!demo && summary.trim() && business && !existingDocuments?.rawId && !existingDocuments?.summaryId) {
        try {
          const meetingDate = meeting.starts_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
          const raw = buildMeetingRawDocument(business, meetingDate, transcript || meeting.description || "");
          const summaryDoc = buildMeetingSummaryDocument(business, meetingDate, {
            summary,
            decisions: reviewed.decisions,
            pending: reviewed.pending,
            todos: reviewed.todos,
          });
          const [rawResult, summaryResult] = await Promise.all([
            createDocument(accessToken, { title: raw.title, content: raw.content_md, folder: raw.folder, brand: meeting.brand, team: meeting.team, tags: ["주간회의", business.label], source: "meeting_raw", sourceRef: meeting.id }),
            createDocument(accessToken, { title: summaryDoc.title, content: summaryDoc.content_md, folder: summaryDoc.folder, brand: meeting.brand, team: meeting.team, tags: ["주간회의요약", business.label], source: "meeting_summary", sourceRef: meeting.id }),
          ]);
          await updateRecord(accessToken, {
            id: meeting.id,
            expectedVersion: meeting.version,
            metadata: { ...meeting.metadata, knowledgeDocuments: { rawId: rawResult.document.id, summaryId: summaryResult.document.id } },
          });
        } catch (docError) {
          void docError; setNotice("회의·후속 업무는 저장됐지만 문서함 반영은 완료하지 못했습니다. 회의를 다시 열어 확인해 주세요.");
        }
      }

      setDrawerOpen(false);
      setEditing(null);
      setRecordedBlob(null);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "회의를 저장하지 못했습니다.",
      );
    } finally {
      savingRef.current=false;
      setBusy(false);
    }
  };

  const reviewErrors=meetingReviewErrors(reviewItems,members);
  const similar=similarMeetings(meetings,title,brand,startsAtDraft.slice(0,10),editing?.id,meetingTerms);
  const upcoming = meetings.filter(
    (meeting) => meeting.status === "planned",
  ).length;
  const summarized = meetings.filter((meeting) =>
    meta(meeting, "summary"),
  ).length;
  const meetingDecisions = decisions.filter(
    (item) =>
      (item.metadata.meetingId || item.parent_id) &&
      meetings.some((meeting) => meeting.id === (item.metadata.meetingId || item.parent_id)),
  );
  const meetingTasks = tasks.filter(
    (item) =>
      (item.metadata.meetingId || item.parent_id) &&
      meetings.some((meeting) => meeting.id === (item.metadata.meetingId || item.parent_id)),
  );
  const linkedDocuments = editing?.metadata.knowledgeDocuments as
    | { rawId?: string; summaryId?: string }
    | undefined;

  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <PageTitle />
          <p>
            지난 미해결 항목과 KPI를 이어받고, 녹음에서 결정과 후속 업무를
            만듭니다.
          </p>
        </div>
        <div className="header-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={loadPrep}
          >
            <CalendarCheck size={16} /> 회의 준비
          </button>
          <button className="primary-button" onClick={openNew}>
            <Plus size={16} /> 회의 기록
          </button>
        </div>
      </header>
      {error ? (
        <div className="inline-alert danger">
          <CircleAlert size={16} /> {error}
        </div>
      ) : null}
      {notice&&<p className="inline-alert" role="status">{notice}</p>}
      {demo&&<p className="field-hint">데모 · 저장한 회의는 현재 화면에서만 유지됩니다.</p>}
      <nav className="workspace-tabs" aria-label="회의·결정 보기">{[["meetings","회의"],["decisions","모든 결정"]].map(([tab,label])=><button key={tab} aria-pressed={decisionsTab===(tab==="decisions")} className={decisionsTab===(tab==="decisions")?"active":""} onClick={()=>window.history.replaceState(null,"",meetingTabHref(tab,params.toString()))}>{label}</button>)}</nav>
      {decisionsTab ? <OperationsWorkspace config={WORKSPACE_CONFIGS["/home/decisions"]} demoRecords={decisions} embedded /> : <WorkspaceLoadState loading={loading} error={error&&!meetings.length?error:undefined} retry={load}>
      <section className="metric-grid compact-metrics">
        <div className="metric-card">
          <div className="metric-top">
            <span>예정 회의</span>
            <span className="metric-icon">
              <CalendarDays size={16} />
            </span>
          </div>
          <div className="metric-value">{upcoming}</div>
          <div className="metric-caption">일정 대기</div>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>요약 완료</span>
            <span className="metric-icon">
              <Bot size={16} />
            </span>
          </div>
          <div className="metric-value">{summarized}</div>
          <div className="metric-caption good">원문 기반 요약</div>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>결정사항</span>
            <span className="metric-icon">
              <GitBranch size={16} />
            </span>
          </div>
          <div className="metric-value">{meetingDecisions.length}</div>
          <div className="metric-caption">회의에서 생성</div>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>후속 업무</span>
            <span className="metric-icon">
              <AudioLines size={16} />
            </span>
          </div>
          <div className="metric-value">
            {meetingTasks.filter((item) => item.status !== "done").length}
          </div>
          <div className="metric-caption warn">완료 전 실행</div>
        </div>
      </section>
      {prep ? (
        <section className="panel meeting-prep">
          <div className="panel-header">
            <div>
              <h2>다음 회의 준비</h2>
              <p>마이인·브랜디에듀 각각의 이전 회의에서 이어집니다.</p>
            </div>
            <button className="icon-button" onClick={() => setPrep(null)}>
              <X size={16} />
            </button>
          </div>
          {prep.map((entry) => (
            <div className="meeting-prep-business" key={entry.label}>
              <h3>{entry.label}</h3>
              <p className="field-hint">
                {entry.result.latestMeeting
                  ? `이전 회의 "${entry.result.latestMeeting.title}"에서 이어집니다.`
                  : "첫 회의용 안건입니다."}
              </p>
              {entry.result.latestMeeting?.summary ? (
                <div className="meeting-prep-summary">
                  <strong>지난 회의 요약</strong>
                  {entry.result.latestMeeting.summary
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line, index) => <p key={index}>{line}</p>)}
                </div>
              ) : null}
              <div className="meeting-prep-grid">
                <div>
                  <strong>미해결 안건</strong>
                  {entry.result.pending.map((item) => (
                    <p key={item}>• {item}</p>
                  ))}
                  {!entry.result.pending.length ? <p>남은 안건이 없습니다.</p> : null}
                </div>
                <div>
                  <strong>완료 전 업무</strong>
                  {entry.result.todos.slice(0, 8).map((item) => (
                    <p key={item.id}>
                      • {item.title}
                      {item.due_date ? ` · ${item.due_date}` : ""}
                    </p>
                  ))}
                  {!entry.result.todos.length ? <p>미완료 업무가 없습니다.</p> : null}
                </div>
                <div>
                  <strong>주간 KPI 안건</strong>
                  {entry.result.kpis.slice(0, 8).map((item) => (
                    <p key={item.id}>
                      • {item.title} {item.current}
                      {item.unit} · {item.signal}
                    </p>
                  ))}
                  {!entry.result.kpis.length ? <p>주간 KPI를 먼저 입력해 주세요.</p> : null}
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}
      <section className="meeting-grid">
        {meetings.map((meeting) => {
          const linkedDecisions = decisions.filter(
            (item) => (item.metadata.meetingId || item.parent_id) === meeting.id,
          );
          const linkedTasks = tasks.filter(
            (item) => (item.metadata.meetingId || item.parent_id) === meeting.id,
          );
          return (
            <article
              className="panel meeting-card"
              key={meeting.id}
              onClick={() => openEdit(meeting)}
            >
              <header>
                <div>
                  <span className={`status-pill status-${meeting.status}`}>
                    {meeting.status === "planned"
                      ? "예정"
                      : meeting.status === "done"
                        ? "완료"
                        : "진행"}
                  </span>
                  <h2>{meeting.title}</h2>
                  <p>
                    {dateTime(meeting.starts_at)} · {meeting.team || "전체 팀"}
                  </p>
                </div>
                {meta(meeting, "recordingPath") ? (
                  <button
                    className="icon-button"
                    aria-label="녹음 재생"
                    onClick={(event) => {
                      event.stopPropagation();
                      playRecording(meta(meeting, "recordingPath"));
                    }}
                  >
                    <Play size={16} />
                  </button>
                ) : (
                  <FileAudio size={18} />
                )}
              </header>
              <p>
                {meta(meeting, "summary")
                  ?.replace(/^#+\s*/gm, "")
                  .slice(0, 180) ||
                  meeting.description ||
                  "회의 요약이 아직 없습니다."}
              </p>
              <footer>
                <span>
                  <GitBranch size={13} /> 결정 {linkedDecisions.length}
                </span>
                <span>
                  <AudioLines size={13} /> 후속 업무 {linkedTasks.length}
                </span>
                <span>
                  <Users size={13} /> {meeting.tags.length || 0}명
                </span>
              </footer>
            </article>
          );
        })}
        {!meetings.length ? (
          <div className="panel empty-state">
            <div>
              <span>
                <Mic />
              </span>
              <h3>첫 회의를 기록하세요.</h3>
              <p>녹음·원문·결정·후속 업무가 하나의 회의에 연결됩니다.</p>
              <button className="primary-button" onClick={openNew}>
                회의 기록
              </button>
            </div>
          </div>
        ) : null}
      </section>
      </WorkspaceLoadState>}
      {drawerOpen ? (
        <div
          className="drawer-backdrop"
          onMouseDown={() => !busy && setDrawerOpen(false)}
        >
          <form
            className="record-drawer meeting-drawer"
            onSubmit={submit}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="drawer-head">
              <div>
                <span className="eyebrow">회의 기록</span>
                <h2>{editing ? "회의 기록 수정" : "새 회의 기록"}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                onClick={() => setDrawerOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="field-hint">회의명과 요약만으로 먼저 기록할 수 있습니다. 녹음·참석자·후속 업무는 필요한 경우 펼쳐 입력하세요.</p>
            {error&&<p role="alert" className="inline-alert danger">{error}</p>}
            {similar.length>0&&<section className="meeting-duplicates"><p>같은 날 비슷한 회의가 있습니다. 원문을 비교하고 같은 회의라면 기존 회의에 이어서 기록하세요.</p>{similar.map(meeting=><button type="button" key={meeting.id} onClick={()=>setComparison(meeting)}>비교 · {meeting.title}</button>)}</section>}
            {comparison&&<section className="meeting-comparison"><h3>회의 비교</h3><strong>현재 작성</strong><p>{transcript||"원문 없음"}</p><strong>{comparison.title}</strong><p>{String(comparison.metadata.transcript||comparison.description||"원문 없음")}</p>{!editing&&<button type="button" onClick={()=>{const draft=transcript, draftSummary=summary, draftItems=reviewItems;openEdit(comparison);setTranscript([String(comparison.metadata.transcript||""),draft].filter(Boolean).join("\n\n"));setSummary([String(comparison.metadata.summary||""),draftSummary].filter(Boolean).join("\n"));setReviewItems(previous=>[...previous,...draftItems]);setNotice("기존 회의에 새 원문을 이어 붙였습니다. 검수 후 저장하면 반영됩니다.");}}>기존 회의에 이어쓰기</button>}<button type="button" onClick={()=>setComparison(null)}>비교 닫기</button></section>}
            <label>
              <span>회의명</span>
              <input
                name="title"
                aria-label="회의명"
                required
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  titleEditedRef.current = true;
                }}
              />
              <small className="field-hint">회의 이름을 입력하세요. 브랜드와 원문은 아래 상세 정보에서 추가할 수 있습니다.</small>
            </label>
            <div className="form-grid">
              <label>
                <span>일시</span>
                <input
                  type="datetime-local"
                  name="startsAt"
                  defaultValue={startsAtDraft}
                />
              </label>
              <label>
                <span>상태</span>
                <select
                  name="status"
                  defaultValue={statusDraft}
                >
                  <option value="planned">예정</option>
                  <option value="active">진행 중</option>
                  <option value="done">완료</option>
                  <option value="cancelled">취소</option>
                </select>
              </label>
            </div>
            <details className="meeting-optional-section">
              <summary>상세 정보 · 녹음 · 원문 입력</summary>
            <div className="form-grid">
              <label>
                <span>브랜드</span>
                <input
                  name="brand"
                  value={brand}
                  onChange={(event) => {
                    const value = event.target.value;
                    setBrand(value);
                    if (!titleEditedRef.current) setTitle(suggestMeetingTitle(value));
                  }}
                  placeholder="마이인 · 브랜디에듀 · 회사(전체)"
                />
                <small className="field-hint">이 셋 중 하나로 입력해야 문서함(원문·요약)에 자동 반영됩니다.</small>
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
              <span>참석자</span>
              <input
                name="participants"
                defaultValue={
                  meta(editing, "participants") ||
                  editing?.tags.join(", ") ||
                  ""
                }
                placeholder="예: 안저, 리키, 에릭"
              />
            </label>
            <label>
              <span>안건</span>
              <textarea
                name="agenda"
                rows={4}
                defaultValue={editing?.description ?? ""}
              />
            </label>
            <div className="recording-panel">
              <div>
                <Mic size={18} />
                <span>
                  <strong>
                    {recording
                      ? "녹음 중"
                      : recordedBlob
                        ? "새 녹음 준비됨"
                        : transcript
                          ? "전사 완료 · 원본 폐기됨"
                          : "회의 녹음"}
                  </strong>
                  <small>전사가 끝나면 녹음 원본은 즉시 폐기하고 텍스트만 보관합니다.</small>
                </span>
              </div>
              <div className="header-actions">
                {recordedBlob ? (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={makeTranscript}
                  >
                    <AudioLines size={14} /> 녹음 전사
                  </button>
                ) : null}
                {recording ? (
                  <button
                    type="button"
                    className="danger-button"
                    onClick={stopRecording}
                  >
                    <Square size={14} /> 녹음 종료
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={startRecording}
                  >
                    <Mic size={14} /> {recordedBlob ? "다시 녹음" : "녹음 시작"}
                  </button>
                )}
              </div>
            </div>
            <label>
              <span>회의 원문·전사</span>
              <textarea
                rows={9}
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                placeholder="녹음을 전사하거나 직접 정리한 원문을 붙여넣으세요."
              />
            </label>
            <button
              type="button"
              className="secondary-button summary-button"
              disabled={busy || transcript.trim().length < 20}
              onClick={makeSummary}
            >
              <Bot size={15} /> {busy ? "분석 중…" : "결정·미해결·업무 추출"}
            </button>
            {transcript.trim().length < 20 ? <small className="field-hint">회의 원문을 20자 이상 입력하면 결정·미해결·업무 추출을 사용할 수 있습니다.</small> : null}
            </details>
            <label>
              <span>
                회의 요약{" "}
                {summaryMode
                  ? `· ${summaryMode === "ai" ? "AI" : "규칙 기반"}`
                  : ""}
              </span>
              <textarea
                rows={7}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="핵심 회의 요약"
              />
            </label>
            <details ref={reviewDetailsRef} className="meeting-optional-section">
              <summary>결정·후속 업무 검수 {reviewItems.length ? `· ${reviewItems.length}건` : ""}</summary>
            <MeetingReviewEditor items={reviewItems} members={members} terms={meetingTerms} onChange={setReviewItems} disabled={busy}/>
            {reviewErrors.length>0&&<p className="field-hint" role="status">{reviewErrors[0]}</p>}
            {linkedDocuments ? (
              <p className="field-hint">
                📁 문서함 반영됨
                {linkedDocuments.summaryId ? (
                  <>
                    {" · "}
                    <Link href={`/knowledge?document=${linkedDocuments.summaryId}`}>요약 보기</Link>
                  </>
                ) : null}
                {linkedDocuments.rawId ? (
                  <>
                    {" · "}
                    <Link href={`/knowledge?document=${linkedDocuments.rawId}`}>원문 보기</Link>
                  </>
                ) : null}
              </p>
            ) : null}
            <div className="form-grid">
              <label>
                <span>직접 추가할 결정 · 한 줄에 하나</span>
                <textarea name="decisions" rows={4} value={manualDecisions} onChange={event=>setManualDecisions(event.target.value)}/>
              </label>
              <label>
                <span>직접 추가할 업무 · 한 줄에 하나</span>
                <textarea name="actions" rows={4} value={manualTasks} onChange={event=>setManualTasks(event.target.value)}/>
              </label>
            </div>
            <button type="button" className="secondary-button" disabled={busy||(!manualDecisions.trim()&&!manualTasks.trim())} onClick={()=>{const lines=(text:string)=>text.split("\n").map(line=>line.replace(/^[-*]\s*/,"").trim()).filter(Boolean);setReviewItems(previous=>[...previous,...makeMeetingReview({decisions:lines(manualDecisions),pending:[],todos:lines(manualTasks).map(title=>({title,assignee:"",dueDate:"",dueLabel:""}))},members,undefined,meetingTerms)]);setManualDecisions("");setManualTasks("");}}>직접 입력을 검수에 추가</button>
            </details>
            {reviewErrors.length>0&&<p className="field-hint" role="status">후속 업무를 확인해 주세요: {reviewErrors[0]}</p>}
            <div className="drawer-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setDrawerOpen(false)}
              >
                취소
              </button>
              <button className="primary-button" disabled={busy || recording || reviewErrors.length>0 || Boolean(manualDecisions.trim()||manualTasks.trim())}>
                {busy ? "저장 중…" : "검수 확정·회의 저장"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
