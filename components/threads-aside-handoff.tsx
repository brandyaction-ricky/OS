"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { parseThreadsAsideResult, threadsAsideRequest } from "@/lib/threads-aside";
import { useSession } from "./session-provider";
import { CostTag } from "./cost-notice";

type Props = { item: OsRecord; dirty: boolean; onRefresh: () => Promise<void>; onJobsLoaded: (jobs: OsRecord[]) => void; jobRevision: string };
const problemText = (issue: unknown) => issue instanceof Error ? issue.message : "요청을 처리하지 못했습니다. 다시 시도해 주세요.";

export function ThreadsAsideHandoff({ item, dirty, onRefresh, onJobsLoaded, jobRevision }: Props) {
  const { accessToken } = useSession();
  const [jobs, setJobs] = useState<OsRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [requestText, setRequestText] = useState(""), [manualCopy, setManualCopy] = useState(false);
  const [resultText, setResultText] = useState("");
  const inFlight = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const loadJobs = useCallback(async () => {
    const response = await apiRequest<{ jobs: OsRecord[] }>(`/api/v1/content/automation/jobs?targetId=${item.id}&limit=500`, { token: accessToken });
    const own = response.jobs.filter(job => job.owner_id === item.owner_id && job.metadata.targetId === item.id && job.metadata.proc === "threads")
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.updated_at.localeCompare(a.updated_at));
    if (active.current) { setJobs(own); onJobsLoaded(own); setLoaded(true); }
    return own;
  }, [accessToken, item.id, item.owner_id, onJobsLoaded]);
  useEffect(() => {
    void loadJobs().catch(issue => { if (active.current) setError(problemText(issue)); }).finally(() => { if (active.current) setLoading(false); });
  }, [loadJobs, jobRevision, item.version]);
  const latestRequest = jobs[0];
  const open = jobs.find(job => ["backlog", "active"].includes(job.status))
    ?? (latestRequest?.status === "blocked" ? latestRequest : undefined);
  const completed = jobs.find(job => job.stage === "completed");
  const running = open?.status === "active" && open.metadata.via !== "copy";
  const blocked = open?.status === "blocked";
  const step = completed && !open ? 3 : open ? 2 : 1;
  const withBusy = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (issue) { if (active.current) setError(problemText(issue)); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const copyRequest = () => withBusy(async () => {
    if (dirty) throw new Error("수정한 원고를 먼저 저장해 주세요. 저장한 내용을 기준으로 집필을 요청합니다.");
    const { job } = await apiRequest<{ job: OsRecord }>("/api/v1/content/automation/jobs", { method: "POST", token: accessToken,
      body: JSON.stringify({ proc: "threads", targetId: item.id }) });
    if (!active.current) return;
    setJobs(previous => [job, ...previous.filter(row => row.id !== job.id)]);
    if (job.status === "active" && job.metadata.via !== "copy") throw new Error("다른 AI 작업 화면에서 이 원고를 처리 중입니다. 진행 상태를 확인해 주세요.");
    const instructions = await apiRequest<Record<string, unknown>>(`/api/v1/content/automation/jobs/${job.id}/instructions`, { token: accessToken });
    if (!active.current) return;
    const text = threadsAsideRequest(instructions, `${window.location.origin}/automation/threads?sel=${item.id}`, job.id);
    setRequestText(text);
    try {
      await navigator.clipboard.writeText(text); setManualCopy(false);
      setNotice("요청문을 복사했습니다. Aside 대화창에 붙여 넣고 실행해 주세요. 복사만으로 집필이 시작되지는 않습니다.");
    } catch {
      setManualCopy(true);
      throw new Error("요청은 준비됐지만 자동 복사가 차단됐습니다. 아래 요청문을 전체 선택해 직접 복사하고 Aside에 붙여 넣어 주세요.");
    }
  });
  const saveResult = () => withBusy(async () => {
    if (!open) throw new Error("먼저 이 원고의 집필 요청을 준비해 주세요.");
    const result = parseThreadsAsideResult(resultText);
    try {
      const response = await apiRequest<{ job: OsRecord }>(`/api/v1/content/automation/jobs/${open.id}/paste`, {
        method: "POST", token: accessToken, body: JSON.stringify({ result }) });
      const next = [response.job, ...jobs.filter(job => job.id !== response.job.id)];
      if (!active.current) return;
      setJobs(next); onJobsLoaded(next);
    } catch (issue) {
      // A lost response can follow a successful save. Only matching saved text confirms it.
      const latest = await loadJobs().catch(() => []);
      const saved = latest.find(job => job.id === open.id && job.stage === "completed");
      if (JSON.stringify((saved?.metadata.result as { posts?: unknown } | undefined)?.posts) !== JSON.stringify(result.posts)) throw issue;
    }
    setResultText(""); setRequestText(""); setManualCopy(false);
    setNotice("미승인 초안을 저장했습니다. 아래에서 본문과 댓글을 이어 읽어 보세요. 채택·승인·발행은 하지 않았습니다.");
    await onRefresh();
  });
  const refresh = () => withBusy(async () => {
    await loadJobs(); await onRefresh(); setNotice("현재 진행 상태를 확인했습니다.");
  });
  const closeRequest = () => withBusy(async () => {
    if (!open) return;
    const response = await apiRequest<{ job: OsRecord }>(`/api/v1/content/automation/jobs/${open.id}/cancel`, { method: "POST", token: accessToken, body: "{}" });
    if (!active.current) return;
    const next = [response.job, ...jobs.filter(job => job.id !== response.job.id)];
    setJobs(next); onJobsLoaded(next);
    setRequestText(""); setManualCopy(false); setResultText("");
    setNotice("이전 요청을 닫았습니다. 요청문을 새로 복사해 Aside에 보내 주세요. 이전 요청의 결과를 다시 붙여 넣지 마세요.");
  });

  return <section className="ca-v07-aside" aria-label="내 AI로 쓰레드 집필" aria-busy={busy || loading}>
    <h2>내 AI로 쓰레드 집필</h2>
    <ol className="ca-v07-aside-steps" aria-label="집필 진행 순서">
      <li aria-current={step === 1 ? "step" : undefined}>1. 요청문 복사</li>
      <li aria-current={step === 2 ? "step" : undefined}>2. Aside에서 실행</li>
      <li aria-current={step === 3 ? "step" : undefined}>3. 미승인 원고 확인</li>
    </ol>
    {loading ? <p role="status">이 원고의 집필 요청을 확인하고 있습니다…</p> : null}
    {running ? <div className="ca-v07-note"><strong>연결된 AI 작업 화면에서 처리 중입니다.</strong><p>이미 시작한 작업이 있어 새 요청을 만들지 않습니다. 완료 후 아래 버튼으로 원고를 불러오세요.</p></div>
      : blocked ? <div className="ca-v07-note"><strong>이전 집필 요청이 멈췄습니다.</strong><p>{String(open?.metadata.failureReason || "이전 요청을 닫고 최신 기획으로 다시 요청해 주세요.")}</p></div>
        : completed && !open ? <div className="ca-v07-note"><strong>미승인 원고가 도착했습니다.</strong><p>아래 원고를 확인해 주세요. 확인 전에는 기존 편집 원고에 자동으로 덮어쓰지 않습니다.</p><a href={`#threads-result-${completed.id}`}>도착한 원고 읽기 ↓</a></div>
          : <><p>OS가 준비한 정본·기획·근거를 Aside에 보내면 글을 씁니다. 요청문을 복사한 다음 <strong>Aside 대화창에 붙여 넣고 실행</strong>해 주세요.</p>
            <div className="ca-v07-actions"><button type="button" className="primary" disabled={busy || loading || !loaded || dirty} onClick={() => void copyRequest()}>{busy ? "처리 중…" : "내 AI에 보낼 요청문 복사"}</button><CostTag kind="ai"/></div>
            {open ? <p className="ca-v07-aside-hint">준비된 요청이 있습니다. 다시 복사해도 같은 요청을 사용합니다.</p> : null}</>}
    {completed && !open ? <details className="ca-v07-aside-more"><summary>다른 초안을 다시 요청하려면</summary><p>새 결과도 미승인으로 저장합니다. 현재 원고는 유지됩니다.</p><div className="ca-v07-actions"><button type="button" disabled={busy || loading || !loaded || dirty} onClick={() => void copyRequest()}>내 AI에 보낼 요청문 복사</button><CostTag kind="ai"/></div></details> : null}
    {open ? <details className="ca-v07-aside-more" open={manualCopy || undefined}>
      <summary>집필 요청 확인</summary>
      <p>현재 작업 ID: <code>{open.id}</code></p>
      <p>Aside는 전달받은 요청과 이 번호가 같은지 확인합니다. 다른 요청의 결과는 이곳에 저장하지 않습니다.</p>
      {requestText ? <label>복사할 집필 요청문<textarea aria-label="복사할 집필 요청문" readOnly rows={8} value={requestText} onFocus={event => event.target.select()} /><small>복사한 내용을 확인하거나, 전체 선택한 뒤 직접 복사할 수 있습니다.</small></label> : null}
    </details> : null}
    {notice ? <p role="status" className="ca-v07-notice">{notice}</p> : null}
    {error ? <p role="alert" className="ca-v07-error">{error}</p> : null}
    {dirty ? <p className="ca-v07-note">편집한 내용이 있습니다. 먼저 아래 ‘저장’을 눌러 주세요.</p> : null}
    {open && !running && !blocked ? <div className="ca-v07-aside-result">
      <h3>Aside에서 받은 원고 가져오기</h3>
      <p>Aside가 이미 OS에 저장했다면 ‘진행 상태 확인’을 누르세요. 결과만 받았다면 아래에 붙여 넣으면 됩니다.</p>
      <label>Aside가 작성한 결과<textarea aria-label="Aside가 작성한 결과" rows={7} value={resultText} onChange={event => setResultText(event.target.value)} placeholder="Aside가 준 결과 블록 전체를 붙여 넣으세요." /></label>
      <button type="button" className="primary" disabled={busy || dirty || !resultText.trim()} onClick={() => void saveResult()}>미승인 초안 저장</button>
      <small>본문·댓글은 저장 후 이 화면에 표시됩니다. 자동 채택·승인·발행은 하지 않습니다.</small>
    </div> : null}
    <div className="ca-v07-actions"><button type="button" disabled={busy || dirty} onClick={() => void refresh()}>진행 상태 확인</button></div>
    {open && ["backlog", "blocked"].includes(open.status) ? <details className="ca-v07-aside-more"><summary>기획이 바뀌었거나 다시 시작해야 하나요?</summary>
      <p>이전 요청을 닫은 뒤 새 요청문을 복사하세요. 아직 저장하지 않은 Aside 결과는 새 요청에 사용할 수 없습니다.</p>
      <button type="button" disabled={busy} onClick={() => void closeRequest()}>이전 요청 닫기</button>
    </details> : null}
  </section>;
}
