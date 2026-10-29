"use client";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { modelName } from "@/lib/cost";
import { GPT_TIERS, type GptTier } from "@/lib/youtube-process/gpt-draft";
import type { YpScreenCheck } from "@/lib/youtube-process/stages";
import { CostTag, tokenEstimate, useCostConfirm } from "./cost-notice";

/** Scenes per 점검 시트 (Logan's preview(): 3 × 4). */
const PER_SHEET = 12;

/** ③ 미리보기 › 화면 자동 검사 (owner 2026-10-29): GPT's look at the 점검 시트, which starts by itself when new sheets come in. */
export function MyinScreenCheck({ runId, preparedAt, token, onScene }: { runId: string; preparedAt: string; token: string | null; onScene: (sheet: number) => void }) {
  const [check, setCheck] = useState<YpScreenCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [tier, setTier] = useState<GptTier>("precise");
  const [error, setError] = useState("");
  const cost = useCostConfirm();
  const load = useCallback(async () => {
    try { setCheck((await apiRequest<{ check: YpScreenCheck | null }>(`/api/v1/content/youtube-automation/myin?screen=${runId}`, { token })).check); } catch { /* the card just stays as it was */ }
  }, [runId, token]);
  useEffect(() => { void load(); }, [load]);
  const current = check?.sheetsAt === preparedAt ? check : null;
  // New sheets start the check on the server; until it lands the card waits for it (one to three minutes).
  const waiting = busy || current?.state === "running" || (!current && Date.parse(preparedAt) > Date.now() - 10 * 60_000);
  useEffect(() => {
    if (!waiting || busy) return;
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [waiting, busy, load]);
  const again = async () => {
    const model = GPT_TIERS[tier].model;
    // Five sheets are about 15,000 image tokens; the answer and its thinking at most 8,000.
    if (!await cost.confirm({ model, amount: tokenEstimate(model, 20_000, 8_000), upTo: true, detail: "점검 시트를 GPT가 봐요", note: "GPT 크레딧(매달 500달러)에서 나가요.", ok: "검사하기" })) return;
    setBusy(true); setError("");
    try {
      setCheck((await apiRequest<{ check: YpScreenCheck | null }>("/api/v1/content/youtube-automation/myin", { token, method: "PATCH", body: JSON.stringify({ action: "screen_check", runId, tier }) })).check);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "화면 검사를 하지 못했어요."); } finally { setBusy(false); }
  };
  const scenes = current?.state === "done" ? current.scenes : [];
  const pill = waiting ? <span className="status-pill" data-status="waiting">GPT가 보는 중 · 1~3분</span>
    : current?.state === "done" ? <span className="status-pill" data-status={scenes.length ? "failed" : "approved"}>{scenes.length ? `확인할 장면 ${scenes.length}곳` : "✓ 문제 없음"}</span>
    : current?.state === "failed" ? <span className="status-pill" data-status="failed">⚠ 끝내지 못했어요</span>
    : <span className="status-pill" data-status="draft">아직 검사하지 않았어요</span>;
  const blocked = waiting ? "검사하는 중이에요" : current?.state === "done" ? "점검 시트가 그대로예요" : "";
  return <div className="yt-run" aria-label="화면 자동 검사">
    <div className="yt-run-head"><b>화면 자동 검사</b>{pill}{current?.state === "done" ? <small>{modelName(current.model)}</small> : null}</div>
    {current?.state === "failed" && !waiting ? <p className="yt-note">{current.error}</p> : null}
    {scenes.length ? <ul className="yt-list">{scenes.map((item, index) => <li key={index}>
      <button type="button" className="secondary-button compact" onClick={() => onScene(Math.ceil(item.scene / PER_SHEET))}>장면 #{item.scene}</button> <b>{item.kind}</b> · {item.issue}
      {item.fix ? <div className="yt-note" style={{ margin: "2px 0 0" }}>→ {item.fix}</div> : null}</li>)}</ul> : null}
    {current?.state === "done" && current.note ? <p className="yt-note">{current.note}</p> : null}
    <div className="yt-actions">
      <select aria-label="검사 모델" value={tier} disabled={Boolean(blocked)} onChange={(event) => setTier(event.target.value as GptTier)}>
        {(Object.keys(GPT_TIERS) as GptTier[]).map((key) => <option key={key} value={key}>{GPT_TIERS[key].label} · {modelName(GPT_TIERS[key].model)}</option>)}</select>
      <button type="button" className="secondary-button compact" disabled={Boolean(blocked)} title={blocked || undefined} onClick={() => void again()}>{current ? "다시 검사" : "검사하기"} <CostTag kind="paid" /></button>
      <small>참고용이에요. 미리보기와 최종본은 막지 않아요.</small>
    </div>
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
    {cost.element}
  </div>;
}
