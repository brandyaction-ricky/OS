"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Coins, Sparkles, Youtube, X } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { DEFAULT_COST_MODELS, GENERATION, GENERATION_INPUT, minuteEstimate, modelName, tokenEstimate, type CostModels, type GenerationAction } from "@/lib/cost";
import { useSession } from "./session-provider";
export { minuteEstimate, tokenEstimate, voiceEstimate } from "@/lib/cost";

// What a button costs (owner requests 2026-10-25 · 10-26): every button that costs something carries one of three tags, in every
// screen of the OS; free buttons (save, next, 컨펌 요청) stay plain. A paid API asks first, with the model and the estimate only.
export type CostKind = "paid" | "ai" | "youtube";
const KINDS: Record<CostKind, { label: string; title: string; icon: ReactNode }> = {
  paid: { label: "비용 발생", title: "누르면 사용하는 AI와 예상 비용을 먼저 보여 줘요.", icon: <Coins size={12} aria-hidden="true" /> },
  ai: { label: "내 AI 사용량", title: "내 AI 구독 사용량으로 처리돼요.", icon: <Sparkles size={12} aria-hidden="true" /> },
  youtube: { label: "유튜브 한도", title: "유튜브가 채널마다 하루에 쓸 수 있는 양을 정해 둬요.", icon: <Youtube size={12} aria-hidden="true" /> },
};
/** With `amount` (원) the tag says what the button costs instead of only that it costs (로건 QA 10/30: the price showed only after pressing). */
export function CostTag({ kind, amount, upTo, what }: { kind: CostKind; amount?: number | null; upTo?: boolean; what?: string }) {
  const info = KINDS[kind];
  const label = amount == null ? info.label : `${upTo ? "최대 " : ""}약 ${amount.toLocaleString("ko-KR")}원`;
  return <span className={`cost-tag cost-tag-${kind}`} title={info.title}>{info.icon}{what ? `${what} · ` : ""}{label}</span>;
}

let loaded: Promise<CostModels> | null = null;
/** The server's models for the paid buttons, fetched once per page load (the defaults until then, and in the demo). */
export function useCostModels() {
  const { accessToken, demo } = useSession();
  const [models, setModels] = useState(DEFAULT_COST_MODELS);
  useEffect(() => {
    if (demo || !accessToken) return;
    loaded ??= apiRequest<{ models: CostModels }>("/api/v1/costs", { token: accessToken }).then(result => result.models)
      .catch(() => { loaded = null; return DEFAULT_COST_MODELS; });
    let live = true;
    void loaded.then(next => { if (live) setModels(next); });
    return () => { live = false; };
  }, [accessToken, demo]);
  return models;
}

/** `amount` in 원 (null when the model is not in the price table); `upTo` for an upper bound; `detail` is what it is counted on;
 * `note` is one more line the person must read first (e.g. 참석자 동의 before a recording). */
export interface CostAsk { model: string; amount: number | null; upTo?: boolean; detail?: string; note?: string; ok: string }
type Ask = Omit<CostAsk, "ok">;

// The asks several screens share.
/** A meeting recording, transcribed every 10 minutes while it runs. */
export const recordAsk = (model: string): Ask => ({ model, amount: minuteEstimate(model, 60), detail: "녹음 1시간 기준",
  note: "참석자 모두에게 녹음과 자동 받아쓰기를 알리고 동의를 받은 뒤 시작해 주세요. 음성은 서버에 남기지 않아요." });
/** An audio file of `minutes` (null when its length could not be read). */
export const fileAsk = (model: string, minutes: number | null): Ask => minutes
  ? { model, amount: minuteEstimate(model, minutes), detail: `${Math.max(1, Math.round(minutes))}분 음성` }
  : { model, amount: minuteEstimate(model, 1), detail: "음성 1분 기준" };
/** The meeting AI 정리 of `text` (lib/server/meeting-summary.ts: Claude Sonnet, at most 8,000 tokens out). */
export const summaryAsk = (model: string, text: string): Ask => ({ model, amount: tokenEstimate(model, [...text].length + 1_500, 8_000), upTo: true,
  detail: `메모 ${[...text].length.toLocaleString("ko-KR")}자 기준` });
/** A company-AI generation (바로 받기). */
export const generationAsk = (models: CostModels, action: GenerationAction): Ask => {
  const { tier, output } = GENERATION[action], model = models[tier];
  return { model, amount: tokenEstimate(model, action === "comment_reply" ? 30_000 : GENERATION_INPUT, output), upTo: true, detail: "정본과 원문을 함께 보내요" };
};
/** How long an audio file plays, in minutes (null when the browser cannot read it). */
export function audioMinutes(file: Blob) {
  return new Promise<number | null>(resolve => {
    const url = URL.createObjectURL(file), audio = new Audio();
    const done = (value: number | null) => { URL.revokeObjectURL(url); resolve(value); };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration / 60 : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}
/**
 * A confirm dialog for a paid API: confirm(...) resolves true only when the person presses the go button. It renders into
 * document.body, so a screen's own button rules or a disabled <fieldset> around the paid button never restyle or disable it.
 */
export function useCostConfirm() {
  const dialog = useRef<HTMLDialogElement>(null), [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const answer = useRef<(ok: boolean) => void>(() => undefined);
  const [ask, setAsk] = useState<CostAsk | null>(null);
  const close = (ok: boolean) => { answer.current(ok); answer.current = () => undefined; dialog.current?.close(); };
  const confirm = (next: CostAsk) => new Promise<boolean>(resolve => { answer.current = resolve; setAsk(next); dialog.current?.showModal(); });
  const amount = ask?.amount == null ? "가격표에 없는 AI예요" : `${ask.upTo ? "최대 " : ""}약 ${ask.amount.toLocaleString("ko-KR")}원`;
  const element = !mounted ? null : createPortal(<dialog ref={dialog} className="cost-dlg" aria-labelledby="cost-dlg-title" onClose={() => close(false)}>
    <div className="cost-dlg-h"><Coins size={16} aria-hidden="true" /><span id="cost-dlg-title">비용이 들어요</span>
      <button type="button" className="cost-x" aria-label="닫기" onClick={() => close(false)}><X size={14} /></button></div>
    <dl className="cost-dlg-b">
      <dt>사용하는 AI</dt><dd>{ask ? modelName(ask.model) : ""}</dd>
      <dt>예상 비용</dt><dd><b>{amount}</b>{ask?.detail ? <small> · {ask.detail}</small> : null}</dd>
    </dl>
    {ask?.note ? <p className="cost-dlg-note">{ask.note}</p> : null}
    <div className="cost-dlg-f"><button type="button" className="cost-btn" onClick={() => close(false)}>취소</button>
      <button type="button" className="cost-btn cost-btn-go" autoFocus onClick={() => close(true)}>{ask?.ok}</button></div>
  </dialog>, document.body);
  return { confirm, element };
}
