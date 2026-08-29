"use client";

import { AudioLines, Bot, CalendarDays, CircleAlert, FileAudio, GitBranch, Mic, Play, Plus, Square, Users, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createRecord, getMeetingRecordingUrl, listRecords, summarizeMeeting, updateRecord, uploadMeetingRecording } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

function meta(record: OsRecord | null, key: string) {
  const value = record?.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function dateTime(value: string | null) {
  if (!value) return "일정 미정";
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const load = useCallback(async () => {
    if (demo) return;
    try {
      const [meetingResult, decisionResult, taskResult] = await Promise.all([
        listRecords(accessToken, "meeting", "limit=200"), listRecords(accessToken, "decision", "limit=200"), listRecords(accessToken, "task", "limit=200"),
      ]);
      setMeetings(meetingResult.records); setDecisions(decisionResult.records); setTasks(taskResult.records); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "회의 기록을 불러오지 못했습니다."); }
  }, [accessToken, demo]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setSummary(""); setSummaryMode(""); setTranscript(""); setRecordedBlob(null); setDrawerOpen(true); };
  const openEdit = (meeting: OsRecord) => { setEditing(meeting); setSummary(meta(meeting, "summary")); setSummaryMode(meta(meeting, "summaryMode") as "ai" | "local" | ""); setTranscript(meta(meeting, "transcript")); setRecordedBlob(null); setDrawerOpen(true); };

  const startRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        if (blob.size > 4_000_000) setError("녹음이 4MB를 넘었습니다. 약 15분 단위로 나누어 녹음해 주세요.");
        else setRecordedBlob(blob);
        setRecording(false);
      };
      recorder.start(1000); recorderRef.current = recorder; setRecording(true);
    } catch { setError("마이크 권한을 허용해야 회의를 녹음할 수 있습니다."); }
  };

  const stopRecording = () => { if (recorderRef.current?.state === "recording") recorderRef.current.stop(); };

  const makeSummary = async () => {
    if (transcript.trim().length < 20) { setError("먼저 회의 원문을 20자 이상 입력해 주세요."); return; }
    setBusy(true); setError("");
    try { const result = await summarizeMeeting(accessToken, transcript); setSummary(result.summary); setSummaryMode(result.mode); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "회의를 요약하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const playRecording = async (path: string) => {
    try { const { url } = await getMeetingRecordingUrl(accessToken, path); window.open(url, "_blank", "noopener,noreferrer"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "녹음을 열지 못했습니다."); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    setBusy(true); setError("");
    try {
      let recordingPath = meta(editing, "recordingPath");
      if (recordedBlob) ({ path: recordingPath } = await uploadMeetingRecording(accessToken, recordedBlob));
      const input = {
        recordType: "meeting", title: value("title"), description: value("agenda"), status: value("status"), priority: "normal",
        team: value("team"), brand: value("brand"), startsAt: value("startsAt") ? new Date(value("startsAt")).toISOString() : null,
        tags: value("participants").split(",").map((item) => item.trim()).filter(Boolean),
        metadata: { ...(editing?.metadata ?? {}), participants: value("participants"), recordingPath, transcript, summary, summaryMode },
      };
      let meeting: OsRecord;
      if (editing) ({ record: meeting } = await updateRecord(accessToken, { ...input, id: editing.id, expectedVersion: editing.version }));
      else ({ record: meeting } = await createRecord(accessToken, input));

      const decisionLines = value("decisions").split("\n").map((line) => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
      const taskLines = value("actions").split("\n").map((line) => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
      for (const title of decisionLines) await createRecord(accessToken, { recordType: "decision", parentId: meeting.id, title, description: `회의: ${meeting.title}`, status: "decided", team: meeting.team, brand: meeting.brand, metadata: { meetingId: meeting.id } });
      for (const title of taskLines) await createRecord(accessToken, { recordType: "task", parentId: meeting.id, title, description: `회의 후속 업무: ${meeting.title}`, status: "planned", team: meeting.team, brand: meeting.brand, metadata: { meetingId: meeting.id } });
      setDrawerOpen(false); setEditing(null); setRecordedBlob(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "회의를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const upcoming = meetings.filter((meeting) => meeting.status === "planned").length;
  const summarized = meetings.filter((meeting) => meta(meeting, "summary")).length;
  const meetingDecisions = decisions.filter((item) => item.parent_id && meetings.some((meeting) => meeting.id === item.parent_id));
  const meetingTasks = tasks.filter((item) => item.parent_id && meetings.some((meeting) => meeting.id === item.parent_id));

  return <>
    <header className="page-header"><div className="page-title-group"><span className="eyebrow">MEETING TO ACTION</span><h1>회의·결정</h1><p>녹음 원본과 요약을 보존하고 결정사항을 후속 업무로 바로 연결합니다.</p></div><button className="primary-button" onClick={openNew}><Plus size={16} /> 회의 기록</button></header>
    {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}
    <section className="metric-grid compact-metrics"><div className="metric-card"><div className="metric-top"><span>예정 회의</span><span className="metric-icon"><CalendarDays size={16} /></span></div><div className="metric-value">{upcoming}</div><div className="metric-caption">일정 대기</div></div><div className="metric-card"><div className="metric-top"><span>요약 완료</span><span className="metric-icon"><Bot size={16} /></span></div><div className="metric-value">{summarized}</div><div className="metric-caption good">원문 기반 요약</div></div><div className="metric-card"><div className="metric-top"><span>결정사항</span><span className="metric-icon"><GitBranch size={16} /></span></div><div className="metric-value">{meetingDecisions.length}</div><div className="metric-caption">회의에서 생성</div></div><div className="metric-card"><div className="metric-top"><span>후속 업무</span><span className="metric-icon"><AudioLines size={16} /></span></div><div className="metric-value">{meetingTasks.filter((item) => item.status !== "done").length}</div><div className="metric-caption warn">완료 전 실행</div></div></section>
    <section className="meeting-grid">{meetings.map((meeting) => { const linkedDecisions = decisions.filter((item) => item.parent_id === meeting.id); const linkedTasks = tasks.filter((item) => item.parent_id === meeting.id); return <article className="panel meeting-card" key={meeting.id} onClick={() => openEdit(meeting)}><header><div><span className={`status-pill status-${meeting.status}`}>{meeting.status === "planned" ? "예정" : meeting.status === "done" ? "완료" : "진행"}</span><h2>{meeting.title}</h2><p>{dateTime(meeting.starts_at)} · {meeting.team || "전체 팀"}</p></div>{meta(meeting, "recordingPath") ? <button className="icon-button" aria-label="녹음 재생" onClick={(event) => { event.stopPropagation(); playRecording(meta(meeting, "recordingPath")); }}><Play size={16} /></button> : <FileAudio size={18} />}</header><p>{meta(meeting, "summary")?.replace(/^#+\s*/gm, "").slice(0, 180) || meeting.description || "회의 요약이 아직 없습니다."}</p><footer><span><GitBranch size={13} /> 결정 {linkedDecisions.length}</span><span><AudioLines size={13} /> 후속 업무 {linkedTasks.length}</span><span><Users size={13} /> {meeting.tags.length || 0}명</span></footer></article>; })}{!meetings.length ? <div className="panel empty-state"><div><span><Mic /></span><h3>첫 회의를 기록하세요.</h3><p>녹음·원문·결정·후속 업무가 하나의 회의에 연결됩니다.</p><button className="primary-button" onClick={openNew}>회의 기록</button></div></div> : null}</section>
    {drawerOpen ? <div className="drawer-backdrop" onMouseDown={() => !busy && setDrawerOpen(false)}><form className="record-drawer meeting-drawer" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">MEETING RECORD</span><h2>{editing ? "회의 기록 수정" : "새 회의 기록"}</h2></div><button type="button" className="icon-button" onClick={() => setDrawerOpen(false)}><X size={18} /></button></div><label><span>회의명</span><input name="title" required defaultValue={editing?.title ?? ""} /></label><div className="form-grid"><label><span>일시</span><input type="datetime-local" name="startsAt" defaultValue={editing?.starts_at?.slice(0, 16) ?? ""} /></label><label><span>상태</span><select name="status" defaultValue={editing?.status ?? "planned"}><option value="planned">예정</option><option value="active">진행 중</option><option value="done">완료</option><option value="cancelled">취소</option></select></label></div><div className="form-grid"><label><span>브랜드</span><input name="brand" defaultValue={editing?.brand ?? ""} /></label><label><span>담당 팀</span><input name="team" defaultValue={editing?.team || profile?.team || ""} /></label></div><label><span>참석자</span><input name="participants" defaultValue={meta(editing, "participants") || editing?.tags.join(", ") || ""} placeholder="리키, 데이빗, 에릭" /></label><label><span>안건</span><textarea name="agenda" rows={4} defaultValue={editing?.description ?? ""} /></label><div className="recording-panel"><div><Mic size={18} /><span><strong>{recording ? "녹음 중" : recordedBlob ? "새 녹음 준비됨" : meta(editing, "recordingPath") ? "녹음 원본 저장됨" : "회의 녹음"}</strong><small>4MB 이하 · 약 15분 단위 권장</small></span></div>{recording ? <button type="button" className="danger-button" onClick={stopRecording}><Square size={14} /> 녹음 종료</button> : <button type="button" className="secondary-button" onClick={startRecording}><Mic size={14} /> {recordedBlob ? "다시 녹음" : "녹음 시작"}</button>}</div><label><span>회의 원문·전사</span><textarea rows={9} value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="회의 녹취 또는 직접 정리한 원문을 붙여넣으세요." /></label><button type="button" className="secondary-button summary-button" disabled={busy || transcript.trim().length < 20} onClick={makeSummary}><Bot size={15} /> {busy ? "요약 중…" : "AI 회의 요약 만들기"}</button><label><span>회의 요약 {summaryMode ? `· ${summaryMode === "ai" ? "AI" : "로컬 보조"}` : ""}</span><textarea rows={9} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="핵심 요약·결정사항·후속 업무" /></label><div className="form-grid"><label><span>새 결정사항 · 한 줄에 하나</span><textarea name="decisions" rows={5} placeholder="신규 가격 정책 확정" /></label><label><span>새 후속 업무 · 한 줄에 하나</span><textarea name="actions" rows={5} placeholder="상세페이지 문구 수정" /></label></div><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setDrawerOpen(false)}>취소</button><button className="primary-button" disabled={busy || recording}>{busy ? "저장 중…" : "회의·후속 업무 저장"}</button></div></form></div> : null}
  </>;
}
