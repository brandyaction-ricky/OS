"use client";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { Money, VideoSales } from "@/lib/video-sales";
import { useSession } from "./session-provider";

// 마이인 영상별 매출 (OS 개발 요청 2026-11-11): which videos bring purchases and net revenue, 구매 전 유입 first, 최초 유입 beside it.
type Sales = VideoSales & { from: string; to: string; measuredAt: string; stale?: { reason: string } };
const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const money = (m: Money) => `${m.orders.toLocaleString("ko-KR")}건 · ${won(m.net)}`;
const time = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function VideoSalesPanel({ from, to }: { from: string; to: string }) {
  const { accessToken, demo } = useSession();
  const [sales, setSales] = useState<Sales | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (fresh = false) => {
    setBusy(true); setError("");
    try { setSales(await apiRequest<Sales>(`/api/v1/content/video-sales?${new URLSearchParams({ from, to, ...(fresh ? { fresh: "1" } : {}) })}`, { token: accessToken })); }
    catch (reason) { setSales(null); setError(reason instanceof Error ? reason.message : "마이인 매출을 불러오지 못했어요."); }
    finally { setBusy(false); }
  }, [accessToken, from, to]);
  useEffect(() => { if (!demo && from && to) void load(); }, [demo, from, to, load]);
  if (demo) return null;
  const t = sales?.totals;
  const share = (net: number) => t && t.youtube.l.net > 0 ? `${Math.round(net / t.youtube.l.net * 1000) / 10}%` : "—";
  const left = sales ? [...sales.unmapped.map((x) => ({ key: `u-${x.cnt}`, label: `미매핑 · ${x.cnt}`, money: x.money })), ...sales.conflicts.map((x) => ({ key: `c-${x.cnt}`, label: `충돌 · ${x.cnt} (${x.videoIds.join(", ")})`, money: x.money })),
    ...sales.nonVideo.map((x) => ({ key: `n-${x.cnt}-${x.cmp}`, label: `프로필·기타 · ${x.cnt ?? "content 없음"}${x.cmp ? ` · ${x.cmp}` : ""}`, money: x.money }))] : [];
  return <section className="panel performance-table" aria-label="영상별 매출">
    <div className="panel-header"><h2>영상별 매출 · 마이인</h2><button type="button" className="secondary-button" disabled={busy} onClick={() => void load(true)}>{busy ? "집계 중…" : "새로 집계"}</button></div>
    <p className="metric-caption">결제일(한국시간) {from} ~ {to} · 구매 전 유입이 기본이고, 최초 유입은 같은 주문을 다르게 본 것이라 더하지 않아요{sales ? ` · 마이인 집계 ${time(sales.measuredAt)}` : ""}</p>
    {error ? error.includes("배포 대기") ? <p className="small-empty">마이인 쪽 준비가 끝나면 여기에 영상별 매출이 보여요.</p> : <p className="inline-alert danger" role="alert">{error}</p> : null}
    {sales?.stale ? <p className="inline-alert" role="status">지금 값을 못 불러와 마지막으로 받은 값을 보여 줘요 · {sales.stale.reason}</p> : null}
    {t ? <div className="metric-grid content-performance-metrics">
      {[["유튜브 순매출 · 구매 전 유입", t.youtube.l], ["영상에 연결", t.video.l], ["프로필·기타", t.nonVideo.l], ["미매핑·충돌", { orders: t.unmapped.l.orders + t.conflict.l.orders, net: t.unmapped.l.net + t.conflict.l.net }], ["유튜브 순매출 · 최초 유입", t.youtube.f]].map(([label, m]) =>
        <div className="metric-card" key={label as string}><div className="metric-top">{label as string}</div><div className="metric-value">{won((m as Money).net)}</div><small>{(m as Money).orders.toLocaleString("ko-KR")}건</small></div>)}
    </div> : null}
    {sales ? <table><thead><tr><th>영상</th><th>구매 전 유입</th><th>비중</th><th>최초 유입</th><th>연결 코드</th></tr></thead><tbody>
      {sales.videos.map((video) => <tr key={video.videoId}><td><a href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer">{video.title}</a>{video.channelTitle ? <small> · {video.channelTitle}</small> : null}</td>
        <td>{money(video.money.l)}</td><td>{share(video.money.l.net)}</td><td>{money(video.money.f)}</td><td>{video.codes.join(", ")}</td></tr>)}
    </tbody></table> : null}
    {sales && !sales.videos.length ? <p className="small-empty">이 기간에 영상에서 온 구매가 없어요.</p> : null}
    {left.length ? <details><summary>영상에 붙지 않은 유튜브 매출 {left.length}건 보기</summary><table><tbody>{left.map((x) => <tr key={x.key}><td>{x.label}</td><td>구매 전 {money(x.money.l)}</td><td>최초 {money(x.money.f)}</td></tr>)}</tbody></table></details> : null}
    {t ? <p className="metric-caption">전체(구매 전 유입) {won(t.all.l.net)} = 유튜브 {won(t.youtube.l.net)} + 다른 유입 {won(t.otherSource.l.net)} + 유입 모름 {won(t.unknown.l.net)}</p> : null}
  </section>;
}
