"use client";
import { personName } from "@/lib/youtube-process/project";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { CostTag } from "./cost-notice";

interface VoiceCheckData {
  sentences: number | null; listen: { at: number; sentence: string; issues: string[]; score: number; long: number }[] | null;
  fixes: { memo: string; ok: boolean; report: string }[]; previewUrl: string | null;
}
export interface MyinVoiceFixView { memo: string; say: string | null; read: string | null; name: string }
export interface MyinVoiceCheckView { skipped: boolean; name: string; at: string }
type Memo = { memo: string; say?: string; read?: string; video?: true };
/** 음성 고치기 범위 (0dfd9a37 보완 ①): what the memos make again, as the OS finds the sentences (lib/myin-voice-plan). */
export interface VoiceFixPlan { targets: { at: number; text: string; memos: Memo[] }[]; unplaced: Memo[][]; conflicts: string[][]; fixes: Memo[]; keep: number; sentences: number; final: boolean }
/** What Fish reads: the sentences found, and 120 letters for each one the render PC still has to find (as before this plan). */
export const planText = (plan: VoiceFixPlan) => [...plan.targets.map((target) => target.text), ...plan.unplaced.map(() => "가".repeat(120))].join("\n");
export const askVoicePlan = (token: string | null, runId: string, fixes: Memo[]) => apiRequest<VoiceFixPlan>("/api/v1/content/youtube-automation/myin",
  { method: "PATCH", token, body: JSON.stringify({ action: "voice_fix_plan", runId, fixes }) });

/** 다시 만들 문장 · 못 찾은 메모 · 그대로 두는 문장 · 다시 확인할 것, before the fix is sent (reading it changes and costs nothing). */
export function VoiceFixScope({ plan }: { plan: VoiceFixPlan }) {
  const merged = plan.targets.filter((target) => target.memos.length > 1).length + plan.unplaced.filter((group) => group.length > 1).length;
  return <div className="yt-note">
    <strong>다시 만들 문장 {plan.fixes.length}개</strong>{merged ? <small> · 같은 문장 메모는 하나로 합쳤어요</small> : null}
    <ul>{plan.targets.map((target) => <li key={`${target.at}-${target.text}`}>{mmss(target.at)} · {target.text}{target.memos.length > 1 ? ` (메모 ${target.memos.length}개)` : ""}</li>)}
      {plan.unplaced.map((group) => <li key={group[0].memo}>{group[0].memo} · 여기서는 문장을 못 찾았어요. 영상 만드는 컴퓨터가 시각으로 찾아요(확인 필요)</li>)}</ul>
    <small>그대로 두는 문장 {plan.unplaced.length ? "약 " : ""}{plan.keep}개{plan.sentences ? ` (전체 ${plan.sentences}문장)` : ""} · 받아쓰기 · 자막은 새 음성으로 저절로 다시 만들어요
      {plan.final ? " · 완성 영상은 [전체 영상 만들기]로 다시 만들어야 새 음성이 들어가요" : ""}</small>
    {plan.conflicts.length ? <p className="yt-warn" role="alert">같은 문장에 읽는 글이나 발음이 둘 이상이에요. 하나만 남겨 주세요: {plan.conflicts[0].join(" / ")}</p> : null}
  </div>;
}

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const when = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/**
 * 음성 확인·수정 (로건 OS 요청 2026-10-30): before the storyboard, listen to the sentences the render PC flagged, leave memos at their
 * times, and have only those sentences made again (his voice_fix; subtitles follow). Checking — or skipping it — is only recorded.
 */
export function MyinVoiceCheck({ runId, stage, fixable, pending, check, token, onChanged, askCost }: {
  runId: string; stage: string; fixable: boolean; pending: MyinVoiceFixView[]; check: MyinVoiceCheckView | null; token: string | null;
  onChanged: () => Promise<void>; askCost: (text: string, sentences: number) => Promise<boolean>;
}) {
  const [data, setData] = useState<VoiceCheckData | null>(null);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [time, setTime] = useState(""), [text, setText] = useState(""), [say, setSay] = useState(""), [read, setRead] = useState("");
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  const [plan, setPlan] = useState<VoiceFixPlan | null>(null);
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
  const memoKey = JSON.stringify(memos);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- memoKey stands for memos
  useEffect(() => { setPlan(null); if (memos.length) askVoicePlan(token, runId, memos).then(setPlan, () => setPlan(null)); }, [memoKey, runId, token]);
  const send = async () => {
    if (!plan || plan.conflicts.length) return;
    if (await askCost(planText(plan), plan.fixes.length)) await act("fix", { action: "voice_fix", fixes: memos });
  };

  if (stage === "words_pending" && pending.length) return <div className="yt-note">
    <strong>고친 곳 {pending.length}개를 다시 만드는 중</strong>
    <ul>{pending.map((fix, at) => <li key={at}>{fix.memo}{fix.say ? ` → 「${fix.say}」로 읽기` : ""}{fix.read ? ` · 발음 ${fix.read}` : ""}</li>)}</ul>
    <small>그 문장만 다시 만들고 받아쓰기 · 자막도 새로 만들어요.</small>
  </div>;
  return <details className="yt-details" onToggle={event => { if ((event.target as HTMLDetailsElement).open && !data) void load(); }}>
    <summary>{check ? check.skipped ? `음성 확인 없이 넘어감 · ${personName(check.name)} · ${when(check.at)}` : `음성 확인 완료 · ${personName(check.name)} · ${when(check.at)}` : "음성 확인 · 수정"}</summary>
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
        {memos.length ? plan ? <VoiceFixScope plan={plan} /> : <small>다시 만들 문장을 찾는 중…</small> : null}
        <div className="yt-actions">
          {memos.length ? <><button type="button" className="primary-button" disabled={Boolean(busy) || !plan || plan.conflicts.length > 0} onClick={() => void send()}>{busy === "fix" ? "보내는 중…" : `문장 ${plan?.fixes.length ?? memos.length}개 다시 만들기`}</button><small><CostTag kind="paid" /> 그 문장만 두 번 만들어 더 나은 것을 골라요</small></> : null}
          {!check ? <><button type="button" className="secondary-button" disabled={Boolean(busy) || memos.length > 0} onClick={() => void act("ok", { action: "voice_check", skipped: false })}>음성 확인 완료</button>
            <button type="button" className="text-button" disabled={Boolean(busy) || memos.length > 0} onClick={() => void act("skip", { action: "voice_check", skipped: true })}>확인 없이 바로 넘어가기</button></> : null}
        </div>
      </div> : null}
      <p style={{ marginTop: 10 }}><Link className="yp-lnk" href="/content/voice-dictionary">음성 사전 보기 · 고치기 →</Link></p>
    </>}
  </details>;
}
