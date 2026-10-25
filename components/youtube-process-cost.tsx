"use client";
import { useRef, useState, type ReactNode } from "react";
import { Coins, Sparkles, Youtube, X } from "lucide-react";
export { voiceEstimate } from "@/lib/youtube-process/cost";

// Who pays for a button (owner request 2026-10-25). Only buttons that cost something carry a tag; free ones (save, next step,
// 컨펌 요청) stay plain. Company money is the one case that asks first, with what it is for and about how much.
export type YpCost = "company" | "ai" | "youtube";
const COST: Record<YpCost, { label: string; title: string; icon: ReactNode }> = {
  company: { label: "회사 비용", title: "회사 계정에서 비용이 나가요. 누르면 예상 금액을 먼저 보여 줘요.", icon: <Coins size={12} aria-hidden="true" /> },
  ai: { label: "내 AI 사용량", title: "내 AI 구독 사용량을 써요. 회사 비용은 없어요.", icon: <Sparkles size={12} aria-hidden="true" /> },
  youtube: { label: "유튜브 한도", title: "비용은 없어요. 유튜브가 채널마다 하루에 올릴 수 있는 횟수를 정해 둬요.", icon: <Youtube size={12} aria-hidden="true" /> },
};
export function CostTag({ cost }: { cost: YpCost }) {
  const info = COST[cost];
  return <span className={`yp-cost yp-cost-${cost}`} title={info.title}>{info.icon}{info.label}</span>;
}

export interface YpCostAsk { what: string; amount: string; detail?: string; ok: string }
/** A confirm dialog for company money: ask(...) resolves true only when the person presses the go button. */
export function useCostConfirm() {
  const dialog = useRef<HTMLDialogElement>(null);
  const answer = useRef<(ok: boolean) => void>(() => undefined);
  const [ask, setAsk] = useState<YpCostAsk | null>(null);
  const close = (ok: boolean) => { answer.current(ok); answer.current = () => undefined; dialog.current?.close(); };
  const confirm = (next: YpCostAsk) => new Promise<boolean>(resolve => { answer.current = resolve; setAsk(next); dialog.current?.showModal(); });
  const element = <dialog ref={dialog} className="yp-modal yp-costdlg" aria-labelledby="yp-cost-title" onClose={() => close(false)}>
    <div className="yp-modal-h"><Coins size={16} className="yp-i" aria-hidden="true" /><span id="yp-cost-title">회사 비용이 들어요</span><span className="yp-sp" />
      <button type="button" className="yp-ib" aria-label="닫기" onClick={() => close(false)}><X size={14} /></button></div>
    <div className="yp-modal-b"><dl className="yp-kv">
      <dt>무엇에</dt><dd>{ask?.what}</dd>
      <dt>예상 비용</dt><dd><b>{ask?.amount}</b>{ask?.detail ? <span className="yp-muted"> · {ask.detail}</span> : null}</dd>
      <dt>누구 비용</dt><dd>회사 계정</dd></dl></div>
    <div className="yp-modal-f"><button type="button" className="yp-btn" onClick={() => close(false)}>취소</button>
      <button type="button" className="yp-btn yp-pri" onClick={() => close(true)}>{ask?.ok}</button></div>
  </dialog>;
  return { confirm, element };
}
