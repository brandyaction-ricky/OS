"use client";
import { useCallback, useEffect, useState } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { SCENE_NOTE_STATE, sceneNow, sceneNoteState, sceneWords, type SceneNotePin, type SceneNoteState, type SceneProposal } from "@/lib/myin-scene-notes";
import { useSession } from "./session-provider";

/** Scenes per 점검 시트 (the engine's preview(): 3 columns × 4 rows of equal cells, numbered in order). */
const PER_SHEET = 12;
interface SceneNote { id: string; version: number; text: string; who: string; whoId: string; at: string; status: string; deleted: boolean; declinedWhy: string;
  scene: SceneNotePin | null; sent: { at: string; name: string; jobId?: string } | null; proposal: SceneProposal | null }
interface Job { id: string; status: string; failReason: string | null; notes: string[] | null }
export interface SceneSheets { urls: string[]; scenes: { type: string; at: string }[]; storyboardAt: string }
const when = (value: string) => new Date(value).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * ③ 점검 시트 장면 의견 (직원 요청 2026-11-12, 후속): the sheets cut into their scenes with a folded note box under each, the notes
 * gathered on top. Chosen notes go to 내 AI as jobs that wait in turn; each comes back as a 수정안 for its scene, seen 수정 전 · 후
 * and applied one by one while the sheets stay open. A sheet is one frame per scene — movement, voice and sound are checked in the
 * 미리보기 · 완성 영상.
 */
export function MyinSceneNotes({ projectId, runId, token, short, storyboardAt, sheetCount, sheets, open, onOpen, canSend, canApply, onChanged, refresh }: {
  projectId: string; runId: string; token: string | null; short: boolean; storyboardAt: string; sheetCount: number; sheets: SceneSheets | null;
  open: boolean; onOpen: (open: boolean) => void; canSend: boolean; canApply: boolean; onChanged: () => Promise<void>; refresh: string }) {
  const { profile } = useSession();
  const [notes, setNotes] = useState<SceneNote[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [shown, setShown] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const base = `/api/v1/content/youtube/projects/${projectId}/feedback`;
  const load = useCallback(async () => {
    try {
      const [list, mine] = await Promise.all([apiRequest<{ items: SceneNote[] }>(`${base}?scenes=1`, { token }),
        apiRequest<{ jobs?: Job[] }>(`/api/v1/content/youtube-automation/ai-jobs?sourceId=${projectId}&task=scene-notes&all=1`, { token }).catch(() => ({ jobs: [] }))]);
      setNotes(list.items.filter((note) => note.scene?.runId === runId && !note.deleted)); setJobs(mine.jobs ?? []);
    } catch { /* the list stays as it was */ }
  }, [base, token, runId, projectId]);
  useEffect(() => { void load(); }, [load, refresh]);

  // A job that closed without a 수정안 (blocked · cancelled, or done while the note changed) leaves its notes 「못 받음」.
  const closed = new Set(jobs.filter((job) => !["backlog", "active"].includes(job.status)).map((job) => job.id));
  const failWhy = (note: SceneNote) => jobs.find((job) => job.id === note.sent?.jobId)?.failReason ?? "";
  const sheetAt = sheets?.storyboardAt ?? storyboardAt;
  const where = (note: SceneNote) => note.scene ? sheets ? sceneNow(note.scene, sheets.scenes, sheets.storyboardAt) : note.scene.storyboardAt === sheetAt ? note.scene.n : undefined : null;
  const rows = notes.map((note) => ({ note, n: where(note), state: sceneNoteState(note, storyboardAt, closed) }))
    .sort((a, b) => (a.n ?? 999) - (b.n ?? 999) || a.note.at.localeCompare(b.note.at));
  const fixing = rows.some((row) => row.state === "fixing");
  // While 내 AI works, the list looks again every 30 seconds (two small reads) until no note is waiting for its 수정안.
  useEffect(() => {
    if (!fixing) return;
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [fixing, load]);

  const write = async (label: string, request: () => Promise<unknown>) => {
    setSaving(label); setError("");
    try { await request(); await load(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했어요."); await load(); return false; }
    finally { setSaving(""); }
  };
  const add = (n: number) => write("add", () => apiRequest(base, { method: "POST", token,
    body: JSON.stringify({ target: "scene", scene: { runId, n, storyboardAt: sheetAt }, ver: 1, text: draft }) })).then((ok) => { if (ok) setDraft(""); });
  const actOn = (note: SceneNote, action: "resolve" | "reopen" | "decline" | "delete", text = "") =>
    write(note.id, () => apiRequest(base, { method: "PATCH", token, body: JSON.stringify({ itemId: note.id, expectedVersion: note.version, action, text }) }));
  const decline = (note: SceneNote) => { const why = window.prompt("반영하지 않는 이유를 한 줄 써 주세요."); if (why?.trim()) void actOn(note, "decline", why.trim()); };
  const send = (ids: string[]) => write("send", () => apiRequest("/api/v1/content/youtube-automation/ai-jobs", { method: "POST", token,
    body: JSON.stringify({ task: "scene-notes", sourceId: projectId, notes: ids }) })).then((ok) => { if (ok) setPicked([]); });
  const apply = async (note: SceneNote, force = false): Promise<void> => {
    setSaving(note.id); setError("");
    try {
      await apiRequest("/api/v1/content/youtube-automation/myin", { method: "PATCH", token, body: JSON.stringify({ action: "scene_apply", runId, noteId: note.id, force }) });
      await load(); await onChanged();
    } catch (reason) {
      setSaving("");
      if (!force && reason instanceof ApiRequestError && reason.status === 409 && reason.message.includes("바뀌었어요")) {
        if (window.confirm(`${reason.message}\n\n그래도 이 수정안으로 바꿀까요?`)) return apply(note, true);
        return;
      }
      setError(reason instanceof Error ? reason.message : "반영하지 못했어요.");
    } finally { setSaving(""); }
  };
  const go = (n: number) => {
    onOpen(true); setShown(n);
    window.setTimeout(() => document.getElementById(`yt-scene-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 400);
  };
  const count = (kind: SceneNoteState) => rows.filter((row) => row.state === kind).length;
  const sendable = rows.filter((row) => row.state === "waiting" || row.state === "failed" || row.state === "check");

  const proposalBox = (note: SceneNote) => note.proposal ? <div className="yt-scene-proposal">
    <span><b>수정 전</b> {sceneWords(note.proposal.base.scene)}</span>
    <span><b>수정 후</b> {note.proposal.scenes.map((scene) => sceneWords(scene)).join(" ┃ ")}</span>
    <small>{note.proposal.why} · {note.proposal.by} AI · {when(note.proposal.at)}</small>
    <details><summary>장면 데이터 보기</summary><pre>{JSON.stringify({ 수정전: note.proposal.base.scene, 수정후: note.proposal.scenes }, null, 1)}</pre></details>
  </div> : null;
  const noteRow = (note: SceneNote, state: SceneNoteState) => <li key={note.id} className="yt-scene-note">
    <span><b>{note.who}</b> <span className="yt-chip">{SCENE_NOTE_STATE[state]}</span>{state === "declined" && note.declinedWhy ? <small> · {note.declinedWhy}</small> : null}
      {state === "failed" && failWhy(note) ? <small> · {failWhy(note)}</small> : null}</span>
    <span className="yt-scene-text">{note.text}</span>
    {state === "check" ? proposalBox(note) : null}
    <span className="yt-scene-acts">
      {state === "check" && note.proposal ? <button type="button" className="primary-button compact" disabled={Boolean(saving) || !canApply} title={canApply ? undefined : "기획표 확인 중이거나 ③ 미리보기를 확인할 때 반영할 수 있어요"}
        onClick={() => void apply(note)}>{saving === note.id ? "반영 중…" : "반영"}</button> : null}
      {state === "done" || state === "declined" ? <button type="button" className="secondary-button compact" disabled={Boolean(saving)} onClick={() => void actOn(note, "reopen")}>다시 열기</button>
        : <button type="button" className="secondary-button compact" disabled={Boolean(saving)} onClick={() => decline(note)}>반영 안 함</button>}
      {note.whoId === profile?.id ? <button type="button" className="secondary-button compact" disabled={Boolean(saving)} onClick={() => { if (window.confirm("이 의견을 지울까요?")) void actOn(note, "delete"); }}>지우기</button> : null}
    </span>
  </li>;

  return <>
    {rows.length ? <div className="yt-note yt-scene-summary">
      <strong>장면 의견 {rows.length}개 · 대기 {count("waiting")} · 고치는 중 {count("fixing")} · 확인 필요 {count("check")} · 반영 {count("done")}</strong>
      <ul className="yt-scene-list">{rows.map(({ note, n, state }) => <li key={note.id}>
        <input type="checkbox" aria-label="내 AI에 보낼 의견" disabled={!canSend || !sendable.some((row) => row.note.id === note.id)} checked={picked.includes(note.id)}
          onChange={(event) => setPicked((now) => event.target.checked ? [...now, note.id] : now.filter((id) => id !== note.id))} />
        {n ? <button type="button" className="yt-scene-jump" onClick={() => go(n)}>#{n}</button>
          : <span className="yt-chip" title="기획표가 바뀌어 이 의견의 장면을 찾지 못했어요. 장면을 보고 다시 써 주세요.">{n === null ? "장면 못 찾음" : `#${note.scene?.n} (이전 시트)`}</span>}
        <span className="yt-scene-text"><b>{note.who}</b> {note.text}</span>
        <span className="yt-chip">{SCENE_NOTE_STATE[state]}</span>
      </li>)}</ul>
      {canSend && sendable.length ? <div className="yt-actions">
        <button type="button" className="primary-button" disabled={Boolean(saving) || !picked.length} onClick={() => void send(picked)}>{saving === "send" ? "보내는 중…" : `고른 의견 ${picked.length}개 내 AI에 수정 요청`}</button>
        <small>의견마다 그 장면만 고친 수정안이 와요. 앞에 보낸 요청이 아직 고치는 중이어도 이어서 보낼 수 있어요. 기획표는 「반영」을 누를 때만 바뀌어요.</small>
      </div> : null}
      {count("check") ? <p className="yt-note">수정안이 온 의견은 아래 점검 시트의 그 장면에서 수정 전 · 후를 보고 「반영」을 눌러요. 반영한 뒤 미리보기를 다시 만들면 새 시트에서 확인할 수 있어요.</p> : null}
      {error && !open ? <p className="yt-note yt-warn" role="alert">{error}</p> : null}
    </div> : null}
    {sheetCount ? <details className="yt-details" open={open} onToggle={(event) => onOpen((event.target as HTMLDetailsElement).open)}>
      <summary>점검 시트 {sheetCount}장 보기 · 장면마다 의견 남기기</summary>
      <p className="yt-note">장면마다 한 순간(한 컷)만 보여요. 움직임 · 전환 · 음성 · 효과음은 장면 미리보기와 완성 영상에서 따로 확인해요. 쇼릴 뒤부터는 컷 시각이 조금 앞당겨져 보이니(점검 기능의 특성), 문구 확인은 위 개수로 합니다.</p>
      {sheets && sheets.storyboardAt ? <p className="yt-note">{when(sheets.storyboardAt)} 기획표로 그린 시트예요.{sheets.storyboardAt !== storyboardAt ? " 그 뒤 반영한 수정이 있어요 — 미리보기를 다시 만들면 새 시트가 나와요." : ""}</p> : null}
      {error ? <p className="yt-note yt-warn" role="alert">{error}</p> : null}
      {sheets?.urls.map((url, sheet) => <div key={url} id={`yt-sheet-${sheet + 1}`} className="yt-scene-grid">
        {Array.from({ length: Math.min(PER_SHEET, Math.max(0, (sheets.scenes.length || sheets.urls.length * PER_SHEET) - sheet * PER_SHEET)) }, (_, j) => {
          const n = sheet * PER_SHEET + j + 1, here = rows.filter((row) => row.n === n);
          return <figure key={n} id={`yt-scene-${n}`} className="yt-scene">
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs from private storage; one sheet image cut by CSS */}
            <div className={`yt-scene-cell${short ? " yt-tall" : ""}`} data-col={j % 3} data-row={Math.floor(j / 3)}><img src={url} alt={`장면 #${n}`} loading="lazy" /></div>
            <button type="button" className={`yt-scene-btn${here.length ? " yt-has" : ""}`} aria-expanded={shown === n} onClick={() => { setShown(shown === n ? null : n); setDraft(""); }}>
              #{n} · {here.length ? `의견 ${here.length}${here.some((row) => row.state === "check") ? " · 수정안 왔어요" : ""}` : "의견 남기기"}</button>
            {shown === n ? <div className="yt-scene-notes">
              {here.length ? <ul className="yt-scene-list">{here.map((row) => noteRow(row.note, row.state))}</ul> : null}
              <form onSubmit={(event) => { event.preventDefault(); if (draft.trim()) void add(n); }}>
                <textarea rows={2} value={draft} maxLength={2000} onChange={(event) => setDraft(event.target.value)} placeholder="예) 글자가 칸을 넘어요 · 사진 대신 비교 도식으로" />
                <button type="submit" className="secondary-button compact" disabled={Boolean(saving) || !draft.trim()}>{saving === "add" ? "저장 중…" : "의견 저장"}</button>
              </form>
            </div> : null}
          </figure>;
        })}
      </div>)}
    </details> : null}
  </>;
}
