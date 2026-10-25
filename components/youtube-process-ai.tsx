"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Copy, Sparkles, X } from "lucide-react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { MyAiConnect } from "./my-ai-connect";
import { CostTag } from "./youtube-process-cost";
import { MY_AI_PROMPT, type StaffJobStatus } from "./youtube-production-steps";
import type { YpPage } from "./youtube-process-frame";

// S12 내 AI (지시서 9장): the job goes to the requester's own Claude through the OS connection (owner decision 2026-10-17, already
// running for ② 원고 · ⑦ 발행키트), so the screen talks to the same staff-AI queue instead of a Chrome extension.
type Task = "script" | "kit" | "plan" | "shorts" | "short" | "niche" | "column" | "short-copy";
/** What the job hooks read from a page; 주제 찾기 › 틈새 passes its shared board as the project. */
type JobPage = Pick<YpPage, "demo" | "accessToken" | "profile"> & { bundle?: { project: { id: string; version: number } } | null; reload?: () => Promise<unknown> };
const TASK: Record<Task, { name: string; result: string }> = {
  niche: { name: "틈새 묶기", result: "터진 영상을 같은 제목 공식끼리 묶어 틈새 판에 넣어 줘요." },
  "short-copy": { name: "숏폼 제목 · 설명 쓰기", result: "쇼츠 제목과 설명을 써 줘요." },
  short: { name: "숏폼 장면 쓰기", result: "장면 3~8개를 자막 · 내레이션 · 필요한 이미지까지 채워 줘요. 광고면 구매 이유 후보도 줘요." },
  column: { name: "SEO 칼럼 쓰기", result: "정한 편수만큼 SEO 칼럼을 써 줘요." },
  shorts: { name: "쇼츠 대본 쓰기", result: "정한 편수만큼 쇼츠 대본을 써 줘요. PD가 고르고 확정해요." },
  plan: { name: "기획안 쓰기", result: "제목 후보 · 썸네일 시안 · 영상 흐름 초안을 채워 줘요." },
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
export function SendDialog({ page, task, open, onClose, job, defaults }: {
  page: JobPage; task: Task; open: boolean; onClose: () => void; job: ReturnType<typeof useStaffJob>; defaults?: { minutes: number };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"queue" | "now" | "paste">("queue");
  const [minutes, setMinutes] = useState(defaults?.minutes ?? 10);
  // 쇼츠 대본 · 칼럼: how many the PD asks for (owner request 2026-10-25; the 숏폼 정본 says 3~5 shorts per longform).
  const [count, setCount] = useState(task === "shorts" ? 3 : 1);
  const maxCount = task === "shorts" ? 8 : 5;
  const [role, setRole] = useState("유입형");
  const [attachments, setAttachments] = useState("");
  const [paste, setPaste] = useState({ manuscript: "", materials: "", axis: "", design: "", review: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (open) { dialog.current?.showModal(); setError(""); setCopied(false); if (defaults?.minutes) setMinutes(defaults.minutes); } else dialog.current?.close(); }, [open, defaults?.minutes]);
  const info = TASK[task];
  const projectId = page.bundle?.project.id;
  const running = job.status?.job?.status === "active";
  const waiting = job.status?.job?.status === "backlog";
  const connected = (job.status?.myAi.keys ?? 0) > 0;
  const send = async (copy: boolean) => {
    if (!projectId || !page.accessToken) return;
    setBusy(true); setError("");
    try {
      await apiRequest("/api/v1/content/youtube-automation/ai-jobs", { method: "POST", token: page.accessToken,
        body: JSON.stringify(task === "script" ? { task, sourceId: projectId, targetMinutes: minutes, role, ...(attachments.trim() ? { attachments: attachments.trim() } : {}) }
          : task === "shorts" || task === "column" ? { task, sourceId: projectId, count } : { task, sourceId: projectId }) });
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
  const tabs: ["queue" | "now" | "paste", string][] = [["queue", "내 AI가 가져가게 두기 (추천)"], ["now", "바로 시키기"], ...(task === "script" ? [["paste", "직접 붙여 넣기"] as ["paste", string]] : [])];
  return <dialog ref={dialog} className="yp-modal" aria-labelledby={`yp-ai-${task}`} onClose={onClose} style={{ maxWidth: 640 }}>
    <div className="yp-modal-h"><span id={`yp-ai-${task}`}>내 AI로 보내기 · {info.name}</span><span className="yp-sp" /><button type="button" className="yp-ib" aria-label="닫기" onClick={onClose}><X size={14} /></button></div>
    <div className="yp-modal-b">
      {waiting ? <div className="yp-note"><div>이미 보낸 작업이 있어요. 내 AI가 다음에 확인할 때 가져가요.</div></div> : null}
      <dl className="yp-kv" style={{ gridTemplateColumns: "76px minmax(0,1fr)", fontSize: 13, marginBottom: 10 }}>
        <dt>결과</dt><dd>{info.result}</dd>
        <dt>비용</dt><dd><CostTag cost="ai" /> 회사 비용은 없어요</dd></dl>
      {task === "shorts" || task === "column" ? <label className="yp-lbl" style={{ display: "block", marginBottom: 10 }}>몇 편<span className="yp-gq">{task === "shorts" ? "영상 1편에 3~5편이 좋아요" : "편마다 다른 검색 질문을 겨냥해요"}</span>
        <input className="yp-in" type="number" min={1} max={maxCount} value={count} onChange={event => setCount(Math.min(maxCount, Math.max(1, Number(event.target.value) || 1)))} style={{ width: 90 }} /> 편</label> : null}
      {task === "script" ? <div className="yp-g2" style={{ marginBottom: 10 }}>
        <label className="yp-lbl" style={{ margin: 0 }}>목표 길이<span className="yp-gq">구성안 러닝타임</span><input className="yp-in" type="number" min={1} max={60} value={minutes} onChange={event => setMinutes(Number(event.target.value) || 10)} style={{ width: 90 }} /> 분</label>
        <label className="yp-lbl" style={{ margin: 0 }}>영상 목적<select className="yp-in" value={role} onChange={event => setRole(event.target.value)}>{["유입형", "전환형", "판매형"].map(item => <option key={item}>{item}</option>)}</select></label>
        <label className="yp-lbl" style={{ margin: 0, gridColumn: "1 / -1" }}>참고 자료 (선택) <span className="yp-gq">댓글 원문 등</span>
          <textarea className="yp-in" rows={3} value={attachments} onChange={event => setAttachments(event.target.value)} /></label>
      </div> : null}
      {running ? <div className="yp-note"><div>내 AI가 쓰는 중이에요. 끝나면 이 칸에 들어가요.</div></div> : <>
        <div className="yp-seg2 yp-aitabs" role="tablist">{tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "yp-on" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>
        <div style={{ marginTop: 10 }}>
          {tab === "queue" ? <div className="yp-kvbox"><b>내 AI</b><br /><span className="yp-eta">{job.status?.myAi.lastUsedAt ? `마지막 확인 ${agoLabel(since(job.status.myAi.lastUsedAt)!)}` : "아직 연결되지 않았어요"}</span><br />
            <span className="yp-muted" style={{ fontSize: 12 }}>내 AI가 다음에 확인할 때 가져가 쓰고, 끝나면 칸에 넣어요. 지금 바로 해야 하면 [바로 시키기]를 눌러요.</span></div> : null}
          {tab === "now" ? <><ol className="yp-nowsteps"><li>[보내고 문장 복사]를 눌러요</li><li>Claude(데스크톱 · 웹)에서 새 대화를 열고 붙여 넣어요</li><li>결과가 오면 이 칸에 들어가요. 그동안 대화는 열어 둬요</li></ol>
            <div className="yp-linkbox"><code>{MY_AI_PROMPT}</code></div>{copied ? <p className="yp-hint">복사했어요. Claude에 붙여 넣어 주세요.</p> : null}</> : null}
          {tab === "paste" ? <form onSubmit={event => { event.preventDefault(); void submitPaste(); }}>
            <p className="yp-hint" style={{ marginTop: 0 }}>다른 AI 창에서 쓴 원고를 붙여 넣어요.</p>
            {([["manuscript", "원고", 8], ["materials", "자료 표", 3], ["axis", "축", 2], ["design", "설계표", 3], ["review", "검수 기록", 3]] as const).map(([key, label, rows]) =>
              <label key={key} className="yp-lbl" style={{ display: "block" }}>{label}<textarea className="yp-in" rows={rows} value={paste[key]} onChange={event => setPaste(current => ({ ...current, [key]: event.target.value }))} /></label>)}
          </form> : null}
        </div>
        {!connected ? <details className="yp-card" style={{ marginTop: 10 }}><summary style={{ padding: "8px 10px", cursor: "pointer" }}>내 AI 연결하기 (처음 한 번)</summary><div style={{ padding: "0 10px 10px" }}><MyAiConnect /></div></details> : null}
      </>}
      {error ? <div className="yp-errline" role="alert">{error}</div> : null}
    </div>
    <div className="yp-modal-f">
      <button type="button" className="yp-btn" onClick={onClose}>{running ? "닫기" : "취소"}</button>
      {running ? null : tab === "queue" ? <button type="button" className="yp-btn yp-pri" disabled={busy || waiting} onClick={() => void send(false)}><Sparkles size={14} /> 보내기</button>
        : tab === "now" ? <button type="button" className="yp-btn yp-pri" disabled={busy} onClick={() => waiting ? void navigator.clipboard.writeText(MY_AI_PROMPT).then(() => setCopied(true)) : void send(true)}><Copy size={14} /> {waiting ? "문장 복사" : "보내고 문장 복사"}</button>
          : <button type="button" className="yp-btn yp-pri" disabled={busy || Object.values(paste).some(value => !value.trim())} onClick={() => void submitPaste()}>결과 넣기</button>}
    </div>
  </dialog>;
}
