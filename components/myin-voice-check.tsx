"use client";
import { personName } from "@/lib/youtube-process/project";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { CostTag } from "./cost-notice";

interface VoiceCheckData {
  sentences: number | null; listen: { at: number; p?: number; sentence: string; issues: string[]; score: number; long: number; joins?: string[] }[] | null;
  fixes: { memo: string; ok: boolean; report: string }[]; previewUrl: string | null;
  /** 요청 2번 (2026-11-17): every sentence, and the takes asked for one of them (put up by the render PC that made the voice). */
  all?: { at: number; p: number; sentence: string }[] | null;
  takes?: { p: number; text: string; state: "pending" | "listing" | "ready" | "failed"; code: string | null; files: { name: string; url: string; current: boolean }[] } | null;
  /** 발음 확인 (2026-11-22): words both transcriptions heard differently from the script (none for a voice made before it). */
  misreads?: { p: number; at: number; said: string; small: string; medium: string }[] | null;
  /** 쉼 검사 (로건 11-24): 띄워 읽음 · 덩어리 끊김 · 붙여 읽음 · 낱말 안 끊김, ‖ marking the place. */ pauses?: { p: number; at: number; kind: string; gap: number; text: string }[] | null;
  /** 쉼 점검 → 다시 낭독 (대표 11-24): how many times the caught sentences were voiced again by themselves (2 at most). */ pauseRounds?: number;
}
type Line = { at: number; p?: number; sentence: string };
/** Where 「음성 확인 · 수정」 may change a sentence: stage 1, and wherever the video waits for a person after it (the server says where it goes back to). */
const FIXABLE_AT = ["words_ready", "storyboard_review", "clips_review", "prep_ready", "final_ready"];
const takeNo = (name: string) => Number(/_(\d+)_t\.wav$/.exec(name)?.[1] ?? 0) + 1;
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
  const open = FIXABLE_AT.includes(stage);
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
  // 테이크 고르기: the render PC puts them up in a few seconds; the box looks again until they are there.
  const asking = data?.takes && (data.takes.state === "pending" || data.takes.state === "listing");
  useEffect(() => { if (!asking) return; const timer = setTimeout(() => void load(), 4000); return () => clearTimeout(timer); });
  const askTakes = async (line: Line) => {
    if (line.p === undefined) return;
    setBusy("takes"); setError("");
    try { await call("PATCH", { action: "voice_takes", p: line.p, text: line.sentence }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "테이크를 부르지 못했어요."); }
    finally { setBusy(""); }
  };
  const label = (line: Line, what: string) => `${mmss(line.at)} ${line.sentence.slice(0, 60)} · ${what}`;
  const tools = (line: Line) => open && fixable && line.p !== undefined ? <>
    <button type="button" className="secondary-button compact" disabled={Boolean(busy)} onClick={() => void askTakes(line)}>테이크 고르기</button>
    <button type="button" className="secondary-button compact" disabled={Boolean(busy)} title="이 문장 앞과 뒤에 0.2초씩 더 쉬어요(누를 때마다 더해요, 1초까지)"
      onClick={() => void act("pause", { action: "voice_fix", fixes: [{ memo: label(line, "앞뒤 쉼 +0.2초"), pause: { p: line.p, text: line.sentence, before: 0.2, after: 0.2 } }] })}>쉼 +0.2초</button>
  </> : null;
  const takesBox = data?.takes ? <div className="yt-note yt-takes">
    <strong>테이크 고르기 · {data.takes.text.slice(0, 60)}</strong>
    {asking ? <p>영상 만드는 컴퓨터가 이 문장의 테이크를 꺼내는 중이에요…</p>
      : data.takes.state === "failed" ? <p className="yt-warn">{data.takes.code === "MYIN_TAKES_UNAVAILABLE" ? "이 영상의 음성 패키지는 테이크 바꾸기를 못 해요(11/17 전 패키지). 메모로 다시 만들어 주세요."
        : data.takes.code === "MYIN_TAKES_NO_VOICE" ? "영상 만드는 컴퓨터에 이 영상의 음성 작업 폴더가 없어요." : "테이크를 꺼내지 못했어요. 다시 눌러 주세요."}</p>
      : <><ul className="yt-take-list">{data.takes.files.map((file) => <li key={file.name}>
          <span className="yt-take-no">테이크 {takeNo(file.name)}</span><audio controls preload="none" src={file.url} />
          {file.current ? <small>지금 쓰는 것</small> : open && fixable ? <button type="button" className="secondary-button compact" disabled={Boolean(busy)}
            onClick={() => { const line = data.all?.find((row) => row.p === data.takes!.p && row.sentence === data.takes!.text) ?? { at: 0, p: data.takes!.p, sentence: data.takes!.text };
              void act("take", { action: "voice_fix", fixes: [{ memo: label(line, `테이크 ${takeNo(file.name)}로 바꾸기`), take: { p: data.takes!.p, text: data.takes!.text, name: file.name } }] }); }}>이걸로 바꾸기</button> : null}
        </li>)}</ul>
        <small>음성을 만들 때 이 문장으로 만들어 둔 테이크예요. 바꿔도 Fish 비용은 들지 않아요. 새로 만들려면 「메모」로 남겨요(유료).</small></>}
  </div> : null;
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
      {data.misreads?.length ? <div className="yt-note"><strong>잘못 읽은 것 같은 곳 {data.misreads.length}곳</strong>
        <small>받아쓰기 두 번(작은 모델 · 큰 모델)이 모두 대본과 다르게 들은 낱말이에요. 들어 보고 틀렸으면 [메모]를 눌러 읽는 글을 바꾸거나 음성 사전에 읽는 소리를 넣어, 그 문장만 다시 만들어요.</small>
        <ul className="yt-take-list yt-all-lines">{data.misreads.map((row, at) => <li key={at}>
          <button type="button" className="secondary-button compact" disabled={!data.previewUrl} onClick={() => play(row.at)}>▶ {mmss(row.at)}</button>
          <span className="yt-line-text" title={`작은 모델: ${row.small || "(안 들림)"} · 큰 모델: ${row.medium || "(안 들림)"}`}>대본 「{row.said}」 → 들린 소리 「{row.medium || row.small || "안 들림"}」</span>
          {open && fixable ? <button type="button" className="secondary-button compact" onClick={() => { setTime(mmss(row.at)); setText(`「${row.said}」가 「${row.medium || row.small}」로 들림`.slice(0, 250)); }}>메모</button> : null}
        </li>)}</ul></div> : data.misreads ? <p><small>발음 확인: 잘못 읽은 것 같은 곳이 없어요.</small></p> : null}
      {data.pauses?.length ? <div className="yt-note"><strong>어색하게 쉰 곳 {data.pauses.length}곳</strong>
        {data.pauseRounds ? <small><b>걸린 문장을 저절로 {data.pauseRounds}번 다시 낭독했어요.</b> {data.pauseRounds >= 2 ? "그래도 남은 곳은 낭독 탓이 아니라 문장 탓이에요. 문장을 바꿔 주세요(예: 「첫 번째 결과」 → 「내 첫 결과」)." : ""}</small> : null}
        <small>‖ 자리에서 쉼이 어색해요. 띄워 읽음 = 붙여 읽을 곳에서 쉼, 덩어리 끊김 = 붙어야 할 두 낱말 사이에서 쉼, 붙여 읽음 = 문장 끝에서 안 쉼. 들어 보고 어색하면 [메모]로 그 문장만 다시 만들어요(두 번 넘게 남으면 문장을 바꿔요).</small>
        <ul className="yt-take-list yt-all-lines">{data.pauses.map((row, at) => <li key={at}>
          <button type="button" className="secondary-button compact" disabled={!data.previewUrl} onClick={() => play(row.at)}>▶ {mmss(row.at)}</button>
          <span className="yt-line-text">{row.kind} {row.gap.toFixed(2)}초 · {row.text}</span>
          {open && fixable ? <button type="button" className="secondary-button compact" onClick={() => { setTime(mmss(row.at)); setText(`${row.kind}(${row.gap.toFixed(2)}초): ${row.text}`.slice(0, 250)); }}>메모</button> : null}
        </li>)}</ul></div> : data.pauses ? <p><small>쉼 검사: 어색하게 쉰 곳이 없어요.</small></p> : null}
      {data.listen === null ? <p>이 영상은 들어 볼 문장 목록이 없어요(10/30 이전에 만든 음성).</p>
        : <><p><strong>들어 볼 문장 {data.listen.length}개</strong>{data.sentences ? <small> · 전체 {data.sentences}문장 중</small> : null}</p>
          {data.listen.length ? <ul className="yt-voice-list" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>{data.listen.map((row, at) => <li key={at} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <button type="button" className="secondary-button compact" disabled={!data.previewUrl} onClick={() => play(row.at)}>▶ {mmss(row.at)}</button>
            <span style={{ flex: "1 1 260px", minWidth: 0 }}>{row.sentence}<br /><small>{[row.score >= 0.8 ? `끊김 의심 ${row.issues.map(issue => issue.split(" ")[0]).join(" · ")}` : "", row.long ? `긴 한 호흡 ${row.long}음절` : "",
              row.joins?.length ? `이음 고침 ${row.joins.join(" · ")}` : ""].filter(Boolean).join(" · ")}</small></span>
            {tools(row)}
            {open && fixable ? <button type="button" className="secondary-button compact" onClick={() => { setTime(mmss(row.at)); setText(row.sentence.slice(0, 40)); }}>메모</button> : null}
          </li>)}</ul> : <p>기계가 찾은 어색한 문장이 없어요. 무작위로 두 문단만 들어 봐요.</p>}
          {data.all?.length ? <details><summary>모든 문장 {data.all.length}개 — 테이크 고르기 · 쉼 더하기</summary>
            <ul className="yt-take-list yt-all-lines">{data.all.map((row) => <li key={`${row.p}-${row.at}`}>
              <button type="button" className="secondary-button compact" disabled={!data.previewUrl} onClick={() => play(row.at)}>▶ {mmss(row.at)}</button>
              <span className="yt-line-text">{row.sentence}</span>{tools(row)}
            </li>)}</ul></details> : null}
          {takesBox}</>}
      {open && !fixable ? <p>이 영상은 10/30 16시 전에 시작해 문장만 다시 만들 수 없어요. 고칠 곳은 최종 검토 피드백에 남겨요.</p> : null}
      {open && fixable && stage !== "words_ready" ? <p><small>여기서 고치면 받아쓰기 · 자막을 다시 만들어요. 장면 그림 단계면 장면 그림도 다시, 완성 영상이 있으면 ④로 돌아가 「전체 영상 만들기」로 새 음성을 넣어요.</small></p> : null}
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
          {!check && stage === "words_ready" ? <><button type="button" className="secondary-button" disabled={Boolean(busy) || memos.length > 0} onClick={() => void act("ok", { action: "voice_check", skipped: false })}>음성 확인 완료</button>
            <button type="button" className="text-button" disabled={Boolean(busy) || memos.length > 0} onClick={() => void act("skip", { action: "voice_check", skipped: true })}>확인 없이 바로 넘어가기</button></> : null}
        </div>
      </div> : null}
      <p style={{ marginTop: 10 }}><Link className="yp-lnk" href="/content/voice-dictionary">음성 사전 보기 · 고치기 →</Link></p>
    </>}
  </details>;
}
