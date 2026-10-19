"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { useSession } from "./session-provider";
import { StaffDesign, type StaffJobStatus } from "./youtube-production-steps";
import "./youtube-production-steps.css";

/**
 * ⑦ 발행키트 by the staff member's own AI (owner decision 2026-10-19), in place of the company-API button.
 * Hidden where the staff switch is off; the page then keeps its old button (onAvailable tells it which to show).
 */
export function YoutubeKitStaffAi({ sourceId, onAvailable, onDone }: { sourceId: string; onAvailable: (value: boolean) => void; onDone: () => Promise<void> }) {
  const { accessToken } = useSession();
  const [status, setStatus] = useState<StaffJobStatus | null>(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!accessToken) return;
    try { setStatus(await apiRequest<StaffJobStatus>(`/api/v1/content/youtube-automation/ai-jobs?sourceId=${encodeURIComponent(sourceId)}&task=kit`, { token: accessToken })); setAvailable(true); }
    catch (reason) { if (reason instanceof ApiRequestError && reason.status === 404) setAvailable(false); }
  }, [accessToken, sourceId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onAvailable(available); }, [available, onAvailable]);
  const open = Boolean(status?.job && ["backlog", "active"].includes(status.job.status));
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => { void load().then(onDone); }, 20_000);
    return () => window.clearInterval(timer);
  }, [open, load, onDone]);
  if (!available) return null;
  const send = async () => {
    setBusy(true); setError("");
    try { await apiRequest("/api/v1/content/youtube-automation/ai-jobs", { method: "POST", token: accessToken, body: JSON.stringify({ task: "kit", sourceId }) }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "보내지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <section className="panel yt-steps" aria-label="내 AI로 발행키트 만들기">
    <p>내 AI(Claude 또는 Codex)가 발행키트 절차 정본과 승인된 원고, 완성 영상의 자막을 읽고 제목·설명·태그·챕터·고정 댓글·체크리스트를 제출합니다. 회사 AI 비용은 들지 않습니다. 제출되면 아래 칸에 나타나고, 문안과 체크리스트를 검수합니다.</p>
    <StaffDesign status={status} busy={busy} onSend={() => void send()} />
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
  </section>;
}
