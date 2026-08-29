"use client";

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
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  createRecord,
  getMeetingRecordingUrl,
  listRecords,
  prepareMeeting,
  summarizeMeeting,
  transcribeMeeting,
  updateRecord,
  type MeetingSummaryResult,
} from "@/lib/api-client";
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

export function MeetingWorkspace() {
  const { accessToken, demo, profile } = useSession();
  const [meetings, setMeetings] = useState<OsRecord[]>([]);
  const [decisions, setDecisions] = useState<OsRecord[]>([]);
  const [tasks, setTasks] = useState<OsRecord[]>([]);
  const [editing, setEditing] = useState<OsRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [summary, setSummary] = useState("");
  const [summaryMode, setSummaryMode] = useState<"ai" | "local" | "">("");
  const [transcript, setTranscript] = useState("");
  const [structured, setStructured] = useState<MeetingSummaryResult | null>(
    null,
  );
  const [prep, setPrep] = useState<Awaited<
    ReturnType<typeof prepareMeeting>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const load = useCallback(async () => {
    if (demo) return;
    try {
      const [meetingResult, decisionResult, taskResult] = await Promise.all([
        listRecords(accessToken, "meeting", "limit=200"),
        listRecords(accessToken, "decision", "limit=200"),
        listRecords(accessToken, "task", "limit=200"),
      ]);
      setMeetings(meetingResult.records);
      setDecisions(decisionResult.records);
      setTasks(taskResult.records);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "회의 기록을 불러오지 못했습니다.",
      );
    }
  }, [accessToken, demo]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setEditing(null);
    setSummary("");
    setSummaryMode("");
    setTranscript("");
    setStructured(null);
    setRecordedBlob(null);
    setDrawerOpen(true);
  };
  const openEdit = (meeting: OsRecord) => {
    setEditing(meeting);
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
        if (blob.size > 4_000_000)
          setError(
            "녹음이 4MB를 넘었습니다. 약 15분 단위로 나누어 녹음해 주세요.",
          );
        else setRecordedBlob(blob);
        setRecording(false);
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

  const makeSummary = async () => {
    if (transcript.trim().length < 20) {
      setError("먼저 회의 원문을 20자 이상 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await summarizeMeeting(
        accessToken,
        transcript,
        editing?.starts_at?.slice(0, 10),
      );
      setSummary(result.summary);
      setSummaryMode(result.mode);
      setStructured(result);
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

  const makeTranscript = async () => {
    if (!recordedBlob) return;
    setBusy(true);
    setError("");
    try {
      const result = await transcribeMeeting(accessToken, recordedBlob);
      setTranscript(result.transcript);
      setRecordedBlob(null);
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

  const loadPrep = async () => {
    setBusy(true);
    setError("");
    try {
      setPrep(await prepareMeeting(accessToken));
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
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    setBusy(true);
    setError("");
    try {
      const recordingPath = meta(editing, "recordingPath");
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
          decisions: structured?.decisions ?? [],
          pending: structured?.pending ?? [],
          todos: structured?.todos ?? [],
        },
      };
      let meeting: OsRecord;
      if (editing)
        ({ record: meeting } = await updateRecord(accessToken, {
          ...input,
          id: editing.id,
          expectedVersion: editing.version,
        }));
      else ({ record: meeting } = await createRecord(accessToken, input));

      const decisionLines = value("decisions")
        .split("\n")
        .map((line) => line.replace(/^[-*]\s*/, "").trim())
        .filter(Boolean);
      const taskLines = value("actions")
        .split("\n")
        .map((line) => line.replace(/^[-*]\s*/, "").trim())
        .filter(Boolean);
      const existingDecisionTitles = new Set(
        decisions
          .filter((item) => item.parent_id === meeting.id)
          .map((item) => item.title),
      );
      for (const title of [
        ...new Set([...(structured?.decisions ?? []), ...decisionLines]),
      ].filter((item) => !existingDecisionTitles.has(item)))
        await createRecord(accessToken, {
          recordType: "decision",
          parentId: meeting.id,
          title,
          description: `회의: ${meeting.title}`,
          status: "decided",
          team: meeting.team,
          brand: meeting.brand,
          metadata: { meetingId: meeting.id, source: "meeting" },
        });
      const todoRows = [
        ...(structured?.todos ?? []),
        ...taskLines.map((title) => ({
          title,
          assignee: "",
          dueDate: "",
          dueLabel: "",
        })),
      ];
      const existingTaskTitles = new Set(
        tasks
          .filter((item) => item.parent_id === meeting.id)
          .map((item) => item.title),
      );
      for (const todo of todoRows.filter(
        (item) => !existingTaskTitles.has(item.title),
      ))
        await createRecord(accessToken, {
          recordType: "task",
          parentId: meeting.id,
          title: todo.title,
          description: `회의 후속 업무: ${meeting.title}${todo.assignee ? ` · 담당 ${todo.assignee}` : ""}${todo.dueLabel ? ` · ${todo.dueLabel}` : ""}`,
          status: "planned",
          team: meeting.team,
          brand: meeting.brand,
          dueDate: todo.dueDate || null,
          metadata: {
            meetingId: meeting.id,
            source: "meeting",
            assigneeName: todo.assignee,
            dueLabel: todo.dueLabel,
          },
        });
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
      setBusy(false);
    }
  };

  const upcoming = meetings.filter(
    (meeting) => meeting.status === "planned",
  ).length;
  const summarized = meetings.filter((meeting) =>
    meta(meeting, "summary"),
  ).length;
  const meetingDecisions = decisions.filter(
    (item) =>
      item.parent_id &&
      meetings.some((meeting) => meeting.id === item.parent_id),
  );
  const meetingTasks = tasks.filter(
    (item) =>
      item.parent_id &&
      meetings.some((meeting) => meeting.id === item.parent_id),
  );

  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <span className="eyebrow">MEETING TO ACTION</span>
          <h1>회의·결정</h1>
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
              <p>
                {prep.latestMeeting
                  ? `이전 회의 “${prep.latestMeeting.title}”에서 이어집니다.`
                  : "첫 회의용 안건입니다."}
              </p>
            </div>
            <button className="icon-button" onClick={() => setPrep(null)}>
              <X size={16} />
            </button>
          </div>
          <div className="meeting-prep-grid">
            <div>
              <strong>미해결 안건</strong>
              {prep.pending.map((item) => (
                <p key={item}>• {item}</p>
              ))}
              {!prep.pending.length ? <p>남은 안건이 없습니다.</p> : null}
            </div>
            <div>
              <strong>완료 전 업무</strong>
              {prep.todos.slice(0, 8).map((item) => (
                <p key={item.id}>
                  • {item.title}
                  {item.due_date ? ` · ${item.due_date}` : ""}
                </p>
              ))}
              {!prep.todos.length ? <p>미완료 업무가 없습니다.</p> : null}
            </div>
            <div>
              <strong>주간 KPI 안건</strong>
              {prep.kpis.slice(0, 8).map((item) => (
                <p key={item.id}>
                  • {item.title} {item.current}
                  {item.unit} · {item.signal}
                </p>
              ))}
              {!prep.kpis.length ? <p>주간 KPI를 먼저 입력해 주세요.</p> : null}
            </div>
          </div>
        </section>
      ) : null}
      <section className="meeting-grid">
        {meetings.map((meeting) => {
          const linkedDecisions = decisions.filter(
            (item) => item.parent_id === meeting.id,
          );
          const linkedTasks = tasks.filter(
            (item) => item.parent_id === meeting.id,
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
                <span className="eyebrow">MEETING RECORD</span>
                <h2>{editing ? "회의 기록 수정" : "새 회의 기록"}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setDrawerOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="meeting-phases">
              <span className="done"><b>1</b> 준비</span>
              <span className={transcript ? "done" : "active"}><b>2</b> 진행·전사</span>
              <span className={structured ? "done" : ""}><b>3</b> 결정·실행</span>
            </div>
            <label>
              <span>회의명</span>
              <input
                name="title"
                required
                defaultValue={editing?.title ?? ""}
              />
            </label>
            <div className="form-grid">
              <label>
                <span>일시</span>
                <input
                  type="datetime-local"
                  name="startsAt"
                  defaultValue={editing?.starts_at?.slice(0, 16) ?? ""}
                />
              </label>
              <label>
                <span>상태</span>
                <select
                  name="status"
                  defaultValue={editing?.status ?? "planned"}
                >
                  <option value="planned">예정</option>
                  <option value="active">진행 중</option>
                  <option value="done">완료</option>
                  <option value="cancelled">취소</option>
                </select>
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
              <span>참석자</span>
              <input
                name="participants"
                defaultValue={
                  meta(editing, "participants") ||
                  editing?.tags.join(", ") ||
                  ""
                }
                placeholder="리키, 데이빗, 에릭"
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
            {structured ? (
              <div className="structured-meeting">
                <div>
                  <strong>결정사항 {structured.decisions.length}</strong>
                  {structured.decisions.map((item) => (
                    <p key={item}>• {item}</p>
                  ))}
                </div>
                <div>
                  <strong>미해결 {structured.pending.length}</strong>
                  {structured.pending.map((item) => (
                    <p key={item}>• {item}</p>
                  ))}
                </div>
                <div>
                  <strong>후속 업무 {structured.todos.length}</strong>
                  {structured.todos.map((item) => (
                    <p key={item.title}>
                      • {item.title}
                      {item.assignee ? ` · ${item.assignee}` : ""}
                      {item.dueDate || item.dueLabel
                        ? ` · ${item.dueDate || item.dueLabel}`
                        : ""}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="form-grid">
              <label>
                <span>직접 추가할 결정 · 한 줄에 하나</span>
                <textarea name="decisions" rows={4} />
              </label>
              <label>
                <span>직접 추가할 업무 · 한 줄에 하나</span>
                <textarea name="actions" rows={4} />
              </label>
            </div>
            <div className="drawer-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDrawerOpen(false)}
              >
                취소
              </button>
              <button className="primary-button" disabled={busy || recording}>
                {busy ? "저장 중…" : "회의·후속 업무 저장"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
