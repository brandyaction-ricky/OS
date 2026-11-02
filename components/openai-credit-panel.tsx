"use client";
import { useEffect, useState } from "react";
import { getOpenAiCredit } from "@/lib/api-client";
import { won } from "@/lib/cost";
import { creditForecast } from "@/lib/openai-credit";
import { useSession } from "./session-provider";

type Credit = Awaited<ReturnType<typeof getOpenAiCredit>>;
const day = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric", timeZone: "UTC" });
const usd = (value: number) => `${value.toFixed(2)}달러`;

/** Admins only: this cycle's credit, or null while loading, in demo and for everyone else. */
function useOpenAiCredit() {
  const { accessToken, demo, profile } = useSession();
  const [credit, setCredit] = useState<Credit | null>(null);
  const [error, setError] = useState("");
  const shown = !demo && profile?.role === "admin";
  useEffect(() => {
    if (!shown) return;
    let live = true;
    getOpenAiCredit(accessToken).then((value) => { if (live) setCredit(value); }, (reason) => { if (live) setError(reason instanceof Error ? reason.message : "GPT 크레딧을 불러오지 못했어요."); });
    return () => { live = false; };
  }, [accessToken, shown]);
  return { shown, credit, error };
}

/** 관제실 시안 P3: the last 7 days as bars and when the credit runs out at that pace. */
function CreditForecast({ credit }: { credit: Credit }) {
  const forecast = creditForecast({ remaining: credit.remaining ?? 0, start: credit.start, end: credit.end, daily: credit.daily ?? [], now: new Date() });
  const top = Math.max(...forecast.week, 0.01);
  return <div className="os-credit">
    <svg className="os-credit-week" viewBox="0 0 70 24" role="img" aria-label={`최근 7일 사용: ${forecast.days.map((d, i) => `${day(d)} ${usd(forecast.week[i])}`).join(", ")}`}>
      {forecast.week.map((value, i) => { const h = value > 0 ? Math.max(2, (value / top) * 24) : 1; return <rect key={forecast.days[i]} x={i * 10 + 1} y={24 - h} width="8" height={h} rx="1.5" className={value > 0 ? "" : "empty"} />; })}
    </svg>
    <p>최근 7일 약 {usd(forecast.weekUsd)} · 하루 약 {usd(forecast.perDay)}</p>
    <p className={forecast.runOutAt ? "os-credit-out" : ""}>{forecast.runOutAt ? `이 속도면 ${day(forecast.runOutAt)}쯤 바닥나요 (갱신 ${day(credit.end)})`
      : forecast.perDay > 0 ? `이 속도면 갱신일(${day(credit.end)})까지 남아요` : "최근 7일 동안 쓴 금액이 없어요"}</p>
  </div>;
}

/** 연결 상태 tab: how much of this cycle's ChatGPT Pro API credit is left (owner request 2026-10-29). */
export function OpenAiCreditPanel() {
  const { shown, credit, error } = useOpenAiCredit();
  if (!shown) return null;
  const last = credit ? new Date(Date.parse(credit.end) - 86_400_000).toISOString() : "";
  return <section className="panel connection-evidence" aria-label="GPT API 크레딧">
    <header><h2>GPT API 크레딧</h2></header>
    {error ? <p className="inline-alert danger" role="alert">{error}</p>
      : !credit ? <p className="quiet-state">불러오는 중…</p>
      : !credit.configured ? <p>OpenAI 관리자 키(읽기 전용)를 연결하면 남은 크레딧이 보여요.</p>
      : <>
        <p><strong>약 {usd(credit.remaining ?? 0)} 남음</strong> (약 {won(credit.remaining ?? 0).toLocaleString("ko-KR")}원) · {usd(credit.credit)} 중 {usd(credit.spent ?? 0)} 사용</p>
        <progress max={credit.credit} value={Math.min(credit.credit, credit.spent ?? 0)} aria-label="사용한 크레딧" />
        <CreditForecast credit={credit} />
        <p className="field-hint">{day(credit.start)}~{day(last)} · 남은 크레딧은 {day(credit.end)}에 사라져요. 오늘 쓴 금액은 늦게 반영될 수 있어요.</p>
      </>}
  </section>;
}

/** 한눈에 보기 side pane: the same credit in a few lines (company GPT credit only — personal plans are not tracked, 10/10). */
export function OpenAiCreditCard() {
  const { shown, credit } = useOpenAiCredit();
  if (!shown || !credit?.configured) return null;
  return <div className="yp-ov-credit" aria-label="GPT 크레딧">
    <span className="yp-ov-k">회사 GPT 크레딧</span>
    <b>약 {usd(credit.remaining ?? 0)} 남음 <small>· 약 {won(credit.remaining ?? 0).toLocaleString("ko-KR")}원 · {usd(credit.credit)} 중</small></b>
    <CreditForecast credit={credit} />
  </div>;
}
