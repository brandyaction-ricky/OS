"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiRequest, summarizeMeeting, transcribeMeeting, type OsMember } from "@/lib/api-client";
import { RecorderProgress, useSegmentedRecorder } from "@/components/meeting-recorder";
import { matchMeetingAssignee } from "@/lib/meeting-review";
import { downloadMarkdown, meetingFileName, meetingMarkdown } from "@/lib/meeting-markdown";
import { kstMonth } from "@/lib/kpi";
import { activeRuns } from "@/lib/kpi-runs";
import type { Meeting, MeetingItem } from "@/lib/knowledge/model";
import type { OsRecord } from "@/lib/record-types";
import { wordSimilarity } from "@/lib/team/duplicates";
import { TEAM_BUSINESSES, teamBrand, teamBusiness } from "@/lib/team/business";
import { teamCommand } from "@/lib/team/client";
import { MeetingBoard, type MeetingNote } from "./meeting-board";
import { audioMinutes, CostTag, fileAsk, recordAsk, summaryAsk, useCostConfirm, useCostModels } from "@/components/cost-notice";

function kstInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 16);
}
function kstIso(value: string) { return value ? new Date(`${value}+09:00`).toISOString() : null; }
function message(error: unknown) { return error instanceof Error ? error.message : "저장하지 못했습니다."; }

export function CreateTeamMeeting({ token, projects, onChanged, initialBusiness = "", previousMeetingId }: { token: string; projects: OsRecord[]; onChanged: () => Promise<void>; initialBusiness?: string; previousMeetingId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [title, setTitle] = useState(""), [business, setBusiness] = useState(initialBusiness), [projectId, setProjectId] = useState(""), [startsAt, setStartsAt] = useState(""), [visibility, setVisibility] = useState("team");
  async function create() {
    setBusy(true); setError("");
    try {
      const result = await teamCommand(token, { action: "meeting.create", title: title.trim(), brand: teamBrand(business), projectId: projectId || null, previousMeetingId, startsAt: kstIso(startsAt), visibility });
      await onChanged(); setOpen(false); router.push(`/organization/meetings?meeting=${encodeURIComponent(result.id)}`);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <><button type="button" className="primary-button compact" onClick={() => setOpen(true)}>＋ 회의 기록</button>{open ? <div className="modal-backdrop"><section className="form-modal" role="dialog" aria-modal="true" aria-label="회의 기록 만들기"><div className="drawer-head"><h2>회의 기록 만들기</h2><button className="secondary-button compact" onClick={() => setOpen(false)}>닫기</button></div><div className="tm-modal-body"><label>회의 제목<input value={title} maxLength={240} onChange={event => setTitle(event.target.value)} /></label><label>사업 <span className="tm-required">필수</span><select value={business} onChange={event => setBusiness(event.target.value)}><option value="">사업 선택</option>{TEAM_BUSINESSES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label>프로젝트<select value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">프로젝트 없음</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><label>예정 일시<input type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>공유<select value={visibility} onChange={event => setVisibility(event.target.value)}><option value="team">팀 공유</option><option value="attendees">참석자만</option></select></label>{error ? <p role="alert" className="tm-danger-text">{error}</p> : null}<button className="primary-button compact" disabled={busy || !business} onClick={() => void create()}>{busy ? "저장 중…" : "회의 만들기"}</button></div></section></div> : null}</>;
}

export function TeamMeetingDetail({ meeting, meetings, tasks, token, userId, admin, members, projects, onChanged }: { meeting: Meeting; meetings: Meeting[]; tasks: OsRecord[]; token: string; userId?: string; admin: boolean; members: OsMember[]; projects: OsRecord[]; onChanged: () => Promise<void> }) {
  const router = useRouter(), params = useSearchParams(), tab = params.get("t") ?? "sum";
  const [title, setTitle] = useState(meeting.title), [brand, setBrand] = useState(teamBusiness(meeting.brand ?? "")?.key ?? ""), [projectId, setProjectId] = useState(meeting.metadata.projectId ?? "");
  const [startsAt, setStartsAt] = useState(kstInput(meeting.starts_at)), [agenda, setAgenda] = useState(meeting.metadata.agenda ?? "");
  const [content, setContent] = useState(meeting.description ?? ""), [summary, setSummary] = useState(meeting.metadata.summary ?? "");
  const [items, setItems] = useState<MeetingItem[]>(meeting.metadata.items), [itemKind, setItemKind] = useState<MeetingItem["kind"]>("decision"), [itemText, setItemText] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [correction, setCorrection] = useState(""), [reason, setReason] = useState("");
  // Long meetings: recorded in 10-minute segments, each transcribed and appended in order.
  const recorder = useSegmentedRecorder({ token, onTranscript: text => setContent(current => [current, text].filter(Boolean).join("\n\n")) });
  const [visibility, setVisibility] = useState<"team" | "attendees">(meeting.metadata.visibility), [attendees, setAttendees] = useState(meeting.attendees);
  // ai: the running (startedAt) or finished (done) AI pass; autoAi: run it once the last recorded segment is transcribed.
  const [notes, setNotes] = useState<MeetingNote[]>([]), [ai, setAi] = useState<{ startedAt: number; done?: string } | null>(null), [tick, setTick] = useState(0), [autoAi, setAutoAi] = useState(false);
  const owner = admin || meeting.owner_id === userId;
  // Recording (OpenAI speech-to-text) and AI 정리 (Claude) spend company money: ask first, like the other paid buttons.
  const cost = useCostConfirm(), models = useCostModels();
  const askAi = () => cost.confirm({ ...summaryAsk(models.sonnet, content), ok: "확인하고 정리" });
  const askRecording = () => cost.confirm({ ...recordAsk(models.transcribe), ok: "동의 확인 · 녹음 시작" });
  const related = meetings.filter(item => item.id !== meeting.id && item.brand === meeting.brand && item.metadata.visibility === "team" && item.starts_at).sort((a,b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? ""));
  const nextMeeting = related.find(item => item.starts_at! > (meeting.starts_at ?? ""));
  const previousMeeting = related.filter(item => item.starts_at! < (meeting.starts_at ?? "")).at(-1);
  const linkedTasks = tasks.filter(task => task.parent_id === meeting.id || task.metadata.meetingId === meeting.id);
  const canEdit = !meeting.legacy && meeting.status !== "done" && (admin || meeting.attendees.includes(userId ?? "")) && (meeting.status !== "review" || owner);
  const base = `/organization/meetings?meeting=${encodeURIComponent(meeting.id)}`;
  const live = !meeting.legacy && meeting.status !== "done";
  const loadNotes = useCallback(async () => {
    try { const result = await apiRequest<{ activity: (MeetingNote & { event_type: string })[] }>(`/api/v1/team/task-comments?id=${encodeURIComponent(meeting.id)}`, { token }); setNotes(result.activity.filter(item => item.event_type === "comment").reverse()); }
    catch { setNotes([]); }
  }, [meeting.id, token]);
  // Others add notes from their own screens during the meeting: pick them up every 20 seconds.
  useEffect(() => { void loadNotes(); if (!live) return; const timer = window.setInterval(() => void loadNotes(), 20_000); return () => window.clearInterval(timer); }, [loadNotes, live]);
  useEffect(() => { if (!ai || ai.done) return; const timer = window.setInterval(() => setTick(Date.now()), 1000); return () => window.clearInterval(timer); }, [ai]);
  useEffect(() => {
    if (!autoAi || recorder.recording || recorder.segments.some(segment => segment.state === "waiting" || segment.state === "working")) return;
    setAutoAi(false);
    if (!recorder.segments.some(segment => segment.state === "failed")) void extract();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per stop, after the transcripts land
  }, [autoAi, recorder.recording, recorder.segments]);
  const dirty = title !== meeting.title || content !== meeting.description || agenda !== meeting.metadata.agenda || summary !== (meeting.metadata.summary ?? "") || startsAt !== kstInput(meeting.starts_at) || JSON.stringify(items) !== JSON.stringify(meeting.metadata.items) || visibility !== meeting.metadata.visibility || JSON.stringify(attendees) !== JSON.stringify(meeting.attendees) || (teamBrand(brand) ?? "") !== (meeting.brand ?? "") || projectId !== (meeting.metadata.projectId ?? "");
  const saveFields = () => ({ title, startsAt: kstIso(startsAt), content, agenda, summary, items,
    ...(owner && teamBrand(brand) !== meeting.brand ? { brand: teamBrand(brand) } : {}),
    ...(owner && projectId !== (meeting.metadata.projectId ?? "") ? { projectId: projectId || null } : {}),
    ...(owner && visibility !== meeting.metadata.visibility ? { visibility } : {}),
    ...(owner && JSON.stringify(attendees) !== JSON.stringify(meeting.attendees) ? { attendees } : {}),
  });
  async function execute(action: "meeting.save" | "meeting.start" | "meeting.finish" | "meeting.correct" | "meeting.import_legacy", extra: Record<string, unknown> = {}) {
    setBusy(true); setError("");
    try {
      if (action === "meeting.import_legacy") {
        const result = await teamCommand(token, { action, legacyId: meeting.id, brand: teamBrand(brand), ...extra });
        await onChanged(); router.push(`/organization/meetings?meeting=${encodeURIComponent(result.id)}&step=review`); return;
      }
      let version = meeting.version;
      if (dirty && action !== "meeting.save" && action !== "meeting.correct") {
        const saved = await teamCommand(token, { action: "meeting.save", id: meeting.id, expectedVersion: version, ...saveFields() });
        version = saved.version ?? version + 1;
      }
      await teamCommand(token, { action, id: meeting.id, expectedVersion: version, ...(action === "meeting.save" ? saveFields() : {}), ...extra });
      await onChanged();
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  // Moves the meeting and its page to the trash; refused while decisions or tasks still hang off it.
  async function archive() {
    if (!window.confirm(`「${meeting.title || "제목 없음"}」 회의를 삭제할까요? 휴지통으로 옮겨지고, 연결된 결정·업무가 있으면 지워지지 않습니다.`)) return;
    setBusy(true); setError("");
    try { await teamCommand(token, { action: "meeting.archive", id: meeting.id, expectedVersion: meeting.version, reason: "회의 화면에서 삭제" }); await onChanged(); router.push("/organization/meetings"); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  // Claude reads the notes plus the attendees' memos. The result is saved at once, so closing the
  // page loses nothing; running it again replaces earlier AI candidates nobody has reviewed yet.
  async function extract() {
    if (content.trim().length < 20) { setError("메모는 20자 이상 입력해 주세요."); return; }
    setBusy(true); setError(""); setAi({ startedAt: Date.now() }); setTick(Date.now());
    try {
      const memo = notes.length ? `\n\n[참석자 메모]\n${notes.map(note => `${members.find(member => member.id === note.actor_id)?.display_name ?? "구성원"}: ${note.note}`).join("\n")}` : "";
      const result = await summarizeMeeting(token, content + memo, meeting.starts_at?.slice(0, 10), teamBrand(brand) ?? undefined);
      const next = [...items.filter(item => !(item.source === "ai" && item.state === "pending")),
        ...result.decisions.map(text => ({ id: crypto.randomUUID(), kind: "decision" as const, text, state: "pending" as const, source: "ai" as const })),
        // A to-do nobody took on and nobody dated is a direction the meeting settled: it starts as 결정 (대표 요청 2026-10-30).
        ...result.todos.map(todo => { const ownerId = matchMeetingAssignee(todo.assignee ?? "", members) || undefined, dueOn = todo.dueDate || undefined; return { id: crypto.randomUUID(), kind: ownerId || dueOn ? "task" as const : "decision" as const, text: todo.title, ownerId, dueOn, state: "pending" as const, source: "ai" as const }; }),
        ...result.pending.map(text => ({ id: crypto.randomUUID(), kind: "open" as const, text, state: "pending" as const, source: "ai" as const })),
      ];
      setSummary(result.summary); setItems(next);
      await teamCommand(token, { action: "meeting.save", id: meeting.id, expectedVersion: meeting.version, ...saveFields(), summary: result.summary, items: next });
      await onChanged();
      setAi({ startedAt: 0, done: `정리 완료 · 결정 ${result.decisions.length} · 업무 ${result.todos.length} · 미결 ${result.pending.length} 후보를 저장했습니다. 다음은 「회의 종료 · 검토로」입니다.` });
    } catch (cause) { setAi(null); setError(`${message(cause)} 회의 메모는 「변경 저장」으로 보관할 수 있습니다.`); } finally { setBusy(false); }
  }
  async function startMeeting() {
    if (meeting.starts_at && Date.parse(meeting.starts_at) > Date.now() && !window.confirm("예정 시각보다 일찍 회의를 시작할까요?")) return;
    const record = await askRecording();
    await execute("meeting.start");
    if (record && !recorder.recording) void recorder.start();
  }
  async function stopRecording() { const run = await askAi(); recorder.stop(); if (run) setAutoAi(true); }
  // Ends the meeting and opens review. A meeting that was never started (notes recorded straight away) is started first.
  async function finishMeeting() {
    setBusy(true); setError("");
    try {
      let version = meeting.version;
      if (dirty) version = (await teamCommand(token, { action: "meeting.save", id: meeting.id, expectedVersion: version, ...saveFields() })).version ?? version + 1;
      if (meeting.status === "planned") version = (await teamCommand(token, { action: "meeting.start", id: meeting.id, expectedVersion: version })).version ?? version + 1;
      await teamCommand(token, { action: "meeting.finish", id: meeting.id, expectedVersion: version });
      await onChanged(); if (owner) router.push(`${base}&step=review`);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function shareTelegram() {
    if (!window.confirm("이 회의 정리를 사업별 텔레그램 방에 올릴까요?")) return;
    setBusy(true); setError("");
    try { const result = await teamCommand(token, { action: "meeting.share", id: meeting.id }) as { sent?: number }; window.alert(`텔레그램 방 ${result.sent ?? 0}곳에 올렸어요.`); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function carry(text: string) {
    const next = [...items, { id: crypto.randomUUID(), kind: "open" as const, text, state: "pending" as const, source: "manual" as const }];
    await teamCommand(token, { action: "meeting.save", id: meeting.id, expectedVersion: meeting.version, ...saveFields(), items: next });
    setItems(next); await onChanged();
  }
  async function fileTranscript(file: File | undefined) {
    if (!file) return;
    if (!await cost.confirm({ ...fileAsk(models.transcribe, await audioMinutes(file)), ok: "확인하고 받아쓰기" })) return;
    setBusy(true); setError("");
    try { const result = await transcribeMeeting(token, file); setContent(current => [current, result.transcript].filter(Boolean).join("\n\n")); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  // The step bar marks the next thing to do; the header offers exactly that one action.
  const hasAi = Boolean(summary.trim()) || items.some(item => item.source === "ai");
  const step = meeting.status === "done" ? 4 : meeting.status === "review" || hasAi ? 3 : content.trim().length >= 20 && !recorder.recording ? 2 : recorder.recording || meeting.status === "active" ? 1 : 0;
  const primary = recorder.recording ? <><button type="button" className="primary-button compact" onClick={() => void stopRecording()}>■ 녹음 종료 · 자동 정리</button><CostTag kind="paid" /></>
    : hasAi ? <button type="button" className="primary-button compact" disabled={busy} onClick={() => void finishMeeting()}>회의 종료 · 검토로</button>
    : content.trim().length >= 20 ? <><button type="button" className="primary-button compact" disabled={busy} onClick={() => void askAi().then(ok => { if (ok) void extract(); })}>회의 자동 정리</button><CostTag kind="paid" /></>
    : meeting.status === "planned" ? <><button type="button" className="primary-button compact" disabled={busy} onClick={() => void startMeeting()}>회의 시작 · 녹음</button><CostTag kind="paid" /></>
    : <><button type="button" className="primary-button compact" disabled={busy} onClick={() => void askRecording().then(ok => { if (ok) void recorder.start(); })}>● 녹음 시작</button><CostTag kind="paid" /></>;
  const selectedItems = items.filter(item => item.state !== "discarded" && item.kind === (tab === "dec" ? "decision" : tab === "task" ? "task" : "open"));
  return <><Link className="tm-back" href="/organization/meetings">← 회의 기록</Link><div className="tm-detail-head"><div className="tm-grow"><h2 className="tm-detail-title">{meeting.title}</h2><div className="tm-meeting-meta"><span>{meeting.starts_at ? new Date(meeting.starts_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "일정 미정"}</span><span>{meeting.legacy ? "이전 기록" : meeting.status === "review" ? "검토 필요" : meeting.status === "done" ? "확정" : meeting.status === "active" ? "진행 중" : "예정"}</span><span>{teamBusiness(meeting.brand ?? "")?.label ?? "사업 미지정"}</span><span>참석 {meeting.attendees.length}명</span></div></div><div className="tm-row"><button type="button" className="secondary-button compact" onClick={() => downloadMarkdown(meetingFileName(title, meeting.starts_at), meetingMarkdown({ title, startsAt: meeting.starts_at, business: teamBusiness(brand)?.label, attendees, agenda, summary, transcript: content, items, nameOf: id => members.find(member => member.id === id)?.display_name ?? "구성원" }))}>MD로 내려받기</button>{meeting.legacy && meeting.status === "review" && owner ? <button className="primary-button compact" disabled={busy || !brand} onClick={() => void execute("meeting.import_legacy")}>새 기록으로 옮겨 검토</button> : null}{meeting.status === "review" && !meeting.legacy && owner ? <Link className="primary-button compact" href={`${base}&step=review`}>검토하기</Link> : null}{meeting.status === "done" && !meeting.legacy && owner ? <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void shareTelegram()}>텔레그램에 올리기</button> : null}{canEdit && (meeting.status === "planned" || meeting.status === "active") ? primary : null}{owner ? <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void archive()}>삭제</button> : null}</div></div>
    {error ? <div className="tm-callout" data-tone="danger" role="alert">{error}</div> : null}
    {!meeting.legacy ? <div className="tm-steps" aria-label="회의 진행 단계">{["준비", "회의·녹음", "자동 정리", "검토", "확정"].map((label, index) => <span key={label} data-state={index < step ? "done" : index === step ? "now" : undefined}>{index < step ? "✓" : index + 1} {label}</span>)}</div> : null}
    {ai ? <p className="tm-ai-status" data-done={ai.done ? "true" : undefined} role="status">{ai.done ?? `회의를 자동으로 정리하는 중… ${Math.max(0, Math.round((tick - ai.startedAt) / 1000))}초 · 보통 1~2분 걸립니다`}</p>
      : autoAi ? <p className="tm-ai-status" role="status">마지막 녹음 구간을 글로 바꾸는 중… 끝나면 자동 정리가 바로 시작됩니다</p> : null}
    {meeting.status === "done" || meeting.status === "review" ? <nav className="workspace-tabs" aria-label="회의 내용">{[["sum", "정리"], ["dec", "결정"], ["task", "업무"], ["open", "미결"], ["raw", "원문"]].map(([key, label]) => <Link key={key} aria-current={tab === key ? "page" : undefined} href={key === "sum" ? base : `${base}&t=${key}`}>{label}</Link>)}</nav> : null}
    <div className="tm-detail-grid"><section className="panel panel-pad"><h3 className="card-title">{meeting.status === "planned" || meeting.status === "active" ? "회의 기록" : tab === "raw" ? "회의 원문" : tab === "sum" ? "회의 정리" : tab === "open" ? "미결" : tab === "dec" ? "결정" : "후속 업무"}</h3>
      {canEdit ? <div className="tm-stack"><label className="tm-stack">제목<input value={title} onChange={event => setTitle(event.target.value)} maxLength={240} /></label><div className="tm-row"><label>사업 <select value={brand} onChange={event => setBrand(event.target.value)}><option value="">사업 미지정</option>{TEAM_BUSINESSES.map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label><label>프로젝트 <select value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">프로젝트 없음</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><label>예정 일시 <input type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label></div><label className="tm-stack">안건<textarea value={agenda} onChange={event => setAgenda(event.target.value)} rows={4} /></label><label className="tm-stack">회의 메모<textarea value={content} onChange={event => setContent(event.target.value)} rows={9} /></label><div className="tm-row"><button type="button" className="secondary-button compact" disabled={busy} aria-pressed={recorder.recording} onClick={() => recorder.recording ? recorder.stop() : void askRecording().then(ok => { if (ok) void recorder.start(); })}>{recorder.recording ? "■ 녹음 종료" : "● 녹음 시작"}</button><CostTag kind="paid" /><label>녹음 파일 받아쓰기 <input type="file" accept="audio/*" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void fileTranscript(file); }} /></label><CostTag kind="paid" /><button className="secondary-button compact" disabled={busy || content.trim().length < 20} onClick={() => void askAi().then(ok => { if (ok) void extract(); })}>{busy && ai && !ai.done ? "자동 정리 중…" : hasAi ? "자동 정리 다시 하기" : "자동 정리"}</button><CostTag kind="paid" /></div><RecorderProgress recorder={recorder} />{recorder.error ? <div className="tm-callout" data-tone="danger" role="alert">{recorder.error}</div> : null}<label className="tm-stack">정리<textarea value={summary} onChange={event => setSummary(event.target.value)} rows={5} /></label><label>공유 <select value={visibility} onChange={event => setVisibility(event.target.value as "team" | "attendees")}><option value="team">팀 공유</option><option value="attendees">참석자만</option></select></label>{owner ? <fieldset><legend>참석자</legend><div className="tm-people-pick">{members.map(member => <label key={member.id}><input type="checkbox" checked={attendees.includes(member.id)} disabled={member.id === meeting.owner_id} onChange={event => setAttendees(current => event.target.checked ? [...current, member.id] : current.filter(id => id !== member.id))} />{member.display_name}</label>)}</div></fieldset> : null}<div className="tm-row"><button className="primary-button compact" disabled={busy || !dirty || !brand} onClick={() => void execute("meeting.save")}>변경 저장</button>{dirty ? <span className="tm-warning-text">저장하지 않은 변경이 있습니다.</span> : <span className="tm-muted">저장됨</span>}</div><h3>결정·업무·미결 후보</h3>{items.map(item => <div className="tm-review-item" data-kind={item.kind} key={item.id}><span>{item.kind === "decision" ? "결정" : item.kind === "task" ? "업무" : "미결"} · {item.state === "pending" ? "검토 대기" : item.state === "discarded" ? "제외" : "채택"}</span><p>{item.text}</p></div>)}<div className="tm-row"><select aria-label="항목 종류" value={itemKind} onChange={event => setItemKind(event.target.value as MeetingItem["kind"])}><option value="decision">결정</option><option value="task">업무</option><option value="open">미결</option></select><input aria-label="항목 내용" value={itemText} onChange={event => setItemText(event.target.value)} /><button className="secondary-button compact" disabled={!itemText.trim()} onClick={() => { setItems(current => [...current, { id: crypto.randomUUID(), kind: itemKind, text: itemText.trim(), state: "pending", source: "manual" }]); setItemText(""); }}>항목 추가</button></div></div>
      : tab === "sum" ? <div className="tm-stack"><p className="body-text" style={{ whiteSpace: "pre-wrap" }}>{meeting.metadata.summary || "정리가 없습니다."}</p>{meeting.metadata.corrections?.map((item, index) => <div className="tm-block" key={index}><strong>정정 기록</strong><p>{item.text}</p><small>{item.reason}</small></div>)}{meeting.status === "done" && owner && !meeting.legacy ? <div className="tm-stack"><label>정정 내용<textarea value={correction} onChange={event => setCorrection(event.target.value)} /></label><label>정정 사유<input value={reason} onChange={event => setReason(event.target.value)} /></label><button className="secondary-button compact" disabled={busy || !correction.trim() || !reason.trim()} onClick={() => void execute("meeting.correct", { content: correction, reason })}>정정 기록 추가</button></div> : null}</div> : tab === "raw" ? <div className="tm-stack"><p className="body-text" style={{ whiteSpace: "pre-wrap" }}>{meeting.description || "원문이 없습니다."}</p><small className="tm-muted">받아쓰기 완료 · 녹음 파일은 받아쓴 뒤 바로 지움</small></div> : selectedItems.length ? <ul className="tm-bullets">{selectedItems.map(item => <li key={item.id}>{item.text}</li>)}</ul> : <p className="tm-muted">등록된 항목이 없습니다.</p>}
    </section><div className="tm-stack">{live ? <MeetingBoard meeting={meeting} previous={previousMeeting} carried={items.map(item => item.text)} tasks={tasks} members={members} token={token} canEdit={canEdit} notes={notes} onNotesChanged={loadNotes} onCarry={carry} onChanged={onChanged} /> : null}<aside className="panel tm-side"><div className="tm-side-section"><h3>회의 정보</h3><dl className="tm-kv"><dt>공유</dt><dd>{meeting.metadata.visibility === "team" ? "팀 공유" : "참석자만"}</dd><dt>작성자</dt><dd>{members.find(member => member.id === meeting.owner_id)?.display_name ?? "구성원"}</dd><dt>상태</dt><dd>{meeting.status === "done" ? "확정" : meeting.status === "review" ? "검토 필요" : meeting.status === "active" ? "진행 중" : "예정"}</dd></dl></div><div className="tm-side-section"><h3>안건</h3><p className="body-text">{meeting.metadata.agenda || "안건이 없습니다."}</p></div><div className="tm-side-section"><h3>이어지는 회의</h3>{previousMeeting ? <p><Link href={`/organization/meetings?meeting=${encodeURIComponent(previousMeeting.id)}`}>이전 · {previousMeeting.title}</Link></p> : null}{nextMeeting ? <p><Link href={`/organization/meetings?meeting=${encodeURIComponent(nextMeeting.id)}`}>다음 · {nextMeeting.title}</Link></p> : meeting.status === "done" && !meeting.legacy ? <CreateTeamMeeting token={token} projects={projects} onChanged={onChanged} initialBusiness={teamBusiness(meeting.brand ?? "")?.key ?? ""} previousMeetingId={meeting.id} /> : null}</div><div className="tm-side-section"><h3>후속 업무 {linkedTasks.length}건</h3>{linkedTasks.length ? <><div className="tm-progress" aria-label="후속 업무 상태 분포">{["done", "review", "active", "blocked", "todo"].map(status => { const count = linkedTasks.filter(task => status === "todo" ? ["todo", "planned", "backlog"].includes(task.status) : status === "active" ? ["active", "doing"].includes(task.status) : task.status === status).length; return count ? <i key={status} data-status={status} style={{ width: `${count / linkedTasks.length * 100}%` }} /> : null; })}</div><p className="tm-muted">완료 {linkedTasks.filter(task => task.status === "done").length} · 막힘 {linkedTasks.filter(task => task.status === "blocked").length}</p>{linkedTasks.slice(0, 5).map(task => <p key={task.id}><Link href={`/organization/tasks?task=${encodeURIComponent(task.id)}`}>{task.title}</Link></p>)}</> : <p className="tm-muted">연결된 업무가 없습니다.</p>}</div></aside></div></div>
    {cost.element}
  </>;
}

export function TeamMeetingReview({ meeting, token, userId, admin, members, tasks, onChanged }: { meeting: Meeting; token: string; userId?: string; admin: boolean; members: OsMember[]; tasks: OsRecord[]; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [items, setItems] = useState<MeetingItem[]>(meeting.metadata.items), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState<Record<string, "merge" | "separate">>({});
  const owner = admin || meeting.owner_id === userId;
  // A task can say which KPI of this business and month it works toward (stored on the meeting item).
  const business = teamBusiness(meeting.brand ?? "")?.key, month = (meeting.starts_at ?? meeting.created_at ?? new Date().toISOString()).slice(0, 7);
  const [kpis, setKpis] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    if (business !== "myin" && business !== "edu") return;
    type Listed = { id: string; title: string };
    void apiRequest<{ businesses: { key: string; kpis?: Listed[]; rounds?: { label: string; from: string; to: string; courseTo: string | null; kpis: Listed[] }[] }[] }>(`/api/v1/kpi?month=${month}`, { token })
      .then(result => {
        const found = result.businesses.find(item => item.key === business);
        // 브랜디에듀 KPIs belong to sales rounds: offer those of the rounds active at the meeting.
        const day = month === kstMonth() ? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) : `${month}-28`;
        setKpis(found?.rounds ? activeRuns(found.rounds, day).flatMap(round => round.kpis.map(kpi => ({ id: kpi.id, title: `${round.label} · ${kpi.title}` }))) : found?.kpis ?? []);
      }).catch(() => setKpis([]));
  }, [business, month, token]);
  const similarTask = (item: MeetingItem) => tasks.filter(task => task.status !== "done" && task.status !== "cancelled" && task.brand === meeting.brand && wordSimilarity(task.title, item.text) >= 0.6).sort((a, b) => wordSimilarity(b.title, item.text) - wordSimilarity(a.title, item.text))[0];
  function change(id: string, patch: Partial<MeetingItem>) { setItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item)); setDuplicates(current => { const next = { ...current }; delete next[id]; return next; }); }
  async function save(confirm: boolean) {
    setBusy(true); setError("");
    try {
      const normalized = items.map(item => ({ ...item, state: duplicates[item.id] === "merge" ? "discarded" : item.kind === "open" && item.state !== "discarded" ? "pending" : confirm && item.state === "pending" && item.kind !== "open" ? "accepted" : item.state }));
      const saved = await teamCommand(token, { action: "meeting.save", id: meeting.id, expectedVersion: meeting.version, items: normalized });
      if (confirm) await teamCommand(token, { action: "meeting.review", id: meeting.id, expectedVersion: saved.version ?? meeting.version + 1,
        mergeTasks: items.flatMap(item => duplicates[item.id] === "merge" ? [{ itemId: item.id, taskId: similarTask(item)?.id }] : []).filter(item => item.taskId) });
      await onChanged(); router.push(`/organization/meetings?meeting=${encodeURIComponent(meeting.id)}`);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  const accepted = items.filter(item => item.state !== "discarded" && duplicates[item.id] !== "merge");
  const loose = items.filter(item => item.kind === "task" && item.state === "pending" && !item.ownerId && !item.dueOn);
  const counts = { decision: accepted.filter(item => item.kind === "decision").length, task: accepted.filter(item => item.kind === "task").length, open: accepted.filter(item => item.kind === "open").length,
    unassigned: accepted.filter(item => item.kind === "task" && !item.ownerId).length, merged: Object.values(duplicates).filter(choice => choice === "merge").length,
    unresolved: accepted.filter(item => item.kind === "task" && similarTask(item) && !duplicates[item.id]).length };
  return <><Link className="tm-back" href={`/organization/meetings?meeting=${encodeURIComponent(meeting.id)}`}>← 회의 상세</Link><h2 className="tm-detail-title">뽑은 항목 검토 · {meeting.title}</h2><div className="tm-stepper" aria-label="회의 처리 단계">{["원문", "자동 정리", "뽑은 항목 검토", "확정"].map((label, index) => <span className="tm-step" data-state={index < 2 ? "done" : index === 2 ? "now" : "next"} key={label}><span className="tm-step-no">{index < 2 ? "✓" : index + 1}</span>{label}</span>)}</div>{error ? <div className="tm-callout" data-tone="danger" role="alert">{error}</div> : null}<div className="tm-detail-grid"><section className="tm-review-list">{items.length ? items.map(item => { const similar = item.kind === "task" ? similarTask(item) : null; const canMerge = similar && (admin || similar.owner_id === userId || similar.assignee_id === userId); return <article className="tm-review-item" data-kind={item.state === "discarded" ? "excluded" : item.kind} key={item.id}><div className="tm-review-head"><div className="segmented">{(["decision", "task", "open", "excluded"] as const).map(kind => <button type="button" key={kind} data-kind={kind} aria-pressed={kind === "excluded" ? item.state === "discarded" : item.state !== "discarded" && item.kind === kind} onClick={() => change(item.id, kind === "excluded" ? { state: "discarded" } : { kind, state: "pending" })}>{kind === "decision" ? "결정" : kind === "task" ? "업무" : kind === "open" ? "미결" : "제외"}</button>)}</div></div><textarea className="tm-review-text" aria-label="후보 내용" value={item.text} onChange={event => change(item.id, { text: event.target.value })} />{item.kind === "task" && item.state !== "discarded" ? <div className="tm-review-fields"><label>담당 <select value={item.ownerId ?? ""} onChange={event => change(item.id, { ownerId: event.target.value })}><option value="">미정 · 분류함</option>{members.map(member => <option value={member.id} key={member.id}>{member.display_name}</option>)}</select></label><label>기한 <input type="date" value={item.dueOn ?? ""} onChange={event => change(item.id, { dueOn: event.target.value })} /></label>{kpis.length ? <label>연결 KPI <select value={item.kpiId ?? ""} onChange={event => change(item.id, { kpiId: event.target.value || undefined })}><option value="">없음</option>{kpis.map(kpi => <option value={kpi.id} key={kpi.id}>{kpi.title}</option>)}</select></label> : null}</div> : null}{similar && item.state !== "discarded" ? <div className="tm-dup-hint"><span>중복 의심: {similar.title}</span><button type="button" className="secondary-button compact" aria-pressed={duplicates[item.id] === "merge"} disabled={!canMerge} title={!canMerge ? "이 업무의 담당자 또는 작성자만 합칠 수 있습니다." : undefined} onClick={() => setDuplicates(current => ({...current, [item.id]: "merge"}))}>기존 업무에 합치기</button><button type="button" className="secondary-button compact" aria-pressed={duplicates[item.id] === "separate"} onClick={() => setDuplicates(current => ({...current, [item.id]: "separate"}))}>별도 업무로</button></div> : null}</article>; }) : <div className="empty-state">검토할 후보가 없습니다.</div>}</section><aside className="panel tm-side"><div className="tm-side-section"><h3>원문 정리</h3><p className="body-text">{meeting.metadata.summary || "정리가 없습니다."}</p></div><div className="tm-side-section"><h3>분류 기준</h3><p className="body-text">결정은 정한 내용, 업무는 실행할 일, 미결은 다음 회의에서 다시 볼 안건입니다.</p></div></aside></div><div className="tm-sticky-bar"><div className="tm-sticky-summary"><span>결정 <b>{counts.decision}</b> → 결정 로그</span><span>업무 <b>{counts.task}</b> → 팀 보드</span><span>미결 <b>{counts.open}</b> → 다음 회의</span><span>담당 미정 <b>{counts.unassigned}</b> → 분류함</span>{counts.merged ? <span>기존 업무에 병합 <b>{counts.merged}</b></span> : null}{counts.unresolved ? <span className="tm-warning-text">중복 의심 {counts.unresolved}건 처리 필요</span> : null}</div>{loose.length ? <button type="button" className="secondary-button compact" disabled={busy} onClick={() => setItems(current => current.map(item => loose.includes(item) ? { ...item, kind: "decision" } : item))}>담당·기한 없는 업무 {loose.length}개 → 결정으로</button> : null}<button type="button" className="secondary-button compact" disabled={busy || !owner} onClick={() => void save(false)}>나중에 이어서</button><button type="button" className="primary-button compact" disabled={busy || !owner || counts.unresolved > 0 || items.some(item => item.state !== "discarded" && !item.text.trim())} title={!owner ? "작성자 또는 관리자만 확정할 수 있습니다." : undefined} onClick={() => void save(true)}>확정하고 반영</button>{!owner ? <span className="tm-muted">작성자·관리자만 확정할 수 있습니다.</span> : null}</div></>;
}
