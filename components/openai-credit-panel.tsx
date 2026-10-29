"use client";
import { useEffect, useState } from "react";
import { getOpenAiCredit } from "@/lib/api-client";
import { won } from "@/lib/cost";
import { useSession } from "./session-provider";

type Credit = Awaited<ReturnType<typeof getOpenAiCredit>>;
const day = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric", timeZone: "UTC" });
const usd = (value: number) => `${value.toFixed(2)}달러`;

/** 연결 상태 tab: how much of this cycle's ChatGPT Pro API credit is left (owner request 2026-10-29). */
export function OpenAiCreditPanel() {
  const { accessToken, demo, profile } = useSession();
  const [credit, setCredit] = useState<Credit | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (demo || profile?.role !== "admin") return;
    let live = true;
    getOpenAiCredit(accessToken).then((value) => { if (live) setCredit(value); }, (reason) => { if (live) setError(reason instanceof Error ? reason.message : "GPT 크레딧을 불러오지 못했어요."); });
    return () => { live = false; };
  }, [accessToken, demo, profile?.role]);
  if (demo || profile?.role !== "admin") return null;
  const last = credit ? new Date(Date.parse(credit.end) - 86_400_000).toISOString() : "";
  return <section className="panel connection-evidence" aria-label="GPT API 크레딧">
    <header><h2>GPT API 크레딧</h2></header>
    {error ? <p className="inline-alert danger" role="alert">{error}</p>
      : !credit ? <p className="quiet-state">불러오는 중…</p>
      : !credit.configured ? <p>OpenAI 관리자 키(읽기 전용)를 연결하면 남은 크레딧이 보여요.</p>
      : <>
        <p><strong>약 {usd(credit.remaining ?? 0)} 남음</strong> (약 {won(credit.remaining ?? 0).toLocaleString("ko-KR")}원) · {usd(credit.credit)} 중 {usd(credit.spent ?? 0)} 사용</p>
        <progress max={credit.credit} value={Math.min(credit.credit, credit.spent ?? 0)} aria-label="사용한 크레딧" />
        <p className="field-hint">{day(credit.start)}~{day(last)} · 남은 크레딧은 {day(credit.end)}에 사라져요. 오늘 쓴 금액은 늦게 반영될 수 있어요.</p>
      </>}
  </section>;
}
