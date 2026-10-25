"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Copy, Sparkles, X } from "lucide-react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { MyAiConnect } from "./my-ai-connect";
import { MY_AI_PROMPT, type StaffJobStatus } from "./youtube-production-steps";
import type { YpPage } from "./youtube-process-frame";

// S12 내 AI (지시서 9장): the job goes to the requester's own Claude through the OS connection (owner decision 2026-10-17, already
// running for ② 원고 · ⑦ 발행키트), so the screen talks to the same staff-AI queue instead of a Chrome extension.
type Task = "script" | "kit" | "plan" | "shorts" | "short" | "niche" | "column" | "short-copy";
/** What the job hooks read from a page; 주제 찾기 › 틈새 passes its shared board as the project. */
type JobPage = Pick<YpPage, "demo" | "accessToken" | "profile"> & { bundle?: { project: { id: string; version: number } } | null; reload?: () => Promise<unknown> };
const TASK: Record<Task, { name: string; skill: string; reads: string; result: string }> = {
  niche: { name: "틈새 묶기", skill: "OS가 보낸 묶기 규칙", reads: "터진 영상(채널 평소의 2배 이상) 제목 · 채널 · 배수", result: "같은 제목 공식끼리 묶은 틈새 → 틈새 판 (OS가 채널 수를 세어 확인된 주제 · 지켜보는 것 · 혼자 터뜨린 것으로 나눔)" },
  "short-copy": { name: "숏폼 제목 · 설명 쓰기", skill: "숏폼 콘텐츠 스킬 정본 (OS 문서)", reads: "완성한 장면(자막 · 내레이션) · 용도 · 할 행동 · 연결 페이지", result: "쇼츠 제목 한 줄 + 설명(핵심 · 할 행동 · 해시태그) → 내보내기 칸 (사람이 다듬고 올림)" },
  short: { name: "숏폼 장면 쓰기", skill: "숏폼 · 쇼츠 정본 · (광고) 소구점 정본 (OS 문서)", reads: "주제 · 무엇을 만들지(용도 · 길이 · 상품 · 행동 · 근거)", result: "(광고) 구매 이유 후보 + 장면 3~8개(자막 · 내레이션 · 필요한 이미지) → 장면 칸 (사람이 이미지를 넣고 다듬음)" },
  column: { name: "SEO 칼럼 쓰기", skill: "SEO 칼럼 만드는 절차 정본 (OS 문서)", reads: "구성안 원고 · 컨펌된 제목 · 정밀 타겟 · 올린 영상 주소", result: "정한 편수만큼 검색 · AI 최적화 HTML 칼럼(편마다 다른 검색 질문) → SEO 칼럼 칸 (사람이 이미지를 넣고 내보냄)" },
  shorts: { name: "쇼츠 대본 쓰기", skill: "숏폼 콘텐츠 스킬 정본 · 모드 A (OS 문서)", reads: "최종본 자막(SRT) · 컨펌된 제목", result: "정한 편수만큼 쇼츠 대본(카피 · 첫 3초 · 롱폼 구간 재구성 · 설명) → 쇼츠 목록 (PD가 고르고 대표 쇼츠 컨펌)" },
  plan: { name: "기획안 쓰기", skill: "기획 · 소구점 · 제목·썸네일 정본 (OS 문서)", reads: "주제 · 정밀 타겟 · 레퍼런스 · 전달 사항 · OS 인사이트", result: "제목 후보 3~6개 + 썸네일 시안 2~4개 + 영상 흐름 → 기획안 초안 (PD가 다듬고 대표 컨펌)" },
  script: { name: "구성안 원고 쓰기", skill: "원고 공정 정본 · 구조 · 말투 · 검수 정본 (OS 문서)", reads: "컨펌된 기획안(제목 A · B · C, 영상 흐름) · 정밀 타겟 · 레퍼런스 · OS 인사이트", result: "원고 초안 + 자료 · 축 · 설계 · 검수 기록 → 구성안 원고 새 버전 (사람이 다듬음)" },
  kit: { name: "설명란 · 고정 댓글 만들기", skill: "유튜브 발행 키트 절차 (OS 문서)", reads: "UTM 설정(1번) · 자막 SRT · 구성안 원고 · 컨펌된 제목 A", result: "설명란 6구역 + 고정 댓글 + 히든 태그 → 설명란 초안 (사람이 다듬음)" },
};
const since = (iso: string | null) => iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)) : null;
const agoLabel = (minutes: number) => minutes < 1 ? "방금" : minutes < 90 ? `${minutes}분 전` : `${Math.round(minutes / 60)}시간 전`;

/** The latest job of one kind for this project, refreshed every 20 seconds while it is open. */
export function useStaffJob(page: JobPage, task: Task, onDone: () => void) {
  const [status, setStatus] = useState<StaffJobStatus | null>(null);
  const [available, setAvailable] = useState(true);
  const projectId = page.bundle?.project.id;
  const seenDone = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (!projectId || page.demo || !page.accessToken) return;
    try {
      const next = await apiRequest<StaffJobStatus>(`/api/v1/content/youtube-automation/ai-jobs?sourceId=${projectId}&task=${task}`, { token: page.accessToken });
      setStatus(next); setAvailable(true);
      if (next.job?.status === "done" && seenDone.current !== next.job.id) { if (seenDone.current !== null) onDone(); seenDone.current = next.job.id; }
      else if (seenDone.current === null) seenDone.current = next.job?.status === "done" ? next.job.id : "";
    } catch (reason) { if (reason instanceof ApiRequestError && reason.status === 404) setAvailable(false); }
  }, [projectId, page.demo, page.accessToken, task, onDone]);
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
    <div className="yp-jobl yp-wait"><span className="yp-tag yp-acc"><Clock size={12} aria-hidden="true" /> 내 AI 대기</span><span>{seen === null ? "내 Claude가 아직 OS를 확인한 적이 없어요" : `내 Claude가 ${agoLabel(seen)}에 마지막으로 확인했어요 · 다음 확인 때 가져가요`}</span></div>
    {seen === null || seen > 30 ? <div className="yp-errline">내 Claude에 아래 문장을 보내면 바로 가져가요. 처음이면 [내 AI로 보내기] 창의 연결 방법을 봐요.</div> : null}
  </>;
  if (current.status === "active") return current.issues.length
    ? <div className="yp-jobl yp-fail"><span className="yp-tag yp-bad">확인 필요</span><span>OS 검사에서 걸린 곳: {current.issues.join(" / ")} — 내 Claude가 고쳐서 다시 제출하면 넘어가요</span></div>
    : <div className="yp-jobl yp-run"><span className="yp-tag yp-warn">처리 중</span><span>내 Claude가 처리 중이에요 · 다른 방법으로 동시에 처리하지 않아요</span></div>;
  return <div className="yp-jobl yp-fail"><span className="yp-tag yp-bad">못 함</span><span>{current.failReason ?? "이유가 남지 않았어요."}</span><span className="yp-sp" /><button type="button" className="yp-btn yp-sm" onClick={onRetry}>다시 대기열</button></div>;
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
  const me = page.profile?.displayName ?? "나";
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
  const tabs: ["queue" | "now" | "paste", string][] = [["queue", "대기열에 두기 (권장)"], ["now", "지금 실행"], ...(task === "script" ? [["paste", "복사해서 처리"] as ["paste", string]] : [])];
  return <dialog ref={dialog} className="yp-modal" aria-labelledby={`yp-ai-${task}`} onClose={onClose} style={{ maxWidth: 640 }}>
    <div className="yp-modal-h"><span id={`yp-ai-${task}`}>내 AI로 보내기 · {info.name}</span><span className="yp-sp" /><button type="button" className="yp-ib" aria-label="닫기" onClick={onClose}><X size={14} /></button></div>
    <div className="yp-modal-b">
      {waiting ? <div className="yp-note"><div>이미 대기 중인 작업이 있어요. 내 Claude가 다음에 확인할 때 가져가요.</div></div>
        : <p className="yp-hint" style={{ margin: "0 0 8px" }}>열기만 해서는 작업이 생기지 않아요. 아래에서 고르고 눌러야 대기열에 들어가요.</p>}
      <dl className="yp-kv" style={{ gridTemplateColumns: "76px minmax(0,1fr)", fontSize: 13, marginBottom: 10 }}>
        <dt>읽을 스킬</dt><dd>{info.skill}</dd><dt>읽는 것</dt><dd>{info.reads}</dd><dt>결과</dt><dd>{info.result}</dd><dt>쓰는 구독</dt><dd>{me}의 Claude 구독 · 회사 서버 AI 없음</dd></dl>
      {task === "shorts" || task === "column" ? <label className="yp-lbl" style={{ display: "block", marginBottom: 10 }}>몇 편<span className="yp-gq">{task === "shorts" ? "롱폼 1편당 3~5편 (숏폼 정본)" : "편마다 다른 검색 질문을 겨냥해요"}</span>
        <input className="yp-in" type="number" min={1} max={maxCount} value={count} onChange={event => setCount(Math.min(maxCount, Math.max(1, Number(event.target.value) || 1)))} style={{ width: 90 }} /> 편</label> : null}
      {task === "script" ? <div className="yp-g2" style={{ marginBottom: 10 }}>
        <label className="yp-lbl" style={{ margin: 0 }}>목표 길이<span className="yp-gq">구성안 러닝타임</span><input className="yp-in" type="number" min={1} max={60} value={minutes} onChange={event => setMinutes(Number(event.target.value) || 10)} style={{ width: 90 }} /> 분</label>
        <label className="yp-lbl" style={{ margin: 0 }}>역할<span className="yp-gq">원고 공정 정본 §2</span><select className="yp-in" value={role} onChange={event => setRole(event.target.value)}>{["유입형", "전환형", "판매형"].map(item => <option key={item}>{item}</option>)}</select></label>
        <label className="yp-lbl" style={{ margin: 0, gridColumn: "1 / -1" }}>카드에 붙일 자료 <span className="yp-gq">선택 · 같은 고민을 다룬 영상 댓글 원문 6개 이상, 직접 고른 재료</span>
          <textarea className="yp-in" rows={3} value={attachments} onChange={event => setAttachments(event.target.value)} /></label>
      </div> : null}
      {running ? <div className="yp-note"><div>내 Claude가 처리 중이에요. 다른 방법으로 동시에 처리하지 않도록 막아 두었어요.</div></div> : <>
        <div className="yp-seg2 yp-aitabs" role="tablist">{tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "yp-on" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>
        <div style={{ marginTop: 10 }}>
          {tab === "queue" ? <div className="yp-kvbox"><b>{me}의 Claude</b><br /><span className="yp-eta">{job.status?.myAi.lastUsedAt ? `마지막 확인 ${agoLabel(since(job.status.myAi.lastUsedAt)!)}` : "아직 OS를 확인한 적이 없어요"}</span><br />
            <span className="yp-muted" style={{ fontSize: 12 }}>내 Claude가 OS 연결로 대기 작업을 가져가 처리해요. 예약 실행을 맡겨 두면 알아서 가져가요. 결과가 오면 이 칸에 들어가요.</span></div> : null}
          {tab === "now" ? <><ol className="yp-nowsteps"><li>[맨 앞에 넣고 문장 복사]를 눌러요</li><li>Claude(데스크톱 · 웹)에서 새 대화를 열고 붙여 넣어요</li><li>결과가 오면 이 칸에 들어가요 · 그동안 대화는 열어 둬요</li></ol>
            <div className="yp-linkbox"><code>{MY_AI_PROMPT}</code></div>{copied ? <p className="yp-hint">복사했어요. Claude에 붙여 넣어 주세요.</p> : null}</> : null}
          {tab === "paste" ? <form onSubmit={event => { event.preventDefault(); void submitPaste(); }}>
            <p className="yp-hint" style={{ marginTop: 0 }}>다른 AI 창이나 claude.ai 대화에서 쓴 원고를 붙여 넣어요. 내 AI 제출과 같은 형식 검사를 거쳐 같은 자리에 들어가요.</p>
            {([["manuscript", "원고 (§8 형식: # 제목, 머리 블록, ## 섹션, 문단)", 8], ["materials", "자료 표", 3], ["axis", "축", 2], ["design", "설계표", 3], ["review", "검수 기록", 3]] as const).map(([key, label, rows]) =>
              <label key={key} className="yp-lbl" style={{ display: "block" }}>{label}<textarea className="yp-in" rows={rows} value={paste[key]} onChange={event => setPaste(current => ({ ...current, [key]: event.target.value }))} /></label>)}
          </form> : null}
        </div>
        {!connected ? <details className="yp-card" style={{ marginTop: 10 }}><summary style={{ padding: "8px 10px", cursor: "pointer" }}>내 Claude가 아직 OS에 연결되지 않았어요 · 연결 방법 (처음 한 번)</summary><div style={{ padding: "0 10px 10px" }}><MyAiConnect /></div></details> : null}
      </>}
      {error ? <div className="yp-errline" role="alert">{error}</div> : null}
    </div>
    <div className="yp-modal-f">
      <button type="button" className="yp-btn" onClick={onClose}>{running ? "닫기" : "취소"}</button>
      {running ? null : tab === "queue" ? <button type="button" className="yp-btn yp-pri" disabled={busy || waiting} onClick={() => void send(false)}><Sparkles size={14} /> 대기열에 두기</button>
        : tab === "now" ? <button type="button" className="yp-btn yp-pri" disabled={busy} onClick={() => waiting ? void navigator.clipboard.writeText(MY_AI_PROMPT).then(() => setCopied(true)) : void send(true)}><Copy size={14} /> {waiting ? "문장 복사" : "맨 앞에 넣고 문장 복사"}</button>
          : <button type="button" className="yp-btn yp-pri" disabled={busy || Object.values(paste).some(value => !value.trim())} onClick={() => void submitPaste()}>결과 저장</button>}
    </div>
  </dialog>;
}
