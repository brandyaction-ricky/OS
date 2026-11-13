"use client";
import { useCallback, useEffect, useState } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { noteKey, SCENE_NOTE_STATE, sceneNow, sceneNoteState, sceneWords, sheetCells, type SceneNotePin, type SceneNoteState, type SceneProposal } from "@/lib/myin-scene-notes";
import { useSession } from "./session-provider";

/** Scenes per 점검 시트 (the engine's preview(): 3 columns × 4 rows of equal cells, numbered in order). */
const PER_SHEET = 12;
interface SceneNote { id: string; version: number; text: string; who: string; whoId: string; at: string; status: string; deleted: boolean; declinedWhy: string;
  scene: SceneNotePin | null; sent: { at: string; name: string; jobId?: string } | null; proposal: SceneProposal | null }
interface Job { id: string; status: string; failReason: string | null; notes: string[] | null }
type Redraw = "pending" | "drawing" | "failed";
/** GET myin?sheets= : the signed sheets, the scenes of the storyboard they show, each cell's storyboard number (sheets our drawing made)
 *  and the last 바뀐 장면만 다시 그리기. */
export interface SceneSheetsReply { sheets: string[]; scenes?: { type: string; at: string }[]; storyboardAt?: string; cells?: number[] | null;
  redraw?: { state: Redraw; code: string | null } | null; drawn?: { at: string; scenes: number[]; lines: string[] } | null }
export const sceneSheets = (got: SceneSheetsReply) => ({ urls: got.sheets, scenes: got.scenes ?? [], storyboardAt: got.storyboardAt ?? "", cells: got.cells ?? null, drawn: got.drawn ?? null });
export type SceneSheets = ReturnType<typeof sceneSheets>;
const when = (value: string) => new Date(value).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * ③ 점검 시트 장면 의견 (직원 요청 2026-11-12, 후속): the sheets cut into their scenes with a folded note box under each, the notes
 * gathered on top. Chosen notes go to 내 AI as jobs that wait in turn; each comes back as a 수정안 for its scene, seen 수정 전 · 후
 * and applied one by one while the sheets stay open. A sheet is one frame per scene — movement, voice and sound are checked in the
 * 미리보기 · 완성 영상.
 */
export function MyinSceneNotes({ projectId, runId, token, short, storyboardAt, sheetCount, sheets, open, onOpen, canSend, canApply, onChanged, refresh, redraw, onRedraw }: {
  projectId: string; runId: string; token: string | null; short: boolean; storyboardAt: string; sheetCount: number; sheets: SceneSheets | null;
  open: boolean; onOpen: (open: boolean) => void; canSend: boolean; canApply: boolean; onChanged: () => Promise<void>; refresh: string;
  redraw: Redraw | null; onRedraw: () => Promise<void> }) {
  const { profile } = useSession();
  const [notes, setNotes] = useState<SceneNote[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [shown, setShown] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState("");
  // 여러 장면에 같은 의견 (직원 요청 11-13): scenes picked on the sheets, one comment saved under each of them.
  const [multi, setMulti] = useState(false);
  const [chosen, setChosen] = useState<number[]>([]);
  const [common, setCommon] = useState("");
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
  const cells = sheets ? sheetCells(sheets) : [];
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
  const canPick = (id: string) => sendable.some((row) => row.note.id === id);
  // The same words on several scenes read as one line (each scene keeps its own note, state and 수정안).
  const groups = [...rows.reduce((map, row) => map.set(noteKey(row.note.text), [...(map.get(noteKey(row.note.text)) ?? []), row]), new Map<string, typeof rows>()).values()];
  const order = [...chosen].sort((a, b) => a - b);
  const writeCommon = async (andSend: boolean) => {
    if (!order.length || !common.trim()) return;
    if (andSend && order.length > 20) { setError("내 AI에는 한 번에 20장면까지 보낼 수 있어요. 나눠서 보내 주세요."); return; }
    setSaving("common"); setError("");
    const ids: string[] = [];
    try {
      for (const n of order) ids.push((await apiRequest<{ item: { id: string } }>(base, { method: "POST", token,
        body: JSON.stringify({ target: "scene", scene: { runId, n, storyboardAt: sheetAt }, ver: 1, text: common }) })).item.id);
      if (andSend) await apiRequest("/api/v1/content/youtube-automation/ai-jobs", { method: "POST", token, body: JSON.stringify({ task: "scene-notes", sourceId: projectId, notes: ids }) });
      setCommon(""); setChosen([]); setMulti(false);
    } catch (reason) { setError(`${ids.length ? `장면 ${ids.length}개에는 저장했어요. ` : ""}${reason instanceof Error ? reason.message : "저장하지 못했어요."}`); }
    finally { setSaving(""); await load(); }
  };

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

  const listRow = ({ note, n, state }: (typeof rows)[number]) => <li key={note.id}>
    <input type="checkbox" aria-label="내 AI에 보낼 의견" disabled={!canSend || !canPick(note.id)} checked={picked.includes(note.id)}
      onChange={(event) => setPicked((now) => event.target.checked ? [...now, note.id] : now.filter((id) => id !== note.id))} />
    {n ? <button type="button" className="yt-scene-jump" onClick={() => go(n)}>#{n}</button>
      : <span className="yt-chip" title="기획표가 바뀌어 이 의견의 장면을 찾지 못했어요. 장면을 보고 다시 써 주세요.">{n === null ? "장면 못 찾음" : `#${note.scene?.n} (이전 시트)`}</span>}
    <span className="yt-scene-text"><b>{note.who}</b> {note.text}</span>
    <span className="yt-chip">{SCENE_NOTE_STATE[state]}</span>
  </li>;

  return <>
    {rows.length ? <div className="yt-note yt-scene-summary">
      <strong>장면 의견 {rows.length}개 · 대기 {count("waiting")} · 고치는 중 {count("fixing")} · 확인 필요 {count("check")} · 반영 {count("done")}</strong>
      <ul className="yt-scene-list">{groups.map((group) => group.length === 1 ? listRow(group[0]) : <li key={group[0].note.id} className="yt-scene-group">
        <input type="checkbox" aria-label="같은 의견 모두 고르기" disabled={!canSend || !group.some((row) => canPick(row.note.id))}
          checked={group.some((row) => canPick(row.note.id)) && group.filter((row) => canPick(row.note.id)).every((row) => picked.includes(row.note.id))}
          onChange={(event) => { const ids = group.filter((row) => canPick(row.note.id)).map((row) => row.note.id);
            setPicked((now) => event.target.checked ? [...new Set([...now, ...ids])] : now.filter((id) => !ids.includes(id))); }} />
        {group.map(({ note, n }) => n ? <button key={note.id} type="button" className="yt-scene-jump" onClick={() => go(n)}>#{n}</button> : <span key={note.id} className="yt-chip">장면 못 찾음</span>)}
        <span className="yt-scene-text"><b>{[...new Set(group.map((row) => row.note.who))].join(", ")}</b> {group[0].note.text}</span>
        <span className="yt-chip">같은 의견 {group.length}개 · {[...new Set(group.map((row) => row.state))].map((state) => `${SCENE_NOTE_STATE[state]} ${group.filter((row) => row.state === state).length}`).join(" · ")}</span>
        <details className="yt-scene-more"><summary>장면별로 보기</summary><ul className="yt-scene-list">{group.map(listRow)}</ul></details>
      </li>)}</ul>
      {canSend && sendable.length ? <div className="yt-actions">
        <button type="button" className="primary-button" disabled={Boolean(saving) || !picked.length} onClick={() => void send(picked)}>{saving === "send" ? "보내는 중…" : `고른 의견 ${picked.length}개 내 AI에 수정 요청`}</button>
        {picked.length ? <strong>장면 {rows.filter((row) => picked.includes(row.note.id)).map((row) => row.n ? `#${row.n}` : "?").join(" · ")}</strong> : null}
        <small>의견마다 그 장면만 고친 수정안이 와요. 앞에 보낸 요청이 아직 고치는 중이어도 이어서 보낼 수 있어요. 기획표는 「반영」을 누를 때만 바뀌어요.</small>
      </div> : null}
      {count("check") ? <p className="yt-note">수정안이 온 의견은 아래 점검 시트의 그 장면에서 수정 전 · 후를 보고 「반영」을 눌러요. 반영하면 바뀐 장면만 시트에 다시 그려져요.</p> : null}
      {error && !open ? <p className="yt-note yt-warn" role="alert">{error}</p> : null}
    </div> : null}
    {sheetCount ? <details className="yt-details" open={open} onToggle={(event) => onOpen((event.target as HTMLDetailsElement).open)}>
      <summary>점검 시트 {sheetCount}장 보기 · 장면마다 의견 남기기</summary>
      <p className="yt-note">장면마다 한 순간(한 컷)만 보여요. 움직임 · 전환 · 음성 · 효과음은 장면 미리보기와 완성 영상에서 따로 확인해요.{sheets?.cells
        ? " 칸마다 그 장면이 다 나온 모습이에요. 오프닝처럼 여러 칸인 장면은 같은 번호예요."
        : ` 이 시트는 칸 번호가 기획표와 어긋날 수 있고, 구독 요청 뒤 칸에는 앞 장면이 보일 수 있어요. ${canApply ? "「시트 다시 그리기」를 누르면 기획표 번호대로 다시 그려요." : "새로 만드는 미리보기부터는 바로잡혀요."}`}</p>
      {sheets && sheets.storyboardAt ? <p className="yt-note">{when(sheets.storyboardAt)} 기획표로 그린 시트예요.{redraw === "pending" || redraw === "drawing"
        ? " 반영한 장면을 영상 만드는 컴퓨터가 다시 그리는 중이에요. 끝나면 이 시트가 바로 바뀌어요."
        : redraw === "failed" ? " 바뀐 장면을 다시 그리지 못했어요." : sheets.storyboardAt !== storyboardAt ? " 그 뒤 반영한 수정이 있어요." : ""}
        {canApply && (redraw === "failed" || (!redraw && (!sheets.cells || sheets.storyboardAt !== storyboardAt)))
          ? <> <button type="button" className="secondary-button compact" onClick={() => void onRedraw()}>{redraw === "failed" ? "다시 그리기" : "시트 다시 그리기"}</button></> : null}</p> : null}
      {sheets?.drawn?.lines.length ? <p className="yt-note yt-warn">다시 그릴 때 걸린 곳: {sheets.drawn.lines.join(" / ")}</p> : null}
      {sheets?.urls.length ? <div className="yt-actions"><button type="button" className="secondary-button compact" aria-pressed={multi} onClick={() => { setMulti(!multi); setChosen([]); setShown(null); }}>
        {multi ? "여러 장면 고르기 끝" : "여러 장면에 같은 의견 쓰기"}</button></div> : null}
      {multi ? <div className="yt-note yt-scene-common">
        <strong>{order.length ? `고른 장면 ${order.map((n) => `#${n}`).join(" · ")} (${order.length}개)` : "아래에서 장면을 골라 주세요"}</strong>
        <textarea rows={2} value={common} maxLength={2000} onChange={(event) => setCommon(event.target.value)} placeholder="예) 강조 자막을 줄이고 이미지 · 도식 위주로" />
        <div className="yt-actions">
          <button type="button" className="secondary-button compact" disabled={Boolean(saving) || !order.length || !common.trim()} onClick={() => void writeCommon(false)}>{saving === "common" ? "저장 중…" : "의견 저장"}</button>
          {canSend ? <button type="button" className="primary-button compact" disabled={Boolean(saving) || !order.length || !common.trim()} onClick={() => void writeCommon(true)}>저장하고 내 AI에 수정 요청</button> : null}
          <small>고른 장면마다 같은 의견이 하나씩 저장돼요. 내 AI는 의견 한 번과 장면 목록을 받아 장면마다 수정안을 따로 만들어요.</small>
        </div>
      </div> : null}
      {error ? <p className="yt-note yt-warn" role="alert">{error}</p> : null}
      {sheets?.urls.map((url, sheet) => <div key={url} id={`yt-sheet-${sheet + 1}`} className="yt-scene-grid">
        {cells.slice(sheet * PER_SHEET, (sheet + 1) * PER_SHEET).map((n, j) => {
          const here = rows.filter((row) => row.n === n), cell = sheet * PER_SHEET + j;
          const image = <div className={`yt-scene-cell${short ? " yt-tall" : ""}`} data-col={j % 3} data-row={Math.floor(j / 3)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs from private storage; one sheet image cut by CSS */}
            <img src={url} alt={`장면 #${n}`} loading="lazy" /></div>;
          // An opening's later acts: the same scene, so its notes stay under its first cell.
          if (cell > 0 && cells[cell - 1] === n) return <figure key={`c${cell}`} className="yt-scene">{image}<small>#{n} 이어서</small></figure>;
          return <figure key={`c${cell}`} id={`yt-scene-${n}`} className="yt-scene">
            {image}
            {sheets.drawn?.scenes.includes(n) ? <small className="yt-chip">다시 그린 장면</small> : null}
            {multi ? <label className={`yt-scene-btn${chosen.includes(n) ? " yt-has" : ""}`}><input type="checkbox" checked={chosen.includes(n)}
              onChange={(event) => setChosen((now) => event.target.checked ? [...now, n] : now.filter((x) => x !== n))} /> #{n} 고르기</label>
              : <button type="button" className={`yt-scene-btn${here.length ? " yt-has" : ""}`} aria-expanded={shown === n} onClick={() => { setShown(shown === n ? null : n); setDraft(""); }}>
              #{n} · {here.length ? `의견 ${here.length}${here.some((row) => row.state === "check") ? " · 수정안 왔어요" : ""}` : "의견 남기기"}</button>}
            {!multi && shown === n ? <div className="yt-scene-notes">
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
