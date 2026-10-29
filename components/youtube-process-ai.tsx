"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Copy, Sparkles, X } from "lucide-react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { MyAiConnect } from "./my-ai-connect";
import { CostTag, tokenEstimate } from "./cost-notice";
import { modelName } from "@/lib/cost";
import { GPT_TIERS, isGptTask, type GptTier } from "@/lib/youtube-process/gpt-draft";
import { MY_AI_PROMPT, type StaffJobStatus } from "./youtube-production-steps";
import type { YpPage } from "./youtube-process-frame";
import type { YpPattern, YpPatterns } from "@/lib/youtube-process/stages";

// S12 내 AI (지시서 9장): the job goes to the requester's own Claude through the OS connection (owner decision 2026-10-17, already
// running for ② 원고 · ⑦ 업로드 자료), so the screen talks to the same staff-AI queue instead of a Chrome extension.
type Task = "script" | "kit" | "plan" | "shorts" | "short" | "niche" | "column" | "short-copy" | "retitle" | "short-topics" | "short-formula" | "short-script";
/** What the job hooks read from a page; 주제 찾기 › 틈새 passes its shared board as the project. */
type JobPage = Pick<YpPage, "demo" | "accessToken" | "profile"> & { bundle?: { project: { id: string; version: number } } | null; reload?: () => Promise<unknown> };
const TASK: Record<Task, { name: string; result: string }> = {
  "short-topics": { name: "숏폼 주제 뽑기", result: "롱폼 원고에서 숏폼 주제 후보 3개(통찰 한 줄 · 장면 · 원고 어디서)를 뽑아 줘요. 하나씩 숏폼으로 만들어요." },
  "short-formula": { name: "공식 · 주제 후보 뽑기", result: "참고 영상에서 헤드 카피 · 첫 문장 · 흐름 공식을 뽑고, 그 공식으로 주제 후보 3개를 내 줘요. PD가 하나를 골라 주제를 확정해요." },
  "short-script": { name: "숏폼 대본 쓰기", result: "주제를 확정할 때 고른 공식으로 헤드 카피와 대본을 써 줘요. PD가 다듬고 확정해요." },
  retitle: { name: "제목 · 썸네일 문구 다시 뽑기", result: "시장 영상에서 제목 공식 · 문구 공식을 뽑아 제목 8개 · 문구 8개를 따로 줘요. 하나씩 골라 짝을 만들어요." },
  niche: { name: "틈새 묶기", result: "터진 영상을 같은 제목 공식끼리 묶어 틈새 판에 넣어 줘요." },
  "short-copy": { name: "숏폼 제목 · 설명 쓰기", result: "쇼츠 제목과 설명을 써 줘요." },
  short: { name: "숏폼 장면 쓰기", result: "장면 3~8개를 자막 · 내레이션 · 필요한 이미지까지 채워 줘요. 광고면 구매 이유 후보도 줘요." },
  column: { name: "SEO 칼럼 쓰기", result: "정한 편수만큼 SEO 칼럼을 써 줘요." },
  shorts: { name: "쇼츠 대본 쓰기", result: "정한 편수만큼 쇼츠 대본을 써 줘요. PD가 고르고 확정해요." },
  plan: { name: "기획안 쓰기", result: "시장 영상에서 뽑은 공식대로 제목 후보 · 썸네일 후보를, 영상 흐름 초안과 함께 채워 줘요." },
  script: { name: "구성안 원고 쓰기", result: "원고 초안을 써서 새 버전으로 넣어 줘요." },
  kit: { name: "설명란 · 고정 댓글 만들기", result: "설명란 · 고정 댓글 · 다른 채널 문안을 만들어 줘요." },
};
const since = (iso: string | null) => iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)) : null;
const agoLabel = (minutes: number) => minutes < 1 ? "방금" : minutes < 90 ? `${minutes}분 전` : `${Math.round(minutes / 60)}시간 전`;

/** The latest job of one kind for this project, refreshed every 20 seconds while it is open. */
export function useStaffJob(page: JobPage, task: Task, onDone: () => void) {
  const [status, setStatus] = useState<StaffJobStatus | null>(null);
  const [available, setAvailable] = useState(true);
  const projectId = page.bundle?.project.id;
  const seenDone = useRef<string | null>(null);
  // Callers pass an inline onDone; held in a ref so a new function each render doesn't remake `load` and refetch forever.
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  const load = useCallback(async () => {
    if (!projectId || page.demo || !page.accessToken) return;
    try {
      const next = await apiRequest<StaffJobStatus>(`/api/v1/content/youtube-automation/ai-jobs?sourceId=${projectId}&task=${task}`, { token: page.accessToken });
      setStatus(next); setAvailable(true);
      if (next.job?.status === "done" && seenDone.current !== next.job.id) { if (seenDone.current !== null) done.current(); seenDone.current = next.job.id; }
      else if (seenDone.current === null) seenDone.current = next.job?.status === "done" ? next.job.id : "";
    } catch (reason) { if (reason instanceof ApiRequestError && reason.status === 404) setAvailable(false); }
  }, [projectId, page.demo, page.accessToken, task]);
  useEffect(() => { void load(); }, [load]);
  // 로건 피드백 10/26-12: a result that came in while the tab was in the background showed only after a refresh.
  useEffect(() => { const onFocus = () => void load(); window.addEventListener("focus", onFocus); return () => window.removeEventListener("focus", onFocus); }, [load]);
  const open = Boolean(status?.job && ["backlog", "active"].includes(status.job.status));
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [open, load]);
  return { status, available, open, load };
}

/** 칸 아래 작업 줄 (시안 jobLine): 대기 · 처리 중 · 못 함. */
export function JobLine({ job, onRetry }: { job: ReturnType<typeof useStaffJob>; onRetry: () => void }) {
  const current = job.status?.job;
  if (!current || current.status === "done" || current.status === "cancelled") return null;
  // GPT 초안: the OS itself is working on it, so there is nothing to connect or wait for.
  if (current.executor === "gpt") return current.status === "blocked"
    ? <div className="yp-jobl yp-fail"><span className="yp-tag yp-bad">못 함</span><span>{current.failReason ?? "GPT가 끝내지 못했어요."}</span><span className="yp-sp" /><button type="button" className="yp-btn yp-sm" onClick={onRetry}>다시 만들기</button></div>
    : <div className="yp-jobl yp-run"><span className="yp-tag yp-warn"><Sparkles size={12} aria-hidden="true" /> GPT 만드는 중</span><span>{current.issues.length ? "형식을 고치는 중이에요" : "3~6분 걸려요. 끝나면 이 칸에 들어가요"}</span></div>;
  const seen = since(job.status?.myAi.lastUsedAt ?? null);
  if (current.status === "backlog") return <>
    <div className="yp-jobl yp-wait"><span className="yp-tag yp-acc"><Clock size={12} aria-hidden="true" /> 내 AI 대기</span><span>{seen === null ? "내 AI가 아직 연결되지 않았어요" : `내 AI 마지막 확인: ${agoLabel(seen)}. 다음 확인 때 가져가요`}</span></div>
    {seen === null || seen > 30 ? <div className="yp-errline">[내 AI로 보내기] › 바로 시키기에서 문장을 복사해 붙여 넣어요.</div> : null}
  </>;
  if (current.status === "active") return current.issues.length
    ? <div className="yp-jobl yp-fail"><span className="yp-tag yp-bad">확인 필요</span><span>형식이 안 맞아요: {current.issues.join(" / ")} (내 AI가 고쳐서 다시 보내요)</span></div>
    : <div className="yp-jobl yp-run"><span className="yp-tag yp-warn">처리 중</span><span>내 AI가 쓰는 중이에요</span></div>;
  return <div className="yp-jobl yp-fail"><span className="yp-tag yp-bad">못 함</span><span>{current.failReason ?? "이유가 남지 않았어요."}</span><span className="yp-sp" /><button type="button" className="yp-btn yp-sm" onClick={onRetry}>다시 보내기</button></div>;
}

/** S12-2 내 AI로 보내기: opening it makes nothing; [대기열에 두기] or [맨 앞에 넣고 문장 복사] makes the one job. */
export type SendTab = "gpt" | "queue" | "now" | "paste";
export function SendDialog({ page, task, open, onClose, job, defaults, extra, queryDefault, initialTab }: {
  page: JobPage; task: Task; open: boolean; onClose: () => void; job: ReturnType<typeof useStaffJob>; defaults?: { minutes: number };
  /** Which way the dialog opens on: GPT 초안 tasks open on GPT unless the screen's 「내 AI에게 맡기기」 opened it. */
  initialTab?: SendTab;
  /** 기획안 · 다시 뽑기: the 기획실 참고 영상 검색어 the OS searches before the job (the PD can change it). */
  queryDefault?: string;
  /** Fields the task needs beyond the project (다시 뽑기: slot · reason). */
  extra?: Record<string, unknown>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const gptOk = isGptTask(task);
  const [tab, setTab] = useState<SendTab>(gptOk ? "gpt" : "queue");
  const [tier, setTier] = useState<GptTier>("precise");
  const [minutes, setMinutes] = useState(defaults?.minutes ?? 10);
  // 쇼츠 대본 · 칼럼: how many the PD asks for (owner request 2026-10-25; the 숏폼 정본 says 3~5 shorts per longform).
  const [count, setCount] = useState(task === "shorts" ? 3 : 1);
  const maxCount = task === "shorts" ? 8 : 5;
  const [role, setRole] = useState("유입형");
  const [query, setQuery] = useState(queryDefault ?? "");
  const searches = task === "plan" || task === "retitle";
  // 숏폼 주제 · 대본: without fetched 참고 영상 the OS searches the step's 검색어 for Shorts; the words are edited on that step, not here.
  const youtube = searches || task === "short-formula" || task === "short-script";
  const [attachments, setAttachments] = useState("");
  const [paste, setPaste] = useState({ manuscript: "", materials: "", axis: "", design: "", review: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (open) { dialog.current?.showModal(); setError(""); setCopied(false); if (defaults?.minutes) setMinutes(defaults.minutes); setQuery(current => current || queryDefault || ""); setTab(initialTab ?? (gptOk ? "gpt" : "queue")); } else dialog.current?.close(); }, [open, defaults?.minutes, queryDefault, initialTab, gptOk]);
  const info = TASK[task];
  const projectId = page.bundle?.project.id;
  const running = job.status?.job?.status === "active";
  const byGpt = job.status?.job?.executor === "gpt";
  const waiting = job.status?.job?.status === "backlog";
  const connected = (job.status?.myAi.keys ?? 0) > 0;
  const send = async (copy: boolean, gpt?: GptTier) => {
    if (!projectId || !page.accessToken) return;
    setBusy(true); setError("");
    try {
      const body = task === "script" ? { task, sourceId: projectId, targetMinutes: minutes, role, ...(attachments.trim() ? { attachments: attachments.trim() } : {}) }
        : task === "shorts" || task === "column" ? { task, sourceId: projectId, count } : { task, sourceId: projectId, ...extra, ...(searches && query.trim() ? { query: query.trim() } : {}) };
      await apiRequest("/api/v1/content/youtube-automation/ai-jobs", { method: "POST", token: page.accessToken, body: JSON.stringify(gpt ? { ...body, gpt } : body) });
      if (copy) { await navigator.clipboard.writeText(MY_AI_PROMPT).catch(() => undefined); setCopied(true); }
      await job.load();
      if (!copy) onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "보내지 못했어요."); } finally { setBusy(false); }
  };
  const submitPaste = async () => {
    if (!projectId || !page.accessToken || !page.bundle) return;
    setBusy(true); setError("");
    try {
      await apiRequest("/api/v1/content/youtube-automation/script", { method: "POST", token: page.accessToken,
        body: JSON.stringify({ sourceId: projectId, action: "submit", expectedVersion: page.bundle.project.version, targetMinutes: minutes, bundle: { ...paste, canonBundle: "" } }) });
      setPaste({ manuscript: "", materials: "", axis: "", design: "", review: "" });
      onClose(); await page.reload?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "넣지 못했어요."); } finally { setBusy(false); }
  };
  const tabs: [SendTab, string][] = [...(gptOk ? [["gpt", "GPT로 바로 (추천)"] as [SendTab, string]] : []), ["queue", gptOk ? "내 AI가 가져가게 두기" : "내 AI가 가져가게 두기 (추천)"], ["now", "바로 시키기"], ...(task === "script" ? [["paste", "직접 붙여 넣기"] as [SendTab, string]] : [])];
  // A card plus its documents is about 60,000 letters in; the answer and its thinking at most 20,000 tokens.
  const gptModel = GPT_TIERS[tier].model, gptCost = tokenEstimate(gptModel, 60_000, 20_000);
  return <dialog ref={dialog} className="yp-modal" aria-labelledby={`yp-ai-${task}`} onClose={onClose} style={{ maxWidth: 640 }}>
    <div className="yp-modal-h"><span id={`yp-ai-${task}`}>{gptOk ? info.name : `내 AI로 보내기 · ${info.name}`}</span><span className="yp-sp" /><button type="button" className="yp-ib" aria-label="닫기" onClick={onClose}><X size={14} /></button></div>
    <div className="yp-modal-b">
      {waiting ? <div className="yp-note"><div>{byGpt ? "GPT가 곧 만들기 시작해요." : "이미 보낸 작업이 있어요. 내 AI가 다음에 확인할 때 가져가요."}</div></div> : null}
      <dl className="yp-kv" style={{ gridTemplateColumns: "76px minmax(0,1fr)", fontSize: 13, marginBottom: 10 }}>
        <dt>결과</dt><dd>{info.result}</dd>
        <dt>비용</dt><dd>{tab === "gpt" ? <><CostTag kind="paid" /> GPT 크레딧에서 나가요 · {modelName(gptModel)} 최대 약 {gptCost?.toLocaleString("ko-KR")}원</>
          : <><CostTag kind="ai" /> 내 AI 구독으로 처리돼요</>}{youtube ? <> <CostTag kind="youtube" /> 참고 영상은 유튜브에서 찾아요</> : null}</dd></dl>
      {searches ? <label className="yp-lbl" style={{ display: "block", marginBottom: 10 }}>참고 영상 검색어<span className="yp-gq">OS가 이 말로 유튜브를 찾아 조회수 5만 이상 · 구독자 대비 조회수 순으로 모아요 · 짧은 핵심어(예: 퇴사 고민)가 잘 찾아져요</span>
        <input className="yp-in" value={query} maxLength={60} onChange={event => setQuery(event.target.value)} placeholder="예) 퇴사 고민" /></label> : null}
      {task === "shorts" || task === "column" ? <label className="yp-lbl" style={{ display: "block", marginBottom: 10 }}>몇 편<span className="yp-gq">{task === "shorts" ? "영상 1편에 3~5편이 좋아요" : "편마다 다른 검색 질문을 겨냥해요"}</span>
        <input className="yp-in" type="number" min={1} max={maxCount} value={count} onChange={event => setCount(Math.min(maxCount, Math.max(1, Number(event.target.value) || 1)))} style={{ width: 90 }} /> 편</label> : null}
      {task === "script" ? <div className="yp-g2" style={{ marginBottom: 10 }}>
        <label className="yp-lbl" style={{ margin: 0 }}>목표 길이<span className="yp-gq">구성안 러닝타임</span><input className="yp-in" type="number" min={1} max={60} value={minutes} onChange={event => setMinutes(Number(event.target.value) || 10)} style={{ width: 90 }} /> 분</label>
        <label className="yp-lbl" style={{ margin: 0 }}>영상 목적<select className="yp-in" value={role} onChange={event => setRole(event.target.value)}>{["유입형", "전환형", "판매형"].map(item => <option key={item}>{item}</option>)}</select></label>
        <label className="yp-lbl" style={{ margin: 0, gridColumn: "1 / -1" }}>참고 자료 (선택) <span className="yp-gq">댓글 원문 등</span>
          <textarea className="yp-in" rows={3} value={attachments} onChange={event => setAttachments(event.target.value)} /></label>
      </div> : null}
      {running ? <div className="yp-note"><div>{byGpt ? "GPT가 만드는 중이에요." : "내 AI가 쓰는 중이에요."} 끝나면 이 칸에 들어가요.</div></div> : <>
        <div className="yp-seg2 yp-aitabs" role="tablist">{tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "yp-on" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>
        <div style={{ marginTop: 10 }}>
          {tab === "gpt" ? <div className="yp-kvbox"><b>GPT</b> <span className="yp-eta">3~6분</span><br />
            <span className="yp-muted" style={{ fontSize: 12 }}>OS가 회사 GPT로 바로 만들어 이 칸에 넣어요. 내 AI 연결이 없어도 돼요.</span>
            <div style={{ marginTop: 8 }}><select className="yp-in yp-sel1" aria-label="GPT 모델" value={tier} onChange={event => setTier(event.target.value as GptTier)}>
              {(Object.keys(GPT_TIERS) as GptTier[]).map(key => <option key={key} value={key}>{GPT_TIERS[key].label} · {modelName(GPT_TIERS[key].model)}</option>)}</select></div></div> : null}
          {tab === "queue" ? <div className="yp-kvbox"><b>내 AI</b><br /><span className="yp-eta">{job.status?.myAi.lastUsedAt ? `마지막 확인 ${agoLabel(since(job.status.myAi.lastUsedAt)!)}` : "아직 연결되지 않았어요"}</span><br />
            <span className="yp-muted" style={{ fontSize: 12 }}>내 AI가 다음에 확인할 때 가져가 쓰고, 끝나면 칸에 넣어요. 지금 바로 해야 하면 [바로 시키기]를 눌러요.</span></div> : null}
          {tab === "now" ? <><ol className="yp-nowsteps"><li>[보내고 문장 복사]를 눌러요</li><li>Claude(데스크톱 · 웹)에서 새 대화를 열고 붙여 넣어요</li><li>결과가 오면 이 칸에 들어가요. 그동안 대화는 열어 둬요</li></ol>
            <div className="yp-linkbox"><code>{MY_AI_PROMPT}</code></div>{copied ? <p className="yp-hint">복사했어요. Claude에 붙여 넣어 주세요.</p> : null}</> : null}
          {tab === "paste" ? <form onSubmit={event => { event.preventDefault(); void submitPaste(); }}>
            <p className="yp-hint" style={{ marginTop: 0 }}>다른 AI 창에서 쓴 원고를 붙여 넣어요.</p>
            {([["manuscript", "원고", 8], ["materials", "자료 표", 3], ["axis", "축", 2], ["design", "설계표", 3], ["review", "검토 기록", 3]] as const).map(([key, label, rows]) =>
              <label key={key} className="yp-lbl" style={{ display: "block" }}>{label}<textarea className="yp-in" rows={rows} value={paste[key]} onChange={event => setPaste(current => ({ ...current, [key]: event.target.value }))} /></label>)}
          </form> : null}
        </div>
        {!connected && tab !== "gpt" ? <details className="yp-card" style={{ marginTop: 10 }}><summary style={{ padding: "8px 10px", cursor: "pointer" }}>내 AI 연결하기 (처음 한 번)</summary><div style={{ padding: "0 10px 10px" }}><MyAiConnect /></div></details> : null}
      </>}
      {error ? <div className="yp-errline" role="alert">{error}</div> : null}
    </div>
    <div className="yp-modal-f">
      <button type="button" className="yp-btn" onClick={onClose}>{running ? "닫기" : "취소"}</button>
      {running ? null : tab === "gpt" ? <button type="button" className="yp-btn yp-pri" disabled={busy || (waiting && byGpt)} onClick={() => void send(false, tier)}><Sparkles size={14} /> GPT로 만들기</button>
        : tab === "queue" ? <button type="button" className="yp-btn yp-pri" disabled={busy || waiting} onClick={() => void send(false)}><Sparkles size={14} /> 보내기</button>
        : tab === "now" ? <button type="button" className="yp-btn yp-pri" disabled={busy} onClick={() => waiting ? void navigator.clipboard.writeText(MY_AI_PROMPT).then(() => setCopied(true)) : void send(true)}><Copy size={14} /> {waiting ? "문장 복사" : "보내고 문장 복사"}</button>
          : <button type="button" className="yp-btn yp-pri" disabled={busy || Object.values(paste).some(value => !value.trim())} onClick={() => void submitPaste()}>결과 넣기</button>}
    </div>
  </dialog>;
}

/** One formula: each pattern's skeleton (the repeated words with [slots]), how many references share it and which (패키징 정본 작업 순서 2). A one-sentence formula from before shows as it is. */
export function FormulaNote({ name, patterns, fallback, basis }: { name: string; patterns?: YpPattern[]; fallback?: string; basis?: string }) {
  if (!patterns?.length && !fallback) return null;
  return <div className="yp-note yp-gray" style={{ margin: "6px 0 8px", fontSize: 13, lineHeight: 1.5 }}><div style={{ width: "100%" }}><b>{name}</b>
    {patterns?.length ? <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>{patterns.map((pattern, index) => <li key={index} style={{ marginBottom: 4 }}>
      <b>{pattern.skeleton}</b> <span className="yp-muted">· {pattern.count}</span>
      {pattern.examples?.length ? <div className="yp-muted" style={{ fontSize: 12 }}>예: {pattern.examples.slice(0, 3).map(example => `「${example}」`).join(" ")}</div> : null}
      {pattern.thumbs?.length ? <div className="yp-muted" style={{ fontSize: 12 }}>썸네일 {pattern.thumbs.join(" · ")}번</div> : null}</li>)}</ol>
      : <> {fallback}{basis ? <details style={{ marginTop: 4 }}><summary style={{ cursor: "pointer" }}>근거 보기</summary>{basis}</details> : null}</>}</div></div>;
}

/** All the formulas behind an AI 기획안: title patterns, then main · sub copy patterns. */
export function PatternsBox({ patterns }: { patterns: YpPatterns }) {
  return <>{patterns.market ? <div className="yp-muted" style={{ fontSize: 12 }}>참고 영상: 「{patterns.market.query}」 시장 영상 {patterns.market.count}편 (조회수 5만+ · 구독자 대비 조회수 순)</div> : null}
    <FormulaNote name="제목 공식" patterns={patterns.titlePatterns} />
    <FormulaNote name="썸네일 메인 카피 공식" patterns={patterns.copyPatterns.main} />
    <FormulaNote name="썸네일 서브 카피 공식" patterns={patterns.copyPatterns.sub} /></>;
}
