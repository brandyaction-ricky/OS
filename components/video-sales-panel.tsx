"use client";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { spanDays } from "@/lib/performance-period";
import type { Money, VideoSales } from "@/lib/video-sales";
import { useSession } from "./session-provider";

// 마이인 영상별 매출 (OS 개발 요청 2026-11-11): which videos bring purchases and net revenue, 구매 전 유입 first, 최초 유입 beside it.
type Sales = VideoSales & { from: string; to: string; measuredAt: string; stale?: { reason: string } };
const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const money = (m: Money) => `${m.orders.toLocaleString("ko-KR")}건 · ${won(m.net)}`;
const time = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const MAX_DAYS = 92;

/** The MYIN figures for [from, to] (the 매출 tab and the 요약 card read the same thing; the server keeps them five minutes). */
export function useVideoSales(from: string, to: string) {
  const { accessToken, demo } = useSession();
  const [sales, setSales] = useState<Sales | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const tooLong = spanDays(from, to) > MAX_DAYS;
  const load = useCallback(async (fresh = false) => {
    setBusy(true); setError("");
    try { setSales(await apiRequest<Sales>(`/api/v1/content/video-sales?${new URLSearchParams({ from, to, ...(fresh ? { fresh: "1" } : {}) })}`, { token: accessToken })); }
    catch (reason) { setSales(null); setError(reason instanceof Error ? reason.message : "마이인 매출을 불러오지 못했어요."); }
    finally { setBusy(false); }
  }, [accessToken, from, to]);
  useEffect(() => { if (!demo && !tooLong && from && to) void load(); }, [demo, tooLong, from, to, load]);
  return { sales, error: tooLong ? `매출은 ${MAX_DAYS}일까지 볼 수 있어요. 기간을 줄여 주세요.` : error, busy, load, demo, waiting: error.includes("배포 대기") };
}

export function VideoSalesPanel({ from, to }: { from: string; to: string }) {
  const { sales, error, busy, load, demo, waiting } = useVideoSales(from, to);
  if (demo) return <section className="panel perf-panel" aria-label="영상별 매출"><div className="empty-state">연습 화면에서는 마이인 매출을 불러오지 않아요.</div></section>;
  const t = sales?.totals;
  const share = (net: number) => t && t.youtube.l.net > 0 ? `${Math.round(net / t.youtube.l.net * 1000) / 10}%` : "—";
  const left = sales ? [...sales.unmapped.map((x) => ({ key: `u-${x.cnt}`, label: `미매핑 · ${x.cnt}`, money: x.money })), ...sales.conflicts.map((x) => ({ key: `c-${x.cnt}`, label: `충돌 · ${x.cnt} (${x.videoIds.join(", ")})`, money: x.money })),
    ...sales.nonVideo.map((x) => ({ key: `n-${x.cnt}-${x.cmp}`, label: `프로필·기타 · ${x.cnt ?? "content 없음"}${x.cmp ? ` · ${x.cmp}` : ""}`, money: x.money }))] : [];
  return <section className="panel perf-panel" aria-label="영상별 매출">
    <div className="card-head"><div><span className="card-title">영상별 매출 · 마이인</span><p className="section-meta">결제일 기준 · 구매 전 유입이 기본이고, 최초 유입은 같은 주문을 다르게 본 것이라 더하지 않아요{sales ? ` · 마이인 집계 ${time(sales.measuredAt)}` : ""}</p></div>
      <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void load(true)}>{busy ? "집계 중…" : "새로 집계"}</button></div>
    {error ? waiting ? <div className="empty-state">마이인 쪽 준비가 끝나면 여기에 영상별 매출이 보여요.</div> : <div className="os-callout" data-tone="danger" role="alert"><div className="os-callout-body">{error}</div></div> : null}
    {sales?.stale ? <div className="os-callout" data-tone="warn" role="status"><div className="os-callout-body">지금 값을 못 불러와 마지막으로 받은 값을 보여 줘요 · {sales.stale.reason}</div></div> : null}
    {t ? <div className="perf-metrics">
      {([["유튜브 순매출 · 구매 전 유입", t.youtube.l], ["영상에 연결", t.video.l], ["프로필·기타", t.nonVideo.l], ["미매핑·충돌", { orders: t.unmapped.l.orders + t.conflict.l.orders, net: t.unmapped.l.net + t.conflict.l.net }], ["유튜브 순매출 · 최초 유입", t.youtube.f]] as [string, Money][]).map(([label, m]) =>
        <div className="metric" key={label}><div className="metric-label">{label}</div><p className="metric-value is-sm">{won(m.net)}</p><div className="metric-note">{m.orders.toLocaleString("ko-KR")}건</div></div>)}
    </div> : null}
    {sales?.videos.length ? <div className="perf-table-wrap"><table className="data-table"><thead><tr><th>영상</th><th className="perf-num">구매 전 유입</th><th className="perf-num">비중</th><th className="perf-num">최초 유입</th><th>연결 코드</th></tr></thead><tbody>
      {sales.videos.map((video) => <tr key={video.videoId}><td><a className="cell-title" href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer">{video.title}</a>{video.channelTitle ? <small> · {video.channelTitle}</small> : null}</td>
        <td className="perf-num">{money(video.money.l)}</td><td className="perf-num">{share(video.money.l.net)}</td><td className="perf-num">{money(video.money.f)}</td><td>{video.codes.join(", ")}</td></tr>)}
    </tbody></table></div> : sales ? <div className="empty-state">이 기간에 영상에서 온 구매가 없어요.</div> : null}
    {left.length ? <details className="perf-more"><summary>영상에 붙지 않은 유튜브 매출 {left.length}건 보기</summary><table className="data-table is-compact"><tbody>{left.map((x) => <tr key={x.key}><td>{x.label}</td><td className="perf-num">구매 전 {money(x.money.l)}</td><td className="perf-num">최초 {money(x.money.f)}</td></tr>)}</tbody></table></details> : null}
    {t ? <p className="section-meta">전체(구매 전 유입) {won(t.all.l.net)} = 유튜브 {won(t.youtube.l.net)} + 다른 유입 {won(t.otherSource.l.net)} + 유입 모름 {won(t.unknown.l.net)}</p> : null}
  </section>;
}
