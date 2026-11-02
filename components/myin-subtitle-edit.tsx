"use client";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { personName } from "@/lib/youtube-process/project";

interface Line { i: number; start: string; end: string; text: string; original: string; edited: boolean; conflict: boolean; wanted?: string }
interface State { lines: Line[]; issues: { i: number; note: string }[]; open: boolean; conflicts: number; pending: boolean;
  edits: { count: number; name: string; at: string; voiceRemade: boolean } | null }
const at = (time: string) => time.replace(/^0:/, "").replace(/\.\d+$/, "");

/**
 * 자막 한꺼번에 고치기 (유쓰 요청 1/8, 2026-11-02): find a typo across the subtitles, pick the lines, see what they become, change them all;
 * or fix the lines Logan's 자막 검수 flagged. Only words change — the voice and every time stay — and the video's subtitles and the SRT
 * follow the same edits the next time the video is made.
 */
export function MyinSubtitleEdit({ runId, token, stage, onFinal }: { runId: string; token: string | null; stage: string; onFinal: () => Promise<void> }) {
  const [state, setState] = useState<State | null>(null);
  const [find, setFind] = useState("");
  const [to, setTo] = useState("");
  const [off, setOff] = useState<Set<number>>(new Set());
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    try { setState(await apiRequest<State>(`/api/v1/content/youtube-automation/myin?subtitles=${runId}`, { token })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "자막을 불러오지 못했어요."); }
  };
  const save = async (changes: { i: number; to: string }[]) => {
    setBusy(true); setError("");
    try {
      await apiRequest("/api/v1/content/youtube-automation/myin", { method: "PATCH", token, body: JSON.stringify({ action: "subtitles", runId, changes }) });
      setOff(new Set()); setDrafts({}); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했어요."); } finally { setBusy(false); }
  };
  const matches = state && find ? state.lines.filter(line => line.text.includes(find)) : [];
  const picked = matches.filter(line => !off.has(line.i));
  const flagged = state ? state.issues.map(issue => ({ issue, line: state.lines[issue.i] })).filter(row => row.line) : [];
  const edited = state?.lines.filter(line => line.edited || line.conflict) ?? [];
  const lineInput = (line: Line) => <span className="yt-sub-ed">
    <input className="yp-in" aria-label={`${line.i}번 자막`} value={drafts[line.i] ?? line.text} disabled={!state?.open} onChange={(event) => setDrafts({ ...drafts, [line.i]: event.target.value })} />
    {drafts[line.i] !== undefined && drafts[line.i] !== line.text ? <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void save([{ i: line.i, to: drafts[line.i] }])}>저장</button> : null}</span>;
  return <details className="yt-details" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open && !state) void load(); }}>
    <summary>자막 고치기 (오타 한꺼번에){state?.edits?.count ? ` · 고친 줄 ${state.edits.count}개` : ""}</summary>
    {!state ? <p>{error || "불러오는 중…"}</p> : <div className="yt-sub">
      <p className="yt-note">글자만 바뀌어요. 목소리와 자막 시각은 그대로예요. 영상 속 자막과 유튜브 자막 파일(SRT)이 같이 바뀌어요.{state.open ? "" : " 지금은 음성이나 전체 영상을 만드는 중이라 고칠 수 없어요."}</p>
      {state.edits?.voiceRemade && state.conflicts ? <p className="yt-note yt-warn">음성을 다시 만든 뒤 고친 줄 {state.conflicts}개는 원래 글자가 달라져서 넣지 않았어요(확인 필요). 아래에서 다시 고쳐 주세요.</p> : null}
      {state.pending ? <div className="yt-actions"><span className="yt-note yt-warn">완성 영상에는 아직 고치기 전 자막이 들어 있어요.</span>
        {stage === "final_ready" ? <button type="button" className="primary-button" disabled={busy} onClick={() => { if (window.confirm("고친 자막으로 전체 영상을 다시 만들어요. 지금 완성본은 예전 버전으로 남아요. 만들까요?")) void onFinal().then(load); }}>고친 자막으로 전체 영상 다시 만들기</button>
          : <small>4단계에서 [전체 영상 만들기]를 누르면 고친 자막으로 만들어요.</small>}</div> : null}

      <div className="yt-sub-find">
        <input className="yp-in" aria-label="찾을 말" placeholder="찾을 말 (예: 마이안)" value={find} onChange={(event) => { setFind(event.target.value); setOff(new Set()); }} />
        <input className="yp-in" aria-label="바꿀 말" placeholder="바꿀 말 (예: 마이인)" value={to} onChange={(event) => setTo(event.target.value)} />
        <button type="button" className="primary-button compact" disabled={busy || !state.open || !find || !picked.length}
          onClick={() => void save(picked.map(line => ({ i: line.i, to: line.text.split(find).join(to) })))}>고른 {picked.length}줄 바꾸기</button></div>
      {find ? matches.length ? <ul className="yt-sub-list">{matches.map(line => <li key={line.i}><label>
        <input type="checkbox" checked={!off.has(line.i)} onChange={(event) => setOff(set => { const next = new Set(set); if (event.target.checked) next.delete(line.i); else next.add(line.i); return next; })} />
        <span className="yt-sub-at">{at(line.start)}</span><span>{line.text}</span><span aria-hidden="true">→</span><b>{line.text.split(find).join(to)}</b></label></li>)}</ul>
        : <p>「{find}」이 들어간 자막이 없어요.</p> : null}

      {flagged.length ? <details className="yt-details"><summary>자막 검사표에 걸린 줄 {flagged.length}개</summary>
        <ul className="yt-sub-list">{flagged.map(({ issue, line }) => <li key={issue.i}><span className="yt-sub-at">{at(line.start)}</span><small>{issue.note}</small>{lineInput(line)}</li>)}</ul></details> : null}
      {edited.length ? <details className="yt-details" open={Boolean(state.conflicts)}><summary>고친 줄 {edited.length}개{state.edits ? ` · ${personName(state.edits.name)}` : ""}</summary>
        <ul className="yt-sub-list">{edited.map(line => <li key={line.i}><span className="yt-sub-at">{at(line.start)}</span>
          {line.conflict ? <><small>확인 필요 · 넣으려던 글자 「{line.wanted}」</small>{lineInput(line)}</>
            : <><span>{line.original}</span><span aria-hidden="true">→</span><b>{line.text}</b>
              <button type="button" className="secondary-button compact" disabled={busy || !state.open} onClick={() => void save([{ i: line.i, to: line.original }])}>되돌리기</button></>}</li>)}</ul></details> : null}
      {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
    </div>}
  </details>;
}
