"use client";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { SCENE_NOTE_STATE, sceneNow, sceneNoteState, type SceneNotePin } from "@/lib/myin-scene-notes";
import { useSession } from "./session-provider";

/** Scenes per 점검 시트 (the engine's preview(): 3 columns × 4 rows of equal cells, numbered in order). */
const PER_SHEET = 12;
interface SceneNote { id: string; version: number; text: string; who: string; whoId: string; at: string; status: string; deleted: boolean; declinedWhy: string;
  scene: SceneNotePin | null; sent: { at: string; name: string } | null }
export interface SceneSheets { urls: string[]; scenes: { type: string; at: string }[]; storyboardAt: string }

/**
 * ③ 점검 시트 장면 의견 (직원 요청 2026-11-12): the sheets cut into their scenes, a folded note box under each, the notes
 * gathered on top, and the chosen ones sent to 내 AI as the 수정 요청 that already exists (onSend). A sheet is one frame per scene —
 * movement, voice and sound are still checked in the 미리보기 · 완성 영상.
 */
export function MyinSceneNotes({ projectId, runId, token, short, storyboardAt, sheetCount, sheets, open, onOpen, canSend, busy, onSend, refresh }: {
  projectId: string; runId: string; token: string | null; short: boolean; storyboardAt: string; sheetCount: number; sheets: SceneSheets | null;
  open: boolean; onOpen: (open: boolean) => void; canSend: boolean; busy: boolean; onSend: (ids: string[]) => Promise<void>; refresh: string }) {
  const { profile } = useSession();
  const [notes, setNotes] = useState<SceneNote[]>([]);
  const [shown, setShown] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/v1/content/youtube/projects/${projectId}/feedback`;
  const load = useCallback(async () => {
    try { setNotes((await apiRequest<{ items: SceneNote[] }>(`${base}?scenes=1`, { token })).items.filter((note) => note.scene?.runId === runId && !note.deleted)); }
    catch { /* the list stays as it was */ }
  }, [base, token, runId]);
  useEffect(() => { void load(); }, [load, refresh]);

  const write = async (request: () => Promise<unknown>) => {
    setSaving(true); setError("");
    try { await request(); await load(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했어요."); await load(); return false; }
    finally { setSaving(false); }
  };
  const add = (n: number) => write(() => apiRequest(base, { method: "POST", token,
    body: JSON.stringify({ target: "scene", scene: { runId, n, storyboardAt: sheets?.storyboardAt ?? storyboardAt }, ver: 1, text: draft }) })).then((ok) => { if (ok) setDraft(""); });
  const actOn = (note: SceneNote, action: "resolve" | "reopen" | "decline" | "delete", text = "") =>
    write(() => apiRequest(base, { method: "PATCH", token, body: JSON.stringify({ itemId: note.id, expectedVersion: note.version, action, text }) }));
  const decline = (note: SceneNote) => { const why = window.prompt("반영하지 않는 이유를 한 줄 써 주세요."); if (why?.trim()) void actOn(note, "decline", why.trim()); };

  // The scene each note means on the sheets shown now (after a 수정 its scene is found again by its 시작 문구).
  const sheetAt = sheets?.storyboardAt ?? storyboardAt;
  const where = (note: SceneNote) => note.scene ? sheets ? sceneNow(note.scene, sheets.scenes, sheets.storyboardAt) : note.scene.storyboardAt === storyboardAt ? note.scene.n : undefined : null;
  const state = (note: SceneNote) => sceneNoteState(note, storyboardAt);
  const rows = notes.map((note) => ({ note, n: where(note), state: state(note) })).sort((a, b) => (a.n ?? 999) - (b.n ?? 999) || a.note.at.localeCompare(b.note.at));
  const sendable = rows.filter((row) => row.state === "waiting");
  const go = (n: number) => {
    onOpen(true); setShown(n);
    window.setTimeout(() => document.getElementById(`yt-scene-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 400);
  };
  const send = async () => {
    const ids = picked.filter((id) => sendable.some((row) => row.note.id === id));
    if (!ids.length || !window.confirm(`고른 의견 ${ids.length}개로 기획표를 내 AI에 다시 보내요. 지금 미리보기는 닫히고, 새 기획표를 확인하면 미리보기를 다시 만들어요. 보낼까요?`)) return;
    await onSend(ids); setPicked([]); await load();
  };
  const count = (kind: string) => rows.filter((row) => row.state === kind).length;

  const noteRow = (note: SceneNote, noteState: ReturnType<typeof state>) => <li key={note.id} className="yt-scene-note">
    <span><b>{note.who}</b> <span className="yt-chip">{SCENE_NOTE_STATE[noteState]}</span>{note.declinedWhy && noteState === "declined" ? <small> · {note.declinedWhy}</small> : null}</span>
    <span className="yt-scene-text">{note.text}</span>
    <span className="yt-scene-acts">
      {noteState === "done" || noteState === "declined" ? <button type="button" className="secondary-button compact" disabled={saving} onClick={() => void actOn(note, "reopen")}>다시 열기</button>
        : <><button type="button" className="secondary-button compact" disabled={saving} onClick={() => void actOn(note, "resolve")}>✓ 반영</button>
          <button type="button" className="secondary-button compact" disabled={saving} onClick={() => decline(note)}>반영 안 함</button></>}
      {note.whoId === profile?.id ? <button type="button" className="secondary-button compact" disabled={saving} onClick={() => { if (window.confirm("이 의견을 지울까요?")) void actOn(note, "delete"); }}>지우기</button> : null}
    </span>
  </li>;

  return <>
    {rows.length ? <div className="yt-note yt-scene-summary">
      <strong>장면 의견 {rows.length}개 · 대기 {count("waiting")} · 고치는 중 {count("fixing")} · 확인 필요 {count("check")} · 반영 {count("done")}</strong>
      <ul className="yt-scene-list">{rows.map(({ note, n, state: noteState }) => <li key={note.id}>
        <input type="checkbox" aria-label="내 AI에 보낼 의견" disabled={!canSend || noteState !== "waiting"} checked={picked.includes(note.id)}
          onChange={(event) => setPicked((now) => event.target.checked ? [...now, note.id] : now.filter((id) => id !== note.id))} />
        {n ? <button type="button" className="yt-scene-jump" onClick={() => go(n)}>#{n}</button>
          : <span className="yt-chip" title="기획표가 바뀌어 이 의견의 장면을 찾지 못했어요. 장면을 보고 다시 써 주세요.">{n === null ? "장면 못 찾음" : `#${note.scene?.n} (이전 기획표)`}</span>}
        <span className="yt-scene-text"><b>{note.who}</b> {note.text}</span>
        <span className="yt-chip">{SCENE_NOTE_STATE[noteState]}</span>
      </li>)}</ul>
      {canSend && sendable.length ? <div className="yt-actions">
        <button type="button" className="primary-button" disabled={busy || !picked.length} onClick={() => void send()}>{busy ? "보내는 중…" : `고른 의견 ${picked.length}개 내 AI에 수정 요청`}</button>
        <small>기획표가 이 의견과 함께 내 AI에 다시 가요. 고른 장면만 고치고, 새 기획표는 다시 확인한 뒤에 미리보기를 만들어요.</small>
      </div> : sendable.length ? <small>내 AI에 수정 요청은 기획표 확인부터 ③ 미리보기 확인까지 보낼 수 있어요.</small> : null}
      {count("check") ? <p className="yt-note">새 기획표가 나왔어요. 새 점검 시트에서 그 장면을 보고 ✓ 반영이나 다시 열기를 눌러요.</p> : null}
    </div> : null}
    {sheetCount ? <details className="yt-details" open={open} onToggle={(event) => onOpen((event.target as HTMLDetailsElement).open)}>
      <summary>점검 시트 {sheetCount}장 보기 · 장면마다 의견 남기기</summary>
      <p className="yt-note">장면마다 한 순간(한 컷)만 보여요. 움직임 · 전환 · 음성 · 효과음은 장면 미리보기와 완성 영상에서 따로 확인해요. 쇼릴 뒤부터는 컷 시각이 조금 앞당겨져 보이니(점검 기능의 특성), 문구 확인은 위 개수로 합니다.</p>
      {error ? <p className="yt-note yt-warn" role="alert">{error}</p> : null}
      {sheets?.urls.map((url, sheet) => <div key={url} id={`yt-sheet-${sheet + 1}`} className="yt-scene-grid">
        {Array.from({ length: Math.min(PER_SHEET, Math.max(0, (sheets.scenes.length || sheets.urls.length * PER_SHEET) - sheet * PER_SHEET)) }, (_, j) => {
          const n = sheet * PER_SHEET + j + 1, here = rows.filter((row) => row.n === n);
          return <figure key={n} id={`yt-scene-${n}`} className="yt-scene">
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs from private storage; one sheet image cut by CSS */}
            <div className={`yt-scene-cell${short ? " yt-tall" : ""}`} data-col={j % 3} data-row={Math.floor(j / 3)}><img src={url} alt={`장면 #${n}`} loading="lazy" /></div>
            <button type="button" className={`yt-scene-btn${here.length ? " yt-has" : ""}`} aria-expanded={shown === n} onClick={() => { setShown(shown === n ? null : n); setDraft(""); }}>
              #{n} · {here.length ? `의견 ${here.length}` : "의견 남기기"}</button>
            {shown === n ? <div className="yt-scene-notes">
              {here.length ? <ul className="yt-scene-list">{here.map((row) => noteRow(row.note, row.state))}</ul> : null}
              {sheetAt === storyboardAt ? <form onSubmit={(event) => { event.preventDefault(); if (draft.trim()) void add(n); }}>
                <textarea rows={2} value={draft} maxLength={2000} onChange={(event) => setDraft(event.target.value)} placeholder="예) 글자가 칸을 넘어요 · 사진 대신 비교 도식으로" />
                <button type="submit" className="secondary-button compact" disabled={saving || !draft.trim()}>{saving ? "저장 중…" : "의견 저장"}</button>
              </form> : <small>기획표가 바뀌었어요. 화면을 새로 고친 뒤에 의견을 남겨요.</small>}
            </div> : null}
          </figure>;
        })}
      </div>)}
    </details> : null}
  </>;
}
