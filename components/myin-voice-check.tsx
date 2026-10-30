"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { CostTag } from "./cost-notice";

interface VoiceCheckData {
  sentences: number | null; listen: { at: number; sentence: string; issues: string[]; score: number; long: number }[] | null;
  fixes: { memo: string; ok: boolean; report: string }[]; previewUrl: string | null;
}
export interface MyinVoiceFixView { memo: string; say: string | null; read: string | null; name: string }
export interface MyinVoiceCheckView { skipped: boolean; name: string; at: string }
type Memo = { memo: string; say?: string; read?: string };

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const when = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/**
 * 음성 확인·수정 (로건 OS 요청 2026-10-30): before the storyboard, listen to the sentences the render PC flagged, leave memos at their
 * times, and have only those sentences made again (his voice_fix; subtitles follow). Checking — or skipping it — is only recorded.
 */
export function MyinVoiceCheck({ runId, stage, fixable, pending, check, token, onChanged, askCost }: {
  runId: string; stage: string; fixable: boolean; pending: MyinVoiceFixView[]; check: MyinVoiceCheckView | null; token: string | null;
  onChanged: () => Promise<void>; askCost: (sentences: number) => Promise<boolean>;
}) {
  const [data, setData] = useState<VoiceCheckData | null>(null);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [time, setTime] = useState(""), [text, setText] = useState(""), [say, setSay] = useState(""), [read, setRead] = useState("");
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const open = stage === "words_ready";
  const call = (method: "GET" | "PATCH", body?: Record<string, unknown>) => apiRequest<VoiceCheckData>(`/api/v1/content/youtube-automation/myin${method === "GET" ? `?voicecheck=${runId}` : ""}`,
    { token, ...(body ? { method, body: JSON.stringify({ runId, ...body }) } : {}) });
  const load = async () => { setError(""); try { setData(await call("GET")); } catch (reason) { setError(reason instanceof Error ? reason.message : "음성 확인을 열지 못했어요."); } };
  const play = (at: number) => { const el = audio.current; if (!el) return; el.currentTime = Math.max(0, at - 0.3); void el.play(); };
  const add = (memo = `${time.trim()} ${text.trim()}`.trim()) => {
    if (!memo) return;
    setMemos(list => [...list, { memo, ...(say.trim() ? { say: say.trim() } : {}), ...(read.trim() ? { read: read.trim() } : {}) }]);
    setTime(""); setText(""); setSay(""); setRead("");
  };
  const act = async (label: string, body: Record<string, unknown>) => {
    setBusy(label); setError("");
    try { await call("PATCH", body); setMemos([]); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "처리하지 못했어요."); }
    finally { setBusy(""); }
  };
  const send = async () => { if (await askCost(memos.length)) await act("fix", { action: "voice_fix", fixes: memos }); };

  if (stage === "words_pending" && pending.length) return <div className="yt-note">
    <strong>고친 곳 {pending.length}개를 다시 만드는 중</strong>
    <ul>{pending.map((fix, at) => <li key={at}>{fix.memo}{fix.say ? ` → 「${fix.say}」로 읽기` : ""}{fix.read ? ` · 발음 ${fix.read}` : ""}</li>)}</ul>
    <small>그 문장만 다시 만들고 받아쓰기 · 자막도 새로 만들어요.</small>
  </div>;
  return <details className="yt-details" onToggle={event => { if ((event.target as HTMLDetailsElement).open && !data) void load(); }}>
    <summary>{check ? check.skipped ? `음성 확인 없이 넘어감 · ${check.name} · ${when(check.at)}` : `음성 확인 완료 · ${check.name} · ${when(check.at)}` : "음성 확인 · 수정"}</summary>
    {error ? <p className="yt-note yt-warn" role="alert">{error}</p> : null}
    {!data ? <p>불러오는 중…</p> : <>
      {data.previewUrl ? <audio ref={audio} controls preload="none" src={data.previewUrl} style={{ width: "100%" }} /> : <p>이 영상은 여기서 들을 음성이 없어요. 위 「음성 내려받기」로 들어요.</p>}
      {data.fixes.length ? <div className="yt-note"><strong>지난번에 고친 곳</strong>
        <ul>{data.fixes.map((fix, at) => <li key={at}>{fix.ok ? "✓" : "✗"} {fix.memo}{fix.report ? <><br /><small style={{ whiteSpace: "pre-line" }}>{fix.report}</small></> : null}</li>)}</ul></div> : null}
      {data.listen === null ? <p>이 영상은 들어 볼 문장 목록이 없어요(10/30 이전에 만든 음성).</p>
        : <><p><strong>들어 볼 문장 {data.listen.length}개</strong>{data.sentences ? <small> · 전체 {data.sentences}문장 중</small> : null}</p>
          {data.listen.length ? <ul className="yt-voice-list" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>{data.listen.map((row, at) => <li key={at} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <button type="button" className="secondary-button compact" disabled={!data.previewUrl} onClick={() => play(row.at)}>▶ {mmss(row.at)}</button>
            <span style={{ flex: "1 1 260px", minWidth: 0 }}>{row.sentence}<br /><small>{[row.score >= 0.8 ? `끊김 의심 ${row.issues.map(issue => issue.split(" ")[0]).join(" · ")}` : "", row.long ? `긴 한 호흡 ${row.long}음절` : ""].filter(Boolean).join(" · ")}</small></span>
            {open && fixable ? <button type="button" className="secondary-button compact" onClick={() => { setTime(mmss(row.at)); setText(row.sentence.slice(0, 40)); }}>메모</button> : null}
          </li>)}</ul> : <p>기계가 찾은 어색한 문장이 없어요. 무작위로 두 문단만 들어 봐요.</p>}</>}
      {open && !fixable ? <p>이 영상은 10/30 16시 전에 시작해 문장만 다시 만들 수 없어요. 고칠 곳은 최종 검토 피드백에 남겨요.</p> : null}
      {open && fixable ? <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input className="input" style={{ width: 80 }} value={time} placeholder="02:03" aria-label="시각" onChange={event => setTime(event.target.value)} />
          {data.previewUrl ? <button type="button" className="secondary-button compact" onClick={() => { const el = audio.current; if (el) setTime(mmss(el.currentTime)); }}>지금 위치</button> : null}
          <input className="input" style={{ flex: "1 1 240px" }} value={text} maxLength={250} placeholder="들린 모양 (예: 사람과. 분위기는. 끊김)" aria-label="메모" onChange={event => setText(event.target.value)} />
        </div>
        <details><summary>읽는 글 · 발음 바꾸기 (선택)</summary>
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            <input className="input" value={say} maxLength={300} placeholder="이 문장을 이렇게 읽기 (원고 · 자막은 그대로)" aria-label="읽을 글" onChange={event => setSay(event.target.value)} />
            <input className="input" value={read} maxLength={100} placeholder="발음 사전에 넣기: 원래말=읽는소리 (예: AI=에이아이)" aria-label="발음" onChange={event => setRead(event.target.value)} />
          </div></details>
        <div><button type="button" className="secondary-button compact" disabled={!time.trim() && !text.trim()} onClick={() => add()}>메모 추가</button></div>
        {memos.length ? <ul>{memos.map((memo, at) => <li key={at}>{memo.memo}{memo.say ? ` → 「${memo.say}」` : ""}{memo.read ? ` · ${memo.read}` : ""} <button type="button" className="text-button" onClick={() => setMemos(list => list.filter((_, i) => i !== at))}>빼기</button></li>)}</ul> : null}
        <div className="yt-actions">
          {memos.length ? <><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void send()}>{busy === "fix" ? "보내는 중…" : `고친 곳 ${memos.length}개 다시 만들기`}</button><small><CostTag kind="paid" /> 그 문장만 두 번 만들어 더 나은 것을 골라요</small></> : null}
          {!check ? <><button type="button" className="secondary-button" disabled={Boolean(busy) || memos.length > 0} onClick={() => void act("ok", { action: "voice_check", skipped: false })}>음성 확인 완료</button>
            <button type="button" className="text-button" disabled={Boolean(busy) || memos.length > 0} onClick={() => void act("skip", { action: "voice_check", skipped: true })}>확인 없이 바로 넘어가기</button></> : null}
        </div>
      </div> : null}
      <p style={{ marginTop: 10 }}><Link className="yp-lnk" href="/content/voice-dictionary">음성 사전 보기 · 고치기 →</Link></p>
    </>}
  </details>;
}
